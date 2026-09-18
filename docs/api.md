# Zwep API reference

The public HTTP contract for the Zwep search service. Every client — the web
UI, the `zwep` CLI, the MCP server, your own scripts — talks to this API and
never to Meilisearch directly. That indirection is what lets the index engine
change without breaking anything.

**Base URL:** `http://localhost:8080/v1` in development.
**Format:** JSON, UTF-8.
**Auth:** none for read endpoints; an admin key for everything that writes.

---

## Contents

- [Conventions](#conventions)
- [Authentication](#authentication)
- [Errors](#errors)
- **Search**
  - [`GET /v1/search`](#get-v1search)
  - [`GET /v1/suggest`](#get-v1suggest)
  - [`GET /v1/document/:id`](#get-v1documentid)
  - [`GET /v1/graph`](#get-v1graph)
  - [`GET /v1/overview`](#get-v1overview)
  - [`GET /v1/stats`](#get-v1stats)
- **Admin**
  - [Sources](#sources)
  - [Crawling](#crawling)
  - [Maintenance](#maintenance)
  - [Runtime settings](#runtime-settings)
- [Schemas](#schemas)

---

## Conventions

| | |
| --- | --- |
| **Versioning** | Path-prefixed (`/v1`). A breaking change bumps the prefix. |
| **Content type** | `application/json; charset=utf-8`. |
| **Time** | ISO 8601, UTC. |
| **Repeated parameters** | Either repeated (`?type=a&type=b`) or comma-separated (`?type=a,b`). Both work everywhere. |
| **Booleans** | `true`/`1` for on, anything else for off. |
| **Rate limits** | Per client IP, `API_RATE_LIMIT` per minute (default 120). Exceeding it returns `429` with a `Retry-After` header. `/healthz` is exempt. |
| **CORS** | Controlled by `API_CORS_ORIGINS`. `*` in development. |

### `GET /healthz`

Liveness probe. Never rate-limited, never authenticated.

```json
{ "ok": true, "service": "zwep-api", "version": "v1" }
```

---

## Authentication

Read endpoints are open. Every mutating endpoint requires the admin key from
`ZWEP_ADMIN_KEY`, sent as a header:

```bash
curl -H "x-admin-key: $ZWEP_ADMIN_KEY" http://localhost:8080/v1/admin/sources
```

A query parameter (`?admin_key=…`) is still accepted for backwards
compatibility, but **prefer the header**: query strings end up in browser
history, `Referer` headers and proxy logs. The key is compared in constant time.

A missing or wrong key returns `401` with code `unauthorized`.

---

## Errors

Every error uses the same envelope, so a client can branch on `code` without
parsing prose:

```json
{
  "error": {
    "code": "invalid_query",
    "message": "Parameter 'q' is required.",
    "status": 400
  }
}
```

| Code | Status | Meaning |
| --- | --- | --- |
| `invalid_query` | 400 | A required parameter is missing or empty. |
| `invalid` | 400 | The body failed validation. `message` lists each field. |
| `invalid_url` | 400 | Not a valid `http(s)` URL. |
| `no_sources` | 400 | The operation needs at least one enabled source. |
| `unauthorized` | 401 | Missing or wrong admin key. |
| `google_proxy_disabled` | 403 | A `google` source was submitted while `GOOGLE_PROXY_ENABLED=false`. |
| `not_found` | 404 | No such document, source or task. |
| `rate_limited` | 429 | Too many requests. See `Retry-After`. |
| `too_many_crawls` | 429 | The per-process crawl limit is reached. |
| `deindex_failed` | 500 | The index rejected the delete. |
| `index_unavailable` | 503 | Meilisearch is unreachable. |
| `graph_unavailable` | 503 | The knowledge-graph database could not be opened. |
| `llm_unavailable` | 503 | No LLM provider is configured or reachable. |
| `llm_error` | 503 | The provider was reached but failed. |
| `ollama_unavailable` / `openrouter_unavailable` | 503 | Model listing failed. |

---

## `GET /v1/search`

Full-text search over the index.

### Parameters

| Name | Type | Default | Notes |
| --- | --- | --- | --- |
| `q` | string | **required** | The query. Whitespace-only is rejected. |
| `limit` | int | `20` | 1–100. Values above the maximum are clamped, not rejected. |
| `offset` | int | `0` | Pagination offset. Negative values become `0`. |
| `source` | string[] | enabled sources | Restrict to these sources. An explicit value overrides the enabled/disabled state, so you can query a source you disabled. |
| `type` | string[] | – | `article`, `page`, `doc`, `image`, `video`, `product`, `unknown`. |
| `lang` | string | – | ISO 639-1 (`de`, `en`). `und` means undetermined. |
| `tag` | string[] | – | Filter by tag. |
| `from` / `to` | date | – | Published on or after / before (`YYYY-MM-DD`). |
| `sort` | enum | `relevance` | `relevance`, `date_desc`, `date_asc`. |
| `facets` | bool | `false` | Include facet counts. |
| `highlight` | bool | `true` | Return `<mark>`-wrapped variants of the title and excerpt. |
| `semantic` | bool | `false` | Hybrid vector search. Ignored — and reported back as `false` — when no embedder is configured. |

### Example

```bash
curl "http://localhost:8080/v1/search?q=klimapolitik&lang=de&limit=5&facets=true"
```

### Response `200`

```json
{
  "query": "klimapolitik",
  "total": 128,
  "limit": 5,
  "offset": 0,
  "took_ms": 12,
  "semantic": false,
  "results": [
    {
      "id": "news_9f2a1c4e7b3d5a60",
      "url": "https://example.com/artikel/klimapolitik-2026",
      "canonical_url": "https://example.com/artikel/klimapolitik-2026",
      "title": "Klimapolitik 2026: Was sich ändert",
      "excerpt": "Ein Überblick über die neuen klimapolitischen Maßnahmen …",
      "source": "news",
      "type": "article",
      "lang": "de",
      "published_at": "2026-01-15T00:00:00.000Z",
      "crawled_at": "2026-09-18T09:12:44.000Z",
      "tags": ["klima", "politik"],
      "favicon": "https://example.com/favicon.ico",
      "quality": {
        "score": 0.82,
        "length": 0.91,
        "freshness": 0.86,
        "title": 0.85,
        "structure": 0.6
      },
      "score": 0.97,
      "highlighted": {
        "title": "<mark>Klimapolitik</mark> 2026: Was sich ändert",
        "excerpt": "Ein Überblick über die neuen <mark>klimapolitisch</mark>en …"
      }
    }
  ],
  "facets": {
    "source": { "news": 96, "blog": 32 },
    "type": { "article": 120, "page": 8 },
    "tag": { "klima": 74 },
    "lang": { "de": 128 }
  }
}
```

**On `highlighted`.** It is HTML, and the surrounding text comes from crawled
pages. Render it with `innerHTML` only after allowing nothing but `<mark>`
through — `web/src/dom.ts` exports `sanitizeHighlight` for exactly this. The
plain `title` and `excerpt` fields are always safe text.

**On `total`.** Meilisearch reports an estimate for large result sets. Treat it
as an approximation for pagination, not an exact count.

---

## `GET /v1/suggest`

Title autocompletions for a partial query. Optimised for latency, so it returns
no highlights, facets or bodies.

| Name | Type | Default | Notes |
| --- | --- | --- | --- |
| `q` | string | **required** | The partial query. |
| `limit` | int | `8` | Capped at 20. |
| `source` | string[] | – | Restrict to these sources. |

```json
{
  "query": "klima",
  "suggestions": [
    { "text": "Klimapolitik 2026: Was sich ändert", "url": "https://…", "type": "article" }
  ]
}
```

---

## `GET /v1/document/:id`

One indexed document in full, including its extracted body text. `404` with
`not_found` if the id is unknown.

The id comes from a search result. It is derived from the source name and the
canonical URL, so it is **stable across re-crawls** — you can store it.

---

## `GET /v1/graph`

The knowledge-graph neighbourhood around a term: entities whose label contains
the query, plus their one-hop co-mention neighbours.

| Name | Type | Notes |
| --- | --- | --- |
| `q` | string | Required unless `export=json`. |
| `export` | `json` | Return the entire graph as a file download instead. |

```json
{
  "ok": true,
  "query": "klima",
  "nodes": [{ "id": "klimapolitik", "label": "klimapolitik", "type": "concept", "doc_count": 42 }],
  "edges": [{ "src": "klimapolitik", "dst": "bundestag", "weight": 7, "kind": "co-mention" }],
  "stats": { "entities": 1843, "edges": 9021 }
}
```

Edges are undirected and stored once, with `src` sorted before `dst`. `weight`
is the number of documents mentioning both.

---

## `GET /v1/overview`

An LLM-generated summary of the top results. Requires `LLM_PROVIDER` to be set
and the provider to be reachable; otherwise `503 llm_unavailable`.

```json
{
  "ok": true,
  "query": "klimapolitik",
  "overview": "The debate centres on three measures…\n\n1. …",
  "cached": false,
  "sources": [{ "title": "…", "url": "https://…", "source": "news" }]
}
```

The summary is generated from the top five results only, and the model is
instructed to use nothing else and to answer in the query's language. Results
are cached in SQLite for `OVERVIEW_TTL_HOURS` (default 168), keyed by provider,
model and query — `cached: true` means no tokens were spent.

An empty result set returns `200` with `overview: ""`, not an error.

---

## `GET /v1/stats`

Index health. Useful as a readiness probe, since it fails when Meilisearch is
down while `/healthz` does not.

```json
{
  "ok": true,
  "indexed": 12843,
  "sources": 9,
  "sourcesEnabled": 7,
  "llm": "ollama",
  "runningCrawls": 0
}
```

---

## Sources

All admin endpoints require the key. See [Authentication](#authentication).

### `GET /v1/admin/sources`

```json
{ "sources": [ /* SourceConfig[] */ ] }
```

### `GET /v1/admin/sources/:name`

One source, or `404`.

### `PUT /v1/admin/sources`

Create or update. The body is a full `SourceConfig`; an existing source is
**merged**, so omitted fields keep their stored value.

```bash
curl -X PUT http://localhost:8080/v1/admin/sources \
  -H "x-admin-key: $ZWEP_ADMIN_KEY" \
  -H "content-type: application/json" \
  -d '{
    "name": "my-blog",
    "type": "web",
    "seeds": ["https://example.com/blog"],
    "allowedDomains": ["example.com"],
    "maxPages": 200
  }'
```

Validation:

- `name` must match `[a-zA-Z0-9][a-zA-Z0-9._-]*`, at most 64 characters, because
  it becomes part of the document id.
- A `web` source needs at least one seed; a `google` source needs at least one
  query.
- Every seed must be a valid URL.
- A `google` source is rejected with `403 google_proxy_disabled` unless
  `GOOGLE_PROXY_ENABLED=true`.

Returns `{ "ok": true, "source": { … } }`.

### `DELETE /v1/admin/sources/:name`

| Parameter | Default | Notes |
| --- | --- | --- |
| `purge` | `false` | Also delete that source's documents from the index. |

```json
{ "ok": true, "purged": true }
```

---

## Crawling

### `POST /v1/admin/crawl`

Starts a crawl in the background and returns immediately.

```json
{ "source": "my-blog", "maxPages": 50 }
```

`202 Accepted` → `{ "ok": true, "taskId": "task_m1x2y3_ab12cd" }`

Returns `429 too_many_crawls` when four crawls are already running in this
process.

### `GET /v1/admin/crawl/:id`

Poll a task. Tasks are in-memory and kept for an hour after they finish; after
that the id returns `404`.

```json
{
  "task": {
    "id": "task_m1x2y3_ab12cd",
    "source": "my-blog",
    "status": "done",
    "startedAt": "2026-09-18T09:00:00.000Z",
    "finishedAt": "2026-09-18T09:01:12.000Z",
    "summary": { "source": "my-blog", "pages": 47, "skipped": 3, "failed": 0, "indexed": 44, "seconds": 72.4 }
  }
}
```

`status` is `running`, `done` or `error`. On `error`, `error` holds the message.

Reading the summary: `pages` were fetched, `skipped` were refused by
`robots.txt` or were not HTML, `failed` errored, and `indexed` is how many
produced a usable document. `pages` above `indexed` is normal — navigation
shells and stubs are filtered out.

### `POST /v1/admin/crawl-all`

Crawls every enabled source, sequentially so a large batch cannot saturate the
index.

`202 Accepted` → `{ "ok": true, "batchId": "batch_…", "count": 7 }`

### `GET /v1/admin/crawl-all/:id`

```json
{ "batch": [ /* CrawlTask[] */ ], "done": 3, "total": 7 }
```

### `POST /v1/admin/crawl-url`

Index a single page ad hoc. Creates a one-page source named
`url_<domain>_<timestamp>` so the page can be re-crawled or removed later.

```json
{ "url": "https://example.com/article" }
```

`202 Accepted` → `{ "ok": true, "taskId": "task_…", "source": "url_example.com_m1x2y3" }`

Only `http` and `https` are accepted.

---

## Maintenance

### `POST /v1/admin/deindex-all`

Deletes every document. Sources stay configured. Not reversible.

### `POST /v1/admin/clear-cache`

Drops all cached AI overviews.

```json
{ "ok": true, "cleared": 42 }
```

### `GET /v1/admin/config`

```json
{ "googleProxyEnabled": false, "llmProvider": "ollama", "maxConcurrentCrawls": 4 }
```

---

## Runtime settings

### `POST /v1/settings`

Change the LLM provider without editing `.env` and restarting. **Admin-gated** —
it accepts an API key, so it is protected like every other mutating endpoint.

```json
{
  "llmProvider": "ollama",
  "ollamaLlmModel": "llama3.1",
  "openrouterLlmModel": "openai/gpt-4o-mini",
  "openrouterLlmKey": "sk-or-…"
}
```

Returns `{ "ok": true, "llmProvider": "ollama" }`. The override lives in memory
and is lost on restart; `.env` remains the durable source of truth.

### `GET /v1/ollama-models`, `GET /v1/openrouter-models`

List available models, for the Settings dropdowns. `503` when the provider is
unreachable — the UI falls back to a preset list.

---

## Schemas

### Document

```ts
interface Document {
  id: string;              // "{source}_{sha256(canonicalUrl)[0..15]}" — stable
  url: string;             // as fetched
  canonical_url: string;   // normalized: no fragment, no www, no tracking params
  title: string;
  excerpt: string;         // meta description, else the first ~220 characters
  content: string;         // extracted body text, capped at 120k characters
  headings: string[];      // first 12 h1/h2/h3
  source: string;
  type: 'article' | 'page' | 'doc' | 'image' | 'video' | 'product' | 'unknown';
  lang: string;            // ISO 639-1, or 'und'
  author?: string;
  published_at?: string;   // ISO 8601; absent when unknown or implausible
  crawled_at: string;      // ISO 8601
  content_hash: string;    // sha256 of the extracted text, not the raw HTML
  tags: string[];          // max 20, lowercased, de-duplicated
  favicon?: string;
  structured?: object | null;  // richest JSON-LD entity on the page
  quality?: QualityScore;
}
```

`content_hash` covers the *extracted text*, so a page whose ads or CSRF token
changed hashes the same. That is what makes it usable for change detection.

### QualityScore

```ts
interface QualityScore {
  score: number;      // 0..1 composite
  length: number;     // content depth, log-scaled
  freshness: number;  // recency; 1 when the date is unknown
  title: number;      // title clarity; generic titles are penalised
  structure: number;  // heading structure
}
```

Weights: length 0.40, freshness 0.25, title 0.20, structure 0.15. They are
exported from `@zwep/quality` so the UI can show the breakdown and tuning stays
in one place.

### SourceConfig

```ts
interface SourceConfig {
  name: string;              // [a-zA-Z0-9][a-zA-Z0-9._-]*, max 64
  type?: 'web' | 'google';   // default 'web'
  seeds: string[];
  queries?: string[];        // type: 'google' only
  allowedDomains: string[];  // empty falls back to the seeds' own hosts
  sitemap?: string;
  schedule?: string;         // cron, for an external scheduler
  maxDepth?: number;         // 0..10
  maxPages?: number;
  enabled?: boolean;         // default true; false excludes it from search
  label?: string;
  description?: string;
}
```

### CrawlTask

```ts
interface CrawlTask {
  id: string;
  source: string;
  status: 'running' | 'done' | 'error';
  startedAt: string;
  finishedAt?: string;
  summary?: CrawlSummary;
  error?: string;
}

interface CrawlSummary {
  source: string;
  pages: number;    // fetched
  skipped: number;  // robots.txt, wrong content type, or an asset URL
  failed: number;   // network or HTTP error
  indexed: number;  // produced a usable document
  seconds: number;
}
```

All of these are exported from `@zwep/shared`. If you build a TypeScript client,
import them from there rather than redeclaring — that package **is** the
contract, and changing a field in it is an API change.
