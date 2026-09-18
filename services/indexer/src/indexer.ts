import { getAdapter, quote, EMBEDDER, type IndexAdapter } from './meili.ts';
import { enabledSourceNames } from '@zwep/config';
import type {
  Document,
  SearchParams,
  SearchResponse,
  SearchResult,
  SearchSort,
} from '@zwep/shared';

export { enabledSourceNames };

/** Attributes returned for search hits — everything the UI renders, nothing more. */
const RETRIEVE = [
  'id',
  'title',
  'excerpt',
  'url',
  'canonical_url',
  'source',
  'type',
  'lang',
  'favicon',
  'tags',
  'quality',
  'published_at',
  'crawled_at',
  'structured',
];

export const MAX_LIMIT = 100;

export class Indexer {
  private adapter: IndexAdapter;

  constructor(adapter: IndexAdapter = getAdapter()) {
    this.adapter = adapter;
  }

  async ensureIndex(): Promise<void> {
    await this.adapter.ensureIndex();
  }

  async index(docs: Document[]): Promise<void> {
    await this.adapter.upsert(docs);
  }

  async get(id: string): Promise<Document | null> {
    return this.adapter.get(id);
  }

  async count(): Promise<number> {
    return this.adapter.count();
  }

  async deleteAll(): Promise<void> {
    await this.adapter.deleteAll();
  }

  async deleteBySource(source: string): Promise<void> {
    await this.adapter.deleteBySource(source);
  }

  async search(params: SearchParams): Promise<SearchResponse> {
    const t0 = Date.now();
    const limit = clamp(params.limit ?? 20, 1, MAX_LIMIT);
    const offset = Math.max(Math.trunc(params.offset ?? 0), 0);
    const highlight = params.highlight !== false;

    const filter = buildFilter(params);
    const sort = sortToMeili(params.sort ?? 'relevance');

    // Hybrid search needs the embedder's name; without it Meilisearch rejects
    // the request outright, which is why `semantic=true` used to 400.
    const embedder = this.adapter.embedderName();
    const hybrid = params.semantic === true && embedder !== null;

    const res = (await this.adapter.rawSearch(params.q, {
      limit,
      offset,
      filter: filter.length ? filter : undefined,
      sort: sort.length ? sort : undefined,
      attributesToRetrieve: RETRIEVE,
      attributesToHighlight: highlight ? ['title', 'excerpt'] : [],
      highlightPreTag: '<mark>',
      highlightPostTag: '</mark>',
      attributesToCrop: highlight ? ['excerpt'] : [],
      cropLength: 40,
      showRankingScore: true,
      facets: params.facets ? ['source', 'type', 'tags', 'lang'] : undefined,
      ...(hybrid ? { hybrid: { semanticRatio: 0.7, embedder: embedder ?? EMBEDDER } } : {}),
    })) as {
      hits?: Record<string, unknown>[];
      estimatedTotalHits?: number;
      totalHits?: number;
      facetDistribution?: Record<string, Record<string, number>>;
    };

    const hits = res.hits ?? [];
    const results: SearchResult[] = hits.map((h) => {
      const formatted = (h._formatted ?? {}) as Partial<Record<'title' | 'excerpt', string>>;
      const { _formatted: _drop, _rankingScore, ...rest } = h;
      return {
        ...(rest as unknown as Document),
        score: typeof _rankingScore === 'number' ? _rankingScore : 0,
        // Highlighted variants are kept in dedicated fields so consumers can
        // choose between safe plain text and pre-marked HTML.
        highlighted: highlight ? { title: formatted.title, excerpt: formatted.excerpt } : undefined,
      };
    });

    const fd = res.facetDistribution;
    const facets = fd
      ? { source: fd.source, type: fd.type, tag: fd.tags, lang: fd.lang }
      : undefined;

    return {
      query: params.q,
      total: res.estimatedTotalHits ?? res.totalHits ?? results.length,
      limit,
      offset,
      took_ms: Date.now() - t0,
      results,
      facets,
      semantic: hybrid,
    };
  }
}

/** Build the Meilisearch filter expression for a set of search params. */
export function buildFilter(params: SearchParams): string[] {
  const filter: string[] = [];
  // Default to the enabled sources; an explicit `source` param overrides that
  // so a caller can still address a source it disabled in the Library.
  const active = params.source?.length ? params.source : enabledSourceNames();
  if (active.length) filter.push(`source IN [${active.map(quote).join(', ')}]`);
  if (params.type?.length) filter.push(`type IN [${params.type.map(quote).join(', ')}]`);
  if (params.lang) filter.push(`lang = ${quote(params.lang)}`);
  if (params.tag?.length) filter.push(`tags IN [${params.tag.map(quote).join(', ')}]`);
  if (params.from) filter.push(`published_at >= ${quote(params.from)}`);
  if (params.to) filter.push(`published_at <= ${quote(params.to)}`);
  return filter;
}

export function sortToMeili(sort: SearchSort): string[] {
  switch (sort) {
    case 'date_desc':
      return ['published_at:desc'];
    case 'date_asc':
      return ['published_at:asc'];
    default:
      return [];
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(Math.trunc(n) || min, min), max);
}
