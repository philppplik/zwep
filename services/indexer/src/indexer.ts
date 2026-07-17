import { getAdapter, type IndexAdapter } from './meili.ts';
import { loadSources } from '@zwep/config';
import type { Document, SearchParams, SearchResponse, SearchResult, SearchSort } from '@zwep/shared';

/** Returns the names of all enabled sources (excluded from search if disabled). */
export function enabledSourceNames(): string[] {
  return loadSources()
    .filter((s) => s.enabled !== false)
    .map((s) => s.name);
}
export class Indexer {
  private adapter: IndexAdapter;

  constructor(adapter: IndexAdapter = getAdapter()) {
    this.adapter = adapter;
  }

  async ensureIndex() {
    await this.adapter.ensureIndex();
  }

  async index(docs: Document[]) {
    await this.adapter.upsert(docs);
  }

  async get(id: string): Promise<Document | null> {
    return this.adapter.get(id);
  }

  async count(): Promise<number> {
    const res = await (this.adapter as any).index.search('', { limit: 0 });
    return res.estimatedTotalHits ?? 0;
  }

  async search(params: SearchParams): Promise<SearchResponse> {
    const t0 = Date.now();
    const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
    const offset = Math.max(params.offset ?? 0, 0);

    const filter: string[] = [];
    // Default: only search enabled sources (unless caller pins specific sources)
    const activeSources = params.source?.length ? params.source : enabledSourceNames();
    if (activeSources.length) filter.push(`source IN [${activeSources.map((s) => `"${s}"`).join(', ')}]`);
    if (params.type?.length) filter.push(`type IN [${params.type.map((s) => `"${s}"`).join(', ')}]`);
    if (params.lang) filter.push(`lang = "${params.lang}"`);
    if (params.tag?.length) filter.push(`tags IN [${params.tag.map((s) => `"${s}"`).join(', ')}]`);
    if (params.from) filter.push(`published_at >= "${params.from}"`);
    if (params.to) filter.push(`published_at <= "${params.to}"`);

    const sort = sortToMeili(params.sort ?? 'relevance');

    const hybrid = params.semantic === true;
    const fuzzy = params.fuzzy !== false; // default ON
    const res: any = await (this.adapter as any).index.search(params.q, {
      limit,
      offset,
      filter: filter.length ? filter : undefined,
      sort: sort.length ? sort : undefined,
      attributesToHighlight: params.highlight === false ? [] : ['title', 'excerpt'],
      attributesToCrop: ['excerpt'],
      cropLength: 40,
      facets: params.facets ? ['source', 'type', 'tags', 'lang'] : undefined,
      // fuzzy typo-tolerance is ON by default in index settings; disable per-query if requested
      ...(fuzzy ? {} : { disableTypoTolerance: true }),
      // semantic / hybrid vector search (only works if embedder configured)
      ...(hybrid
        ? {
            hybrid: { semanticRatio: 0.7 },
            retrieveVectors: false,
          }
        : {}),
    });
    if (process.env.ZWEP_DEBUG) console.error('[indexer] hybrid=', hybrid, 'filter=', filter);

    const results: SearchResult[] = res.hits.map((h: any) => ({
      ...h,
      score: h._score,
    }));

    const facets = res.facetDistribution
      ? {
          source: res.facetDistribution.source,
          type: res.facetDistribution.type,
          tag: res.facetDistribution.tags,
          lang: res.facetDistribution.lang,
        }
      : undefined;

    return {
      query: params.q,
      total: res.estimatedTotalHits ?? results.length,
      limit,
      offset,
      took_ms: Date.now() - t0,
      results,
      facets,
    };
  }
}

function sortToMeili(sort: SearchSort): string[] {
  switch (sort) {
    case 'date_desc':
      return ['published_at:desc'];
    case 'date_asc':
      return ['published_at:asc'];
    default:
      return [];
  }
}
