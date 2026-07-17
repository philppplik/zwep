import Fastify from 'fastify';
import cors from '@fastify/cors';
import { loadEnv, loadSources, getSource, upsertSource, deleteSource, sourceSchema } from '@zwep/config';
import { Indexer } from '@zwep/indexer';
import { crawlSource, type CrawlSummary } from '@zwep/worker/crawl-lib.ts';
import type { SearchSort, SourceConfig } from '@zwep/shared';

const env = loadEnv();
const indexer = new Indexer();

function badRequest(reply: any, code: string, message: string) {
  return reply.code(400).send({ error: { code, message, status: 400 } });
}

export async function build() {
  const app = Fastify({
    logger: process.stdout.isTTY ? { level: 'info' } : false,
  });

  await app.register(cors, {
    origin: env.API_CORS_ORIGINS.split(',').map((s) => s.trim()),
  });

  // index once on boot (idempotent)
  try {
    await indexer.ensureIndex();
  } catch (e) {
    app.log.warn('Index ensure failed (is Meilisearch up?): ' + (e as Error).message);
  }

  app.get('/healthz', async () => ({ ok: true }));

  app.get('/v1/stats', async (req, reply) => {
    try {
      const indexed = await indexer.count();
      return { ok: true, indexed };
    } catch {
      return reply.code(503).send({ error: { code: 'index_unavailable', message: 'Index not reachable', status: 503 } });
    }
  });

  app.get('/v1/search', async (req, reply) => {
    const q = (req.query as any).q as string | undefined;
    if (!q || !q.trim()) return badRequest(reply, 'invalid_query', "Parameter 'q' is required.");
    const z = req.query as any;
    const sort = (z.sort as SearchSort) || 'relevance';
    const r = await indexer.search({
      q: q.trim(),
      limit: z.limit ? Number(z.limit) : 20,
      offset: z.offset ? Number(z.offset) : 0,
      source: splitMulti(z.source),
      type: splitMulti(z.type),
      tag: splitMulti(z.tag),
      lang: z.lang,
      from: z.from,
      to: z.to,
      sort,
      facets: z.facets === 'true' || z.facets === '1',
      highlight: z.highlight !== 'false',
    });
    return r;
  });

  app.get('/v1/suggest', async (req, reply) => {
    const q = (req.query as any).q as string | undefined;
    if (!q || !q.trim()) return badRequest(reply, 'invalid_query', "Parameter 'q' is required.");
    const z = req.query as any;
    const r = await indexer.search({
      q: q.trim(),
      limit: z.limit ? Number(z.limit) : 8,
      source: splitMulti(z.source),
      highlight: false,
    });
    return {
      query: q.trim(),
      suggestions: r.results.map((d) => ({
        text: d.title,
        url: d.url,
        type: d.type,
      })),
    };
  });

  app.get('/v1/document/:id', async (req, reply) => {
    const doc = await indexer.get((req.params as any).id);
    if (!doc) return reply.code(404).send({ error: { code: 'not_found', message: 'Document not found', status: 404 } });
    return doc;
  });

  // ---------- Admin API ----------
  const API_KEY = env.ZWEP_ADMIN_KEY;
  interface CrawlTask {
    id: string;
    source: string;
    status: 'running' | 'done' | 'error';
    startedAt: string;
    finishedAt?: string;
    summary?: CrawlSummary;
    error?: string;
  }
  const tasks = new Map<string, CrawlTask>();

  const requireAdmin = async (req: any, reply: any) => {
    const key = req.headers['x-admin-key'] || req.query.admin_key;
    if (key !== API_KEY) return reply.code(401).send({ error: { code: 'unauthorized', message: 'Invalid admin key', status: 401 } });
    return true;
  };

  // list sources
  app.get('/v1/admin/sources', { preHandler: requireAdmin }, async () => {
    return { sources: loadSources() };
  });

  // get one source
  app.get<{ Params: { name: string } }>('/v1/admin/sources/:name', { preHandler: requireAdmin }, async (req, reply) => {
    const s = getSource((req.params as any).name);
    if (!s) return reply.code(404).send({ error: { code: 'not_found', message: 'Source not found', status: 404 } });
    return { source: s };
  });

  // create / update source
  app.put('/v1/admin/sources', { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = sourceSchema.safeParse((req.body as any) ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'invalid', message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), status: 400 } });
    }
    const src = upsertSource(parsed.data as SourceConfig);
    return { ok: true, source: src };
  });

  // delete source
  app.delete<{ Params: { name: string } }>('/v1/admin/sources/:name', { preHandler: requireAdmin }, async (req, reply) => {
    const ok = deleteSource((req.params as any).name);
    if (!ok) return reply.code(404).send({ error: { code: 'not_found', message: 'Source not found', status: 404 } });
    return { ok: true };
  });

  // trigger a crawl (async; returns a task id to poll)
  app.post<{ Body: { source: string; maxPages?: number } }>('/v1/admin/crawl', { preHandler: requireAdmin }, async (req, reply) => {
    const body = (req.body as any) ?? {};
    const name = body.source;
    if (!name || !getSource(name)) {
      return reply.code(400).send({ error: { code: 'invalid', message: `Unknown source: ${name ?? '(none)'}`, status: 400 } });
    }
    const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const task: CrawlTask = { id, source: name, status: 'running', startedAt: new Date().toISOString() };
    tasks.set(id, task);
    // run without blocking the response
    crawlSource(name, body.maxPages ? Number(body.maxPages) : undefined)
      .then((summary) => {
        task.status = 'done';
        task.summary = summary;
        task.finishedAt = new Date().toISOString();
      })
      .catch((e) => {
        task.status = 'error';
        task.error = e instanceof Error ? e.message : String(e);
        task.finishedAt = new Date().toISOString();
      });
    return reply.code(202).send({ ok: true, taskId: id });
  });

  // poll crawl task status
  app.get<{ Params: { id: string } }>('/v1/admin/crawl/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const task = tasks.get((req.params as any).id);
    if (!task) return reply.code(404).send({ error: { code: 'not_found', message: 'Task not found', status: 404 } });
    return { task };
  });

  return app;
}

function splitMulti(v: unknown): string[] | undefined {
  if (v == null) return undefined;
  if (Array.isArray(v)) return v.map(String);
  return String(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

build()
  .then((app) =>
    app.listen({ port: env.API_PORT, host: env.API_HOST }).then(() => {
      console.log(`Zwep API listening on ${env.API_HOST}:${env.API_PORT}`);
    })
  )
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
