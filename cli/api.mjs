/**
 * Thin HTTP client for the Zwep API, shared by the CLI and the MCP server.
 *
 * The CLI talks to Zwep over HTTP rather than importing the services directly.
 * That means one binary works against a local dev server, a container, or a
 * Zwep running on another machine — and it never needs Meilisearch, Playwright
 * or native modules installed locally.
 */
import process from 'node:process';

export const DEFAULT_BASE = process.env.ZWEP_API ?? 'http://127.0.0.1:8080';

export class ZwepApiError extends Error {
  constructor(message, { status = 0, code = 'error', url = '' } = {}) {
    super(message);
    this.name = 'ZwepApiError';
    this.status = status;
    this.code = code;
    this.url = url;
  }
}

export class ZwepClient {
  constructor({
    base = DEFAULT_BASE,
    adminKey = process.env.ZWEP_ADMIN_KEY,
    timeoutMs = 30_000,
  } = {}) {
    this.base = String(base).replace(/\/+$/, '');
    this.adminKey = adminKey;
    this.timeoutMs = timeoutMs;
  }

  async request(path, { method = 'GET', body, admin = false, timeoutMs } = {}) {
    const url = `${this.base}${path}`;
    const headers = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (admin) {
      if (!this.adminKey) {
        throw new ZwepApiError('No admin key. Set ZWEP_ADMIN_KEY or pass --admin-key.', {
          code: 'no_admin_key',
          url,
        });
      }
      // Sent as a header, never as a query parameter: query strings end up in
      // proxy logs and shell history.
      headers['x-admin-key'] = this.adminKey;
    }

    let res;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs ?? this.timeoutMs),
      });
    } catch (e) {
      const hint =
        e?.name === 'TimeoutError'
          ? `Timed out after ${(timeoutMs ?? this.timeoutMs) / 1000}s.`
          : `Cannot reach the Zwep API at ${this.base}.`;
      throw new ZwepApiError(`${hint} Start one with: zwep up`, {
        code: 'unreachable',
        url,
      });
    }

    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }
    if (!res.ok) {
      const err = data?.error ?? {};
      throw new ZwepApiError(err.message || `Request failed with ${res.status}`, {
        status: res.status,
        code: err.code || String(res.status),
        url,
      });
    }
    return data;
  }

  // --- public ---
  health() {
    return this.request('/healthz');
  }

  stats() {
    return this.request('/v1/stats');
  }

  search(params) {
    return this.request(`/v1/search?${query(params)}`);
  }

  suggest(params) {
    return this.request(`/v1/suggest?${query(params)}`);
  }

  document(id) {
    return this.request(`/v1/document/${encodeURIComponent(id)}`);
  }

  graph(q) {
    return this.request(`/v1/graph?${query({ q })}`);
  }

  overview(q) {
    return this.request(`/v1/overview?${query({ q })}`, { timeoutMs: 120_000 });
  }

  // --- admin ---
  listSources() {
    return this.request('/v1/admin/sources', { admin: true });
  }

  upsertSource(source) {
    return this.request('/v1/admin/sources', { method: 'PUT', admin: true, body: source });
  }

  deleteSource(name, purge = false) {
    const suffix = purge ? '?purge=true' : '';
    return this.request(`/v1/admin/sources/${encodeURIComponent(name)}${suffix}`, {
      method: 'DELETE',
      admin: true,
    });
  }

  startCrawl(source, maxPages) {
    return this.request('/v1/admin/crawl', {
      method: 'POST',
      admin: true,
      body: { source, maxPages },
    });
  }

  crawlStatus(taskId) {
    return this.request(`/v1/admin/crawl/${encodeURIComponent(taskId)}`, { admin: true });
  }

  crawlAll(maxPages) {
    return this.request('/v1/admin/crawl-all', { method: 'POST', admin: true, body: { maxPages } });
  }

  batchStatus(batchId) {
    return this.request(`/v1/admin/crawl-all/${encodeURIComponent(batchId)}`, { admin: true });
  }

  crawlUrl(url) {
    return this.request('/v1/admin/crawl-url', { method: 'POST', admin: true, body: { url } });
  }

  deindexAll() {
    return this.request('/v1/admin/deindex-all', { method: 'POST', admin: true });
  }
}

/** Build a query string, dropping undefined/empty values and joining arrays. */
export function query(params = {}) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  return sp.toString();
}

/** Poll a crawl task until it finishes. */
export async function waitForTask(client, taskId, { intervalMs = 1200, onTick } = {}) {
  for (;;) {
    const { task } = await client.crawlStatus(taskId);
    onTick?.(task);
    if (task.status !== 'running') return task;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
