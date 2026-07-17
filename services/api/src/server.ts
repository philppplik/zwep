import Fastify from 'fastify';
import cors from '@fastify/cors';
import { loadEnv } from '@zwep/config';
import { Indexer } from '@zwep/indexer';
import type { SearchSort } from '@zwep/shared';

const env = loadEnv();
const indexer = new Indexer();

function badRequest(reply: any, code: string, message: string) {
  return reply.code(400).send({ error: { code, message, status: 400 } });
}

async function build() {
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
