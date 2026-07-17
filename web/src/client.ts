import type { SearchResponse, SearchResult, SearchParams } from '@zwep/shared';

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
