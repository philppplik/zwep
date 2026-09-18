import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { build } from '../../services/api/src/app.ts';
import { Indexer, type IndexAdapter } from '@zwep/indexer';
import { reloadEnv, saveSources } from '@zwep/config';

const ADMIN_KEY = 'test_admin_key';

function stubIndexer(overrides: Partial<IndexAdapter> = {}): Indexer {
  const adapter: IndexAdapter = {
    ensureIndex: vi.fn(async () => {}),
    upsert: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    deleteBySource: vi.fn(async () => {}),
    deleteAll: vi.fn(async () => {}),
    get: vi.fn(async (id: string) => (id === 'known' ? ({ id, title: 'Known' } as never) : null)),
    count: vi.fn(async () => 42),
    embedderName: () => null,
    rawSearch: vi.fn(async () => ({ hits: [], estimatedTotalHits: 0 })),
    ...overrides,
  };
  return new Indexer(adapter);
}

let app: FastifyInstance;

beforeEach(async () => {
  process.env.ZWEP_DATA_DIR = mkdtempSync(join(tmpdir(), 'zwep-api-'));
  process.env.ZWEP_ADMIN_KEY = ADMIN_KEY;
  process.env.API_RATE_LIMIT = '0';
  process.env.GOOGLE_PROXY_ENABLED = 'false';
  reloadEnv();
  saveSources([{ name: 'alpha', type: 'web', seeds: ['https://example.com/'], allowedDomains: ['example.com'] }]);
  app = await build({ indexer: stubIndexer(), logger: false });
});

const admin = { 'x-admin-key': ADMIN_KEY };

describe('health and stats', () => {
  it('reports health without auth', async () => {
    const res = await app.inject({ url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
  });

  it('reports index and source counts', async () => {
    const res = await app.inject({ url: '/v1/stats' });
    expect(res.json()).toMatchObject({ ok: true, indexed: 42, sources: 1, sourcesEnabled: 1 });
  });

  it('answers 503 when the index is unreachable', async () => {
    const broken = await build({
      indexer: stubIndexer({
        count: vi.fn(async () => {
          throw new Error('ECONNREFUSED');
        }),
      }),
      logger: false,
    });
    const res = await broken.inject({ url: '/v1/stats' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('index_unavailable');
  });
});

describe('GET /v1/search', () => {
  it('requires a query', async () => {
    const res = await app.inject({ url: '/v1/search' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_query');
  });

  it('treats a whitespace-only query as missing', async () => {
    expect((await app.inject({ url: '/v1/search?q=%20%20' })).statusCode).toBe(400);
  });

  it('returns a well-formed response envelope', async () => {
    const res = await app.inject({ url: '/v1/search?q=climate' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ query: 'climate', total: 0, results: [] });
  });
});

describe('GET /v1/document/:id', () => {
  it('returns 404 for an unknown id', async () => {
    const res = await app.inject({ url: '/v1/document/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });

  it('returns the document when it exists', async () => {
    expect((await app.inject({ url: '/v1/document/known' })).json()).toMatchObject({ id: 'known' });
  });
});

describe('admin authentication', () => {
  it('rejects a request with no key', async () => {
    const res = await app.inject({ url: '/v1/admin/sources' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthorized');
  });

  it('rejects a wrong key', async () => {
    const res = await app.inject({ url: '/v1/admin/sources', headers: { 'x-admin-key': 'nope' } });
    expect(res.statusCode).toBe(401);
  });

  it('accepts the key as a header', async () => {
    expect((await app.inject({ url: '/v1/admin/sources', headers: admin })).statusCode).toBe(200);
  });

  it('still accepts the key as a query parameter for backwards compatibility', async () => {
    const res = await app.inject({ url: `/v1/admin/sources?admin_key=${ADMIN_KEY}` });
    expect(res.statusCode).toBe(200);
  });

  it('guards POST /v1/settings', async () => {
    // Regression guard: this route was public, letting any visitor repoint the
    // server's LLM provider and read back its configuration.
    const res = await app.inject({
      method: 'POST',
      url: '/v1/settings',
      payload: { llmProvider: 'ollama' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('applies settings when authenticated', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/settings',
      headers: admin,
      payload: { llmProvider: 'none' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, llmProvider: 'none' });
  });

  it('rejects an unknown provider', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/settings',
      headers: admin,
      payload: { llmProvider: 'skynet' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('PUT /v1/admin/sources', () => {
  it('validates the payload', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/admin/sources',
      headers: admin,
      payload: { name: 'has spaces', seeds: [], allowedDomains: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid');
  });

  it('requires at least one seed for a web source', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/admin/sources',
      headers: admin,
      payload: { name: 'empty', type: 'web', seeds: [], allowedDomains: ['x.com'] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('persists the enabled flag', async () => {
    // Regression guard: `enabled` was stripped by the schema, so the Library
    // toggle appeared to work but changed nothing.
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/admin/sources',
      headers: admin,
      payload: {
        name: 'alpha',
        type: 'web',
        seeds: ['https://example.com/'],
        allowedDomains: ['example.com'],
        enabled: false,
      },
    });
    expect(res.statusCode).toBe(200);
    const list = await app.inject({ url: '/v1/admin/sources', headers: admin });
    expect(list.json().sources.find((s: { name: string }) => s.name === 'alpha').enabled).toBe(false);
  });

  it('refuses a google source while the proxy is disabled', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/admin/sources',
      headers: admin,
      payload: { name: 'g', type: 'google', queries: ['x'], seeds: [], allowedDomains: [] },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('google_proxy_disabled');
  });
});

describe('DELETE /v1/admin/sources/:name', () => {
  it('404s for an unknown source', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/v1/admin/sources/ghost', headers: admin });
    expect(res.statusCode).toBe(404);
  });

  it('deletes and reports whether documents were purged', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/admin/sources/alpha?purge=true',
      headers: admin,
    });
    expect(res.json()).toMatchObject({ ok: true, purged: true });
  });
});

describe('crawl task lifecycle', () => {
  it('rejects an unknown source', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/crawl',
      headers: admin,
      payload: { source: 'ghost' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('exposes a pollable task endpoint', async () => {
    // Regression guard: GET /v1/admin/crawl/:id did not exist, yet the UI
    // polled it after every crawl and therefore never saw a result.
    const res = await app.inject({ url: '/v1/admin/crawl/task_missing', headers: admin });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });

  it('404s on an unknown batch id', async () => {
    const res = await app.inject({ url: '/v1/admin/crawl-all/batch_missing', headers: admin });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /v1/admin/crawl-url', () => {
  it('rejects a non-http scheme', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/crawl-url',
      headers: admin,
      payload: { url: 'file:///etc/passwd' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_url');
  });

  it('rejects a malformed URL', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/crawl-url',
      headers: admin,
      payload: { url: 'nonsense' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /v1/overview', () => {
  it('reports 503 when no LLM provider is configured', async () => {
    const res = await app.inject({ url: '/v1/overview?q=climate' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('llm_unavailable');
  });
});

describe('rate limiting', () => {
  it('returns 429 once the window is exhausted', async () => {
    process.env.API_RATE_LIMIT = '3';
    reloadEnv();
    const limited = await build({ indexer: stubIndexer(), logger: false });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      codes.push((await limited.inject({ url: '/v1/search?q=x' })).statusCode);
    }
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
    process.env.API_RATE_LIMIT = '0';
    reloadEnv();
  });
});
