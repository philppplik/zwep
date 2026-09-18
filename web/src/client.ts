import type {
  SearchResponse,
  SearchResult,
  SearchParams,
  SourceConfig,
  CrawlTask,
  Document,
} from '@zwep/shared';

/**
 * Typed browser client for the Zwep API.
 *
 * In dev, Vite proxies `/v1/*` to the API on :8080; in production the API sits
 * behind the same origin. Nothing here hard-codes a host, so the built bundle
 * works unchanged behind any reverse proxy.
 */

const BASE = '/v1';

/** Requests are abandoned after this long so the UI never hangs forever. */
const TIMEOUT_MS = 30_000;
const LONG_TIMEOUT_MS = 120_000;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 0, code = 'error') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  /** True when the API could not be reached at all (as opposed to a 4xx/5xx). */
  get isOffline(): boolean {
    return this.status === 0;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  adminKey?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  // The admin key travels in a header, never in the query string: query
  // strings leak into browser history, referrers and proxy logs.
  if (opts.adminKey) headers['x-admin-key'] = opts.adminKey;

  const timeout = AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError' && opts.signal?.aborted) throw e;
    throw new ApiError('Cannot reach the search service. Is the API running?', 0, 'offline');
  }

  if (res.status === 204) return undefined as T;

  let payload: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!res.ok) {
    const err = (payload as { error?: { message?: string; code?: string } } | null)?.error;
    throw new ApiError(err?.message ?? `Request failed (${res.status})`, res.status, err?.code ?? String(res.status));
  }
  return payload as T;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SuggestItem {
  text: string;
  url: string;
  type: string;
}

export async function search(
  params: Partial<SearchParams> & { q: string },
  signal?: AbortSignal,
): Promise<SearchResponse> {
  const sp = new URLSearchParams({ q: params.q });
  if (params.limit) sp.set('limit', String(params.limit));
  if (params.offset) sp.set('offset', String(params.offset));
  if (params.source?.length) sp.set('source', params.source.join(','));
  if (params.type?.length) sp.set('type', params.type.join(','));
  if (params.tag?.length) sp.set('tag', params.tag.join(','));
  if (params.lang) sp.set('lang', params.lang);
  if (params.from) sp.set('from', params.from);
  if (params.to) sp.set('to', params.to);
  if (params.sort) sp.set('sort', params.sort);
  if (params.facets) sp.set('facets', 'true');
  if (params.highlight === false) sp.set('highlight', 'false');
  if (params.semantic) sp.set('semantic', 'true');
  return request<SearchResponse>(`/search?${sp}`, { signal });
}

export async function suggest(q: string, limit = 8, signal?: AbortSignal): Promise<SuggestItem[]> {
  const sp = new URLSearchParams({ q, limit: String(limit) });
  const r = await request<{ suggestions: SuggestItem[] }>(`/suggest?${sp}`, { signal });
  return r.suggestions ?? [];
}

export function getDocument(id: string): Promise<Document> {
  return request<Document>(`/document/${encodeURIComponent(id)}`);
}

export interface StatsResponse {
  ok: boolean;
  indexed: number;
  sources: number;
  sourcesEnabled: number;
  llm: string;
  runningCrawls: number;
}

export function stats(): Promise<StatsResponse> {
  return request<StatsResponse>('/stats');
}

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  doc_count: number;
}

export interface GraphEdge {
  src: string;
  dst: string;
  weight: number;
  kind: string;
}

export interface GraphResponse {
  ok: boolean;
  query: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: { entities: number; edges: number };
}

export function graph(q: string, signal?: AbortSignal): Promise<GraphResponse> {
  return request<GraphResponse>(`/graph?q=${encodeURIComponent(q)}`, { signal });
}

export interface OverviewResponse {
  ok: boolean;
  query: string;
  overview: string;
  cached?: boolean;
  sources: { title: string; url: string; source: string }[];
}

export function overview(q: string, signal?: AbortSignal): Promise<OverviewResponse> {
  return request<OverviewResponse>(`/overview?q=${encodeURIComponent(q)}`, {
    timeoutMs: LONG_TIMEOUT_MS,
    signal,
  });
}

export interface ModelInfo {
  id: string;
  name: string;
  size?: number;
  context_length?: number;
}

/** Model lists are optional niceties — an unreachable provider yields []. */
export async function ollamaModels(): Promise<ModelInfo[]> {
  try {
    return (await request<{ models: ModelInfo[] }>('/ollama-models')).models ?? [];
  } catch {
    return [];
  }
}

export async function openrouterModels(): Promise<ModelInfo[]> {
  try {
    return (await request<{ models: ModelInfo[] }>('/openrouter-models')).models ?? [];
  } catch {
    return [];
  }
}

export function pushSettings(
  adminKey: string,
  settings: {
    llmProvider: string;
    ollamaLlmModel?: string;
    openrouterLlmModel?: string;
    openrouterLlmKey?: string;
  },
): Promise<{ ok: boolean; llmProvider: string }> {
  return request('/settings', { method: 'POST', adminKey, body: settings });
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export type { CrawlTask };

export interface AdminConfig {
  googleProxyEnabled: boolean;
  llmProvider: string;
  maxConcurrentCrawls: number;
}

export function adminConfig(adminKey: string): Promise<AdminConfig> {
  return request<AdminConfig>('/admin/config', { adminKey });
}

export async function adminListSources(adminKey: string): Promise<SourceConfig[]> {
  return (await request<{ sources: SourceConfig[] }>('/admin/sources', { adminKey })).sources;
}

export async function adminUpsertSource(
  adminKey: string,
  src: SourceConfig,
): Promise<SourceConfig> {
  const r = await request<{ source: SourceConfig }>('/admin/sources', {
    method: 'PUT',
    adminKey,
    body: src,
  });
  return r.source;
}

export function adminDeleteSource(
  adminKey: string,
  name: string,
  purge = false,
): Promise<{ ok: boolean; purged: boolean }> {
  const suffix = purge ? '?purge=true' : '';
  return request(`/admin/sources/${encodeURIComponent(name)}${suffix}`, {
    method: 'DELETE',
    adminKey,
  });
}

export async function adminCrawl(
  adminKey: string,
  source: string,
  maxPages?: number,
): Promise<string> {
  const r = await request<{ taskId: string }>('/admin/crawl', {
    method: 'POST',
    adminKey,
    body: { source, maxPages },
  });
  return r.taskId;
}

export async function adminCrawlStatus(adminKey: string, taskId: string): Promise<CrawlTask> {
  const r = await request<{ task: CrawlTask }>(`/admin/crawl/${encodeURIComponent(taskId)}`, {
    adminKey,
  });
  return r.task;
}

export function adminCrawlAll(
  adminKey: string,
  maxPages?: number,
): Promise<{ ok: boolean; batchId: string; count: number }> {
  return request('/admin/crawl-all', { method: 'POST', adminKey, body: { maxPages } });
}

export function adminCrawlAllStatus(
  adminKey: string,
  batchId: string,
): Promise<{ batch: CrawlTask[]; done: number; total: number }> {
  return request(`/admin/crawl-all/${encodeURIComponent(batchId)}`, { adminKey });
}

export function adminCrawlUrl(
  adminKey: string,
  url: string,
): Promise<{ ok: boolean; taskId: string; source: string }> {
  return request('/admin/crawl-url', { method: 'POST', adminKey, body: { url } });
}

export function adminDeindexAll(adminKey: string): Promise<{ ok: boolean; message: string }> {
  return request('/admin/deindex-all', { method: 'POST', adminKey });
}

export type { SearchResult };
