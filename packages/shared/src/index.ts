/**
 * Zwep shared types — the canonical document + search contract.
 * Mirrors `docs/api.md` §Document schema and §Search response.
 *
 * Everything a client can rely on lives here. Changing a field in this file is
 * an API change: bump the version in `docs/api.md` and note it in CHANGELOG.md.
 */

export const API_VERSION = 'v1';

export type DocType = 'article' | 'page' | 'doc' | 'image' | 'video' | 'product' | 'unknown';

export const DOC_TYPES: readonly DocType[] = [
  'article',
  'page',
  'doc',
  'image',
  'video',
  'product',
  'unknown',
] as const;

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
  /** ISO 639-1 two-letter language code (e.g. `de`, `en`). */
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
  length: number; // 0..1 — content volume
  freshness: number; // 0..1 — recency of published_at (1 if none known)
  title: number; // 0..1 — title clarity
  structure: number; // 0..1 — headings / semantic structure
}

export interface SearchResult extends Document {
  /** Meilisearch ranking score, 0..1. Higher is better. */
  score: number;
  /**
   * Query terms wrapped in `<mark>`. Present only when `highlight` is on.
   * The values are HTML: render with `innerHTML`, never concatenate into text.
   */
  highlighted?: { title?: string; excerpt?: string };
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
  /** True when the response was produced by hybrid (vector) search. */
  semantic?: boolean;
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
}

/** Source definition (`docs/api.md` §admin/sources body + `config/sources.yaml`). */
export interface SourceConfig {
  name: string;
  type?: 'web' | 'google';
  seeds: string[];
  /** For `type: 'google'` — search Google for these queries. */
  queries?: string[];
  allowedDomains: string[];
  sitemap?: string;
  schedule?: string;
  maxDepth?: number;
  maxPages?: number;
  /** If false, excluded from all searches (default true). */
  enabled?: boolean;
  /** Human-friendly display name, shown in the Library UI. */
  label?: string;
  description?: string;
}

/** Shape of every error body the API returns. */
export interface ApiError {
  error: {
    code: string;
    message: string;
    status: number;
  };
}

/** Result of one crawl run, returned by the CLI and the admin API. */
export interface CrawlSummary {
  source: string;
  pages: number;
  skipped: number;
  failed: number;
  indexed: number;
  seconds: number;
}

export interface CrawlTask {
  id: string;
  source: string;
  status: 'running' | 'done' | 'error';
  startedAt: string;
  finishedAt?: string;
  summary?: CrawlSummary;
  error?: string;
}
