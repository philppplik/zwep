import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { timingSafeEqual } from 'node:crypto';
import {
  loadEnv,
  isGoogleProxyEnabled,
  loadSources,
  getSource,
  upsertSource,
  deleteSource,
  sourceSchema,
} from '@zwep/config';
import { Indexer } from '@zwep/indexer';
import { crawlSource } from '@zwep/worker/crawl-lib.ts';
import {
  getLlmProvider,
  getCachedOverview,
  setCachedOverview,
  clearOverviewCache,
  applyRuntimeLlmSettings,
  activeProviderName,
  overviewPrompt,
} from '@zwep/llm';
import type { SearchSort, SourceConfig } from '@zwep/shared';
import { TaskRegistry } from './tasks.ts';

/** How many results the AI Overview summarizes. */
const OVERVIEW_CONTEXT_SIZE = 5;
/** Maximum concurrent background crawls per process. */
const MAX_CONCURRENT_CRAWLS = 4;

export interface BuildOptions {
  indexer?: Indexer;
  logger?: boolean;
}

function fail(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message, status } });
}

/** Constant-time key comparison, so a wrong key leaks no timing information. */
function keyMatches(provided: unknown, expected: string): boolean {
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function build(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const env = loadEnv();
  const indexer = opts.indexer ?? new Indexer();
  const tasks = new TaskRegistry();

  const app = Fastify({
    logger: opts.logger ?? (process.stdout.isTTY ? { level: 'info' } : false),
    bodyLimit: 1_000_000,
  });

  await app.register(cors, {
    origin: env.API_CORS_ORIGINS.trim() === '*'
      ? true
      : env.API_CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  });

  // Index setup is best-effort: the API must still boot (and report a clear
  // 503) when Meilisearch is not up yet, e.g. during `docker compose up`.
  try {
    await indexer.ensureIndex();
  } catch (e) {
    app.log.warn(`Index ensure failed (is Meilisearch running?): ${(e as Error).message}`);
  }

  registerRateLimit(app, env.API_RATE_LIMIT);

  // -------------------------------------------------------------------------
  // Public routes
  // -------------------------------------------------------------------------

  app.get('/healthz', async () => ({ ok: true, service: 'zwep-api', version: 'v1' }));

  app.get('/v1/stats', async (_req, reply) => {
    try {
      const [indexed, sources] = [await indexer.count(), loadSources()];
      return {
        ok: true,
        indexed,
        sources: sources.length,
        sourcesEnabled: sources.filter((s) => s.enabled !== false).length,
        llm: activeProviderName(),
        runningCrawls: tasks.runningCount(),
      };
    } catch {
      return fail(reply, 503, 'index_unavailable', 'Search index is not reachable.');
    }
  });

  app.get('/v1/search', async (req, reply) => {
    const q = strParam(req, 'q');
    if (!q) return fail(reply, 400, 'invalid_query', "Parameter 'q' is required.");
    const z = req.query as Record<string, unknown>;
    try {
      return await indexer.search({
        q,
        limit: numParam(z.limit),
        offset: numParam(z.offset),
        source: splitMulti(z.source),
        type: splitMulti(z.type),
        tag: splitMulti(z.tag),
        lang: typeof z.lang === 'string' ? z.lang : undefined,
        from: typeof z.from === 'string' ? z.from : undefined,
        to: typeof z.to === 'string' ? z.to : undefined,
        sort: (typeof z.sort === 'string' ? z.sort : 'relevance') as SearchSort,
        facets: isTrue(z.facets),
        highlight: z.highlight !== 'false',
        semantic: isTrue(z.semantic),
      });
    } catch (e) {
      return fail(reply, 503, 'index_unavailable', (e as Error).message);
    }
  });

  app.get('/v1/suggest', async (req, reply) => {
    const q = strParam(req, 'q');
    if (!q) return fail(reply, 400, 'invalid_query', "Parameter 'q' is required.");
    const z = req.query as Record<string, unknown>;
    try {
      const r = await indexer.search({
        q,
        limit: Math.min(numParam(z.limit) ?? 8, 20),
        source: splitMulti(z.source),
        highlight: false,
      });
      return {
        query: q,
        suggestions: r.results.map((d) => ({ text: d.title, url: d.url, type: d.type })),
      };
    } catch (e) {
      return fail(reply, 503, 'index_unavailable', (e as Error).message);
    }
  });

  app.get('/v1/document/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const doc = await indexer.get(id).catch(() => null);
    if (!doc) return fail(reply, 404, 'not_found', 'Document not found.');
    return doc;
  });

  // Knowledge graph. The module is imported lazily so that a missing/locked
  // SQLite file degrades to a 503 on this route instead of failing boot.
  let graphInst: import('@zwep/graph').KnowledgeGraph | null = null;
  app.get('/v1/graph', async (req, reply) => {
    const q = strParam(req, 'q');
    const wantsExport = (req.query as Record<string, unknown>).export === 'json';
    if (!q && !wantsExport) return fail(reply, 400, 'invalid_query', "Parameter 'q' is required.");
    try {
      const { KnowledgeGraph } = await import('@zwep/graph');
      if (!graphInst) graphInst = new KnowledgeGraph();
      if (wantsExport) {
        reply.header('content-type', 'application/json; charset=utf-8');
        reply.header(
          'content-disposition',
          `attachment; filename="zwep-graph-${new Date().toISOString().slice(0, 10)}.json"`,
        );
        return graphInst.all();
      }
      return { ok: true, query: q, ...graphInst.neighborhood(q!, 1, 40), stats: graphInst.stats() };
    } catch (e) {
      return fail(reply, 503, 'graph_unavailable', (e as Error).message);
    }
  });

  app.get('/v1/overview', async (req, reply) => {
    const q = strParam(req, 'q');
    if (!q) return fail(reply, 400, 'invalid_query', "Parameter 'q' is required.");

    const provider = await getLlmProvider();
    if (!provider) {
      return fail(
        reply,
        503,
        'llm_unavailable',
        'No LLM provider configured or reachable. Set LLM_PROVIDER, or enable one in Settings.',
      );
    }
    try {
      const top = await indexer.search({ q, limit: OVERVIEW_CONTEXT_SIZE, highlight: false });
      if (!top.results.length) return { ok: true, query: q, overview: '', sources: [] };

      const sources = top.results.map((r) => ({ title: r.title, url: r.url, source: r.source }));
      const cached = getCachedOverview(provider.name, provider.model, q);
      if (cached) return { ok: true, query: q, overview: cached, cached: true, sources };

      const overview = await provider.complete(
        overviewPrompt(
          q,
          top.results.map((r) => ({ title: r.title, excerpt: r.excerpt })),
        ),
      );
      setCachedOverview(provider.name, provider.model, q, overview);
      return { ok: true, query: q, overview, cached: false, sources };
    } catch (e) {
      return fail(reply, 503, 'llm_error', (e as Error).message);
    }
  });

  // Model discovery for the Settings dropdowns.
  app.get('/v1/ollama-models', async (_req, reply) => {
    try {
      const host = loadEnv().OLLAMA_HOST.replace(/\/$/, '');
      const res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as { models?: { name?: string; model?: string; size?: number }[] };
      const models = (data.models ?? [])
        .map((m) => ({ id: m.name || m.model || '', name: m.name || m.model || '', size: m.size ?? 0 }))
        .filter((m) => m.id);
      return { ok: true, models };
    } catch (e) {
      return fail(reply, 503, 'ollama_unavailable', (e as Error).message);
    }
  });

  app.get('/v1/openrouter-models', async (_req, reply) => {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as {
        data?: { id?: string; name?: string; context_length?: number }[];
      };
      const models = (data.data ?? [])
        .filter((m): m is { id: string; name?: string; context_length?: number } => !!m.id)
        .map((m) => ({ id: m.id, name: m.name || m.id, context_length: m.context_length ?? 0 }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { ok: true, models };
    } catch (e) {
      return fail(reply, 503, 'openrouter_unavailable', (e as Error).message);
    }
  });

  // -------------------------------------------------------------------------
  // Admin routes
  // -------------------------------------------------------------------------

  const requireAdmin = async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers['x-admin-key'];
    const query = (req.query as Record<string, unknown> | undefined)?.admin_key;
    if (keyMatches(header, env.ZWEP_ADMIN_KEY) || keyMatches(query, env.ZWEP_ADMIN_KEY)) return;
    return fail(reply, 401, 'unauthorized', 'A valid admin key is required.');
  };
  const admin = { preHandler: requireAdmin };

  /**
   * Runtime LLM settings.
   *
   * This route accepts an API key, so it is admin-gated like every other
   * mutating endpoint — it used to be public, which let any visitor of the web
   * UI repoint the server's LLM provider and read back the configured model.
   */
  app.post('/v1/settings', admin, async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const provider = typeof b.llmProvider === 'string' ? b.llmProvider : undefined;
    if (provider && !['ollama', 'openrouter', 'none'].includes(provider)) {
      return fail(reply, 400, 'invalid', `Unknown llmProvider: ${provider}`);
    }
    applyRuntimeLlmSettings({
      llmProvider: provider,
      model:
        (typeof b.ollamaLlmModel === 'string' ? b.ollamaLlmModel : undefined) ||
        (typeof b.openrouterLlmModel === 'string' ? b.openrouterLlmModel : undefined),
      key: typeof b.openrouterLlmKey === 'string' ? b.openrouterLlmKey : undefined,
    });
    return { ok: true, llmProvider: activeProviderName() };
  });

  app.get('/v1/admin/config', admin, async () => ({
    googleProxyEnabled: isGoogleProxyEnabled(),
    llmProvider: activeProviderName(),
    maxConcurrentCrawls: MAX_CONCURRENT_CRAWLS,
  }));

  app.get('/v1/admin/sources', admin, async () => ({ sources: loadSources() }));

  app.get('/v1/admin/sources/:name', admin, async (req, reply) => {
    const s = getSource((req.params as { name: string }).name);
    if (!s) return fail(reply, 404, 'not_found', 'Source not found.');
    return { source: s };
  });

  app.put('/v1/admin/sources', admin, async (req, reply) => {
    const parsed = sourceSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
        .join('; ');
      return fail(reply, 400, 'invalid', message);
    }
    const src = parsed.data as SourceConfig;
    if (src.type === 'google' && !isGoogleProxyEnabled()) {
      return fail(
        reply,
        403,
        'google_proxy_disabled',
        'Google proxy is disabled. Set GOOGLE_PROXY_ENABLED=true to allow google-type sources.',
      );
    }
    if (src.type === 'web' && !src.seeds.length) {
      return fail(reply, 400, 'invalid', 'A web source needs at least one seed URL.');
    }
    if (src.type === 'google' && !src.queries?.length) {
      return fail(reply, 400, 'invalid', 'A google source needs at least one query.');
    }
    return { ok: true, source: upsertSource(src) };
  });

  app.delete('/v1/admin/sources/:name', admin, async (req, reply) => {
    const { name } = req.params as { name: string };
    const purge = isTrue((req.query as Record<string, unknown>).purge);
    if (!deleteSource(name)) return fail(reply, 404, 'not_found', 'Source not found.');
    let purged = false;
    if (purge) {
      await indexer.deleteBySource(name).then(
        () => (purged = true),
        () => (purged = false),
      );
    }
    return { ok: true, purged };
  });

  /** Kick off a crawl in the background and return a pollable task id. */
  const startCrawl = (source: string, maxPages: number | undefined, batchId?: string) => {
    const task = tasks.create(source, batchId);
    crawlSource(source, { maxPages }).then(
      (summary) => tasks.succeed(task.id, summary),
      (e) => tasks.fail(task.id, e),
    );
    return task;
  };

  app.post('/v1/admin/crawl', admin, async (req, reply) => {
    const body = (req.body ?? {}) as { source?: string; maxPages?: number };
    if (!body.source || !getSource(body.source)) {
      return fail(reply, 400, 'invalid', `Unknown source: ${body.source ?? '(none)'}`);
    }
    if (tasks.runningCount() >= MAX_CONCURRENT_CRAWLS) {
      return fail(reply, 429, 'too_many_crawls', 'Too many crawls already running. Try again shortly.');
    }
    const task = startCrawl(body.source, numParam(body.maxPages));
    return reply.code(202).send({ ok: true, taskId: task.id });
  });

  /** Poll one crawl task. */
  app.get('/v1/admin/crawl/:id', admin, async (req, reply) => {
    const task = tasks.get((req.params as { id: string }).id);
    if (!task) return fail(reply, 404, 'not_found', 'Task not found or expired.');
    return { task };
  });

  app.post('/v1/admin/crawl-all', admin, async (req, reply) => {
    const body = (req.body ?? {}) as { maxPages?: number };
    const maxPages = numParam(body.maxPages);
    const sources = loadSources().filter((s) => s.enabled !== false);
    if (!sources.length) return fail(reply, 400, 'no_sources', 'No enabled sources to crawl.');

    const batchId = tasks.newBatchId();
    const queued = sources.map((s) => tasks.create(s.name, batchId));
    // Run sequentially so a large batch cannot saturate Meilisearch or the
    // network; progress is observable through the batch endpoint meanwhile.
    void (async () => {
      for (const task of queued) {
        try {
          tasks.succeed(task.id, await crawlSource(task.source, { maxPages }));
        } catch (e) {
          tasks.fail(task.id, e);
        }
      }
    })();
    return reply.code(202).send({ ok: true, batchId, count: sources.length });
  });

  app.get('/v1/admin/crawl-all/:id', admin, async (req, reply) => {
    const batch = tasks.batch((req.params as { id: string }).id);
    if (!batch) return fail(reply, 404, 'not_found', 'Batch not found or expired.');
    return { batch, done: batch.filter((t) => t.status !== 'running').length, total: batch.length };
  });

  app.post('/v1/admin/deindex-all', admin, async (_req, reply) => {
    try {
      await indexer.deleteAll();
      return { ok: true, message: 'All documents deleted from the index.' };
    } catch (e) {
      return fail(reply, 500, 'deindex_failed', (e as Error).message);
    }
  });

  app.post('/v1/admin/clear-cache', admin, async () => ({
    ok: true,
    cleared: clearOverviewCache(),
  }));

  /** Ad-hoc crawl of a single URL — creates a one-page source, then crawls it. */
  app.post('/v1/admin/crawl-url', admin, async (req, reply) => {
    const { url } = (req.body ?? {}) as { url?: string };
    let parsed: URL;
    try {
      parsed = new URL(String(url));
    } catch {
      return fail(reply, 400, 'invalid_url', 'A valid http(s) URL is required.');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return fail(reply, 400, 'invalid_url', 'Only http and https URLs can be crawled.');
    }
    const domain = parsed.hostname.replace(/^www\./, '');
    const name = `url_${domain.replace(/[^a-zA-Z0-9.-]/g, '_')}_${Date.now().toString(36)}`;
    upsertSource({
      name,
      type: 'web',
      seeds: [parsed.toString()],
      allowedDomains: [domain],
      maxPages: 1,
      maxDepth: 0,
      label: `Ad-hoc: ${domain}`,
    });
    const task = startCrawl(name, 1);
    return reply.code(202).send({ ok: true, taskId: task.id, source: name });
  });

  return app;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Token-bucket rate limiting, keyed by client IP.
 *
 * Deliberately dependency-free and in-process: it exists to stop one buggy
 * client (or a crawl loop pointed at the API) from hammering the index, not to
 * be a production WAF. Set `API_RATE_LIMIT=0` to disable.
 */
function registerRateLimit(app: FastifyInstance, perMinute: number): void {
  if (perMinute <= 0) return;
  const hits = new Map<string, { count: number; resetAt: number }>();
  const WINDOW_MS = 60_000;

  app.addHook('onRequest', async (req, reply) => {
    if (req.url.startsWith('/healthz')) return;
    const key = req.ip || 'unknown';
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
      return;
    }
    entry.count++;
    if (entry.count > perMinute) {
      reply.header('retry-after', Math.ceil((entry.resetAt - now) / 1000));
      return fail(reply, 429, 'rate_limited', 'Too many requests. Slow down.');
    }
  });

  // Bounded sweep so the map cannot grow without limit.
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, WINDOW_MS);
  timer.unref?.();
  app.addHook('onClose', async () => clearInterval(timer));
}

function strParam(req: FastifyRequest, key: string): string | undefined {
  const v = (req.query as Record<string, unknown> | undefined)?.[key];
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  return trimmed ? trimmed : undefined;
}

function numParam(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function isTrue(v: unknown): boolean {
  return v === true || v === 'true' || v === '1';
}

/** Split a repeated or comma-separated query parameter into a list. */
export function splitMulti(v: unknown): string[] | undefined {
  if (v == null) return undefined;
  const parts = (Array.isArray(v) ? v : [v])
    .flatMap((x) => String(x).split(','))
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : undefined;
}
