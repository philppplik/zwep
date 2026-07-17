/**
 * Zwep shared types — the canonical document + search contract.
 * Mirrors docs/api.md §Document schema and §Search response.
 */

export type DocType = 'article' | 'page' | 'doc' | 'image' | 'video' | 'product' | 'unknown';

export interface Document {
  id: string;
  url: string;
  canonical_url: string;
  title: string;
  excerpt: string;
  content: string;
  headings: string[];
  source: string;
  type: DocType;
  lang: string;
  author?: string;
  published_at?: string;
  crawled_at: string;
  content_hash: string;
  tags: string[];
  favicon?: string;
  structured?: Record<string, unknown> | null;
  quality?: QualityScore;
}

/** Quality scoring (0..1 composite + component breakdown). */
export interface QualityScore {
  score: number;
  length: number;      // 0..1 — content volume
  freshness: number;   // 0..1 — recency of published_at (1 if none known)
  title: number;       // 0..1 — title clarity
  structure: number;   // 0..1 — headings / semantic structure
}

export interface SearchResult extends Document {
  score: number;
}

export interface FacetCounts {
  source?: Record<string, number>;
  type?: Record<string, number>;
  tag?: Record<string, number>;
  lang?: Record<string, number>;
}

export interface SearchResponse {
  query: string;
  total: number;
  limit: number;
  offset: number;
  took_ms: number;
  results: SearchResult[];
  facets?: FacetCounts;
}

export interface Suggestion {
  text: string;
  url: string | null;
  type: DocType | 'term';
}

export interface SuggestResponse {
  query: string;
  suggestions: Suggestion[];
}

export type SearchSort = 'relevance' | 'date_desc' | 'date_asc';

export interface SearchParams {
  q: string;
  limit?: number;
  offset?: number;
  source?: string[];
  type?: string[];
  lang?: string;
  tag?: string[];
  from?: string;
  to?: string;
  sort?: SearchSort;
  facets?: boolean;
  highlight?: boolean;
  semantic?: boolean;
  fuzzy?: boolean;
}

/** Source definition (docs/api.md §admin/sources body + sources.yaml). */
export interface SourceConfig {
  name: string;
  type?: 'web' | 'google';
  seeds: string[];
  queries?: string[];      // for type: 'google' — search Google for these queries
  allowedDomains: string[];
  sitemap?: string;
  schedule?: string;
  maxDepth?: number;
  maxPages?: number;
}
