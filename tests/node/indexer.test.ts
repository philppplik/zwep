import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFilter, Indexer, quote, sortToMeili, MAX_LIMIT } from '@zwep/indexer';
import type { IndexAdapter } from '@zwep/indexer';
import { reloadEnv, saveSources } from '@zwep/config';
import type { Document } from '@zwep/shared';

/** A recording fake adapter — no Meilisearch required. */
function fakeAdapter(overrides: Partial<IndexAdapter> = {}) {
  const calls: { q: string; params: Record<string, unknown> }[] = [];
  const adapter: IndexAdapter = {
    ensureIndex: vi.fn(async () => {}),
    upsert: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    deleteBySource: vi.fn(async () => {}),
    deleteAll: vi.fn(async () => {}),
    get: vi.fn(async () => null),
    count: vi.fn(async () => 0),
    embedderName: () => null,
    rawSearch: vi.fn(async (q: string, params) => {
      calls.push({ q, params: params as Record<string, unknown> });
      return { hits: [], estimatedTotalHits: 0 };
    }),
    ...overrides,
  };
  return { adapter, calls };
}

beforeEach(() => {
  process.env.ZWEP_DATA_DIR = mkdtempSync(join(tmpdir(), 'zwep-idx-'));
  reloadEnv();
  saveSources([
    { name: 'alpha', seeds: [], allowedDomains: [] },
    { name: 'beta', seeds: [], allowedDomains: [], enabled: false },
  ]);
});

describe('quote', () => {
  it('escapes quotes so a value cannot break out of a filter expression', () => {
    expect(quote('plain')).toBe('"plain"');
    expect(quote('a"b')).toBe('"a\\"b"');
    expect(quote('a\\b')).toBe('"a\\\\b"');
  });
});

describe('buildFilter', () => {
  it('restricts to enabled sources by default', () => {
    expect(buildFilter({ q: 'x' })).toEqual(['source IN ["alpha"]']);
  });

  it('honours an explicit source list, including a disabled one', () => {
    expect(buildFilter({ q: 'x', source: ['beta'] })).toEqual(['source IN ["beta"]']);
  });

  it('builds type, tag, lang and date clauses', () => {
    expect(
      buildFilter({ q: 'x', source: ['a'], type: ['article'], tag: ['t1', 't2'], lang: 'de', from: '2025-01-01' }),
    ).toEqual([
      'source IN ["a"]',
      'type IN ["article"]',
      'lang = "de"',
      'tags IN ["t1", "t2"]',
      'published_at >= "2025-01-01"',
    ]);
  });

  it('neutralises an injection attempt in a source name', () => {
    const filter = buildFilter({ q: 'x', source: ['a"] OR type = "article'] });
    expect(filter[0]).toBe('source IN ["a\\"] OR type = \\"article"]');
  });
});

describe('sortToMeili', () => {
  it('maps the public sort values', () => {
    expect(sortToMeili('relevance')).toEqual([]);
    expect(sortToMeili('date_desc')).toEqual(['published_at:desc']);
    expect(sortToMeili('date_asc')).toEqual(['published_at:asc']);
  });
});

describe('Indexer.search', () => {
  it('clamps the limit to the documented maximum', async () => {
    const { adapter, calls } = fakeAdapter();
    await new Indexer(adapter).search({ q: 'x', limit: 5000 });
    expect(calls[0].params.limit).toBe(MAX_LIMIT);
  });

  it('refuses a negative offset', async () => {
    const { adapter, calls } = fakeAdapter();
    await new Indexer(adapter).search({ q: 'x', offset: -10 });
    expect(calls[0].params.offset).toBe(0);
  });

  it('omits hybrid search when no embedder is configured', async () => {
    const { adapter, calls } = fakeAdapter();
    const res = await new Indexer(adapter).search({ q: 'x', semantic: true });
    expect(calls[0].params.hybrid).toBeUndefined();
    expect(res.semantic).toBe(false);
  });

  it('passes the embedder name when hybrid search is requested', async () => {
    // Regression guard: `hybrid` was sent without `embedder`, which
    // Meilisearch rejects — `semantic=true` always returned a 400.
    const { adapter, calls } = fakeAdapter({ embedderName: () => 'zwep_default' });
    const res = await new Indexer(adapter).search({ q: 'x', semantic: true });
    expect(calls[0].params.hybrid).toEqual({ semanticRatio: 0.7, embedder: 'zwep_default' });
    expect(res.semantic).toBe(true);
  });

  it('surfaces highlights in a dedicated field and drops the raw Meili key', async () => {
    const { adapter } = fakeAdapter({
      rawSearch: vi.fn(async () => ({
        hits: [
          {
            id: '1',
            title: 'Climate policy',
            excerpt: 'About climate.',
            _formatted: { title: '<mark>Climate</mark> policy', excerpt: 'About <mark>climate</mark>.' },
            _rankingScore: 0.87,
          },
        ],
        estimatedTotalHits: 1,
      })),
    });
    const res = await new Indexer(adapter).search({ q: 'climate' });
    expect(res.results[0].highlighted).toEqual({
      title: '<mark>Climate</mark> policy',
      excerpt: 'About <mark>climate</mark>.',
    });
    expect(res.results[0].score).toBe(0.87);
    expect(res.results[0]).not.toHaveProperty('_formatted');
    expect(res.results[0].title).toBe('Climate policy');
  });

  it('maps the tags facet to the public `tag` key', async () => {
    const { adapter } = fakeAdapter({
      rawSearch: vi.fn(async () => ({
        hits: [],
        estimatedTotalHits: 0,
        facetDistribution: { tags: { climate: 3 }, source: { alpha: 3 } },
      })),
    });
    const res = await new Indexer(adapter).search({ q: 'x', facets: true });
    expect(res.facets?.tag).toEqual({ climate: 3 });
    expect(res.facets?.source).toEqual({ alpha: 3 });
  });

  it('reports timing and echoes the query', async () => {
    const { adapter } = fakeAdapter();
    const res = await new Indexer(adapter).search({ q: 'hello' });
    expect(res.query).toBe('hello');
    expect(res.took_ms).toBeGreaterThanOrEqual(0);
  });
});

describe('Indexer write paths', () => {
  it('delegates indexing to the adapter', async () => {
    const { adapter } = fakeAdapter();
    const doc = { id: 'a', title: 'T' } as unknown as Document;
    await new Indexer(adapter).index([doc]);
    expect(adapter.upsert).toHaveBeenCalledWith([doc]);
  });

  it('delegates a full wipe', async () => {
    const { adapter } = fakeAdapter();
    await new Indexer(adapter).deleteAll();
    expect(adapter.deleteAll).toHaveBeenCalled();
  });
});
