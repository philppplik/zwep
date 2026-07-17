import type { SearchResponse, SearchResult, SearchParams, SourceConfig } from '@zwep/shared';

const BASE = '/v1';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface SuggestItem {
  text: string;
  url: string;
  type: string;
}

export async function search(params: Partial<SearchParams> & { q: string }): Promise<SearchResponse> {
  const sp = new URLSearchParams();
  sp.set('q', params.q);
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
  if (params.fuzzy === false) sp.set('fuzzy', 'false');
  return getJson<SearchResponse>(`${BASE}/search?${sp.toString()}`);
}

export async function suggest(q: string, source?: string, limit = 8): Promise<SuggestItem[]> {
  const sp = new URLSearchParams({ q });
  if (source) sp.set('source', source);
  sp.set('limit', String(limit));
  const r = await getJson<{ query: string; suggestions: SuggestItem[] }>(`${BASE}/suggest?${sp.toString()}`);
  return r.suggestions;
}

export async function getDocument(id: string): Promise<SearchResult | null> {
  try {
    return await getJson<SearchResult>(`${BASE}/document/${encodeURIComponent(id)}`);
  } catch {
    return null;
  }
}

export async function stats(): Promise<{ ok: boolean; indexed: number }> {
  return getJson(`${BASE}/stats`);
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

export async function graph(q: string): Promise<GraphResponse> {
  return getJson<GraphResponse>(`${BASE}/graph?q=${encodeURIComponent(q)}`);
}

export interface OverviewResponse {
  ok: boolean;
  query: string;
  overview: string;
  cached?: boolean;
  sources: { title: string; url: string; source: string }[];
}

export async function overview(q: string): Promise<OverviewResponse> {
  return getJson<OverviewResponse>(`${BASE}/overview?q=${encodeURIComponent(q)}`);
}

export interface ModelInfo {
  id: string;
  name: string;
  size?: number;
  context_length?: number;
}

export async function ollamaModels(): Promise<ModelInfo[]> {
  try {
    const r = await getJson<{ ok: boolean; models: ModelInfo[] }>(`${BASE}/ollama-models`);
    return r.models || [];
  } catch {
    return [];
  }
}

export async function openrouterModels(): Promise<ModelInfo[]> {
  try {
    const r = await getJson<{ ok: boolean; models: ModelInfo[] }>(`${BASE}/openrouter-models`);
    return r.models || [];
  } catch {
    return [];
  }
}

// ---------- Admin ----------
export interface CrawlTask {
  id: string;
  source: string;
  status: 'running' | 'done' | 'error';
  startedAt: string;
  finishedAt?: string;
  summary?: { pages: number; skipped: number; failed: number; indexed: number; seconds: number };
  error?: string;
}

export async function adminListSources(adminKey: string): Promise<SourceConfig[]> {
  const r = await getJson<{ sources: SourceConfig[] }>(`${BASE}/admin/sources?admin_key=${encodeURIComponent(adminKey)}`);
  return r.sources;
}

export async function adminUpsertSource(adminKey: string, src: SourceConfig): Promise<SourceConfig> {
  const res = await fetch(`${BASE}/admin/sources?admin_key=${encodeURIComponent(adminKey)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(src),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b?.error?.message || `Save failed: ${res.status}`);
  }
  return (await res.json()).source;
}

export async function adminDeleteSource(adminKey: string, name: string): Promise<void> {
  const res = await fetch(`${BASE}/admin/sources/${encodeURIComponent(name)}?admin_key=${encodeURIComponent(adminKey)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
}

export async function adminCrawl(adminKey: string, source: string, maxPages?: number): Promise<string> {
  const res = await fetch(`${BASE}/admin/crawl?admin_key=${encodeURIComponent(adminKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source, maxPages }),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b?.error?.message || `Crawl failed: ${res.status}`);
  }
  return (await res.json()).taskId;
}

export async function adminCrawlStatus(adminKey: string, taskId: string): Promise<CrawlTask> {
  const r = await getJson<{ task: CrawlTask }>(`${BASE}/admin/crawl/${encodeURIComponent(taskId)}?admin_key=${encodeURIComponent(adminKey)}`);
  return r.task;
}

export async function adminCrawlAll(adminKey: string, maxPages?: number): Promise<{ ok: boolean; batchId: string; count: number }> {
  const res = await fetch(`${BASE}/admin/crawl-all?admin_key=${encodeURIComponent(adminKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ maxPages }),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b?.error?.message || `Crawl-all failed: ${res.status}`);
  }
  return res.json();
}

export async function adminCrawlUrl(adminKey: string, url: string): Promise<{ ok: boolean; taskId: string; source: string }> {
  const res = await fetch(`${BASE}/admin/crawl-url?admin_key=${encodeURIComponent(adminKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b?.error?.message || `Crawl-URL failed: ${res.status}`);
  }
  return res.json();
}

export async function adminDeindexAll(adminKey: string): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(`${BASE}/admin/deindex-all?admin_key=${encodeURIComponent(adminKey)}`, {
    method: 'POST',
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b?.error?.message || `Deindex failed: ${res.status}`);
  }
  return res.json();
}

export async function adminCrawlAllStatus(adminKey: string, batchId: string): Promise<{ batch: CrawlTask[] }> {
  return getJson<{ batch: CrawlTask[] }>(`${BASE}/admin/crawl-all/${encodeURIComponent(batchId)}?admin_key=${encodeURIComponent(adminKey)}`);
}

export interface AdminConfig {
  googleProxyEnabled: boolean;
}
export async function adminConfig(adminKey: string): Promise<AdminConfig> {
  const r = await getJson<AdminConfig>(`${BASE}/admin/config?admin_key=${encodeURIComponent(adminKey)}`);
  return r;
}
