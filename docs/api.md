# Zwep — API Reference

> Public HTTP contract for the Zwep search service. All clients (cust*m Tab, web UI,
> third-party widgets) talk to this API — **never** to Meilisearch directly.
>
> Base URL: `https://api.zwep.example/v1`
> Format: JSON. Auth: none for read endpoints; `x-zwep-key` for write/admin.

---

## 1. Conventions

- **Versioning:** path-prefixed (`/v1`). Breaking changes bump the version.
- **Content-Type:** `application/json; charset=utf-8`.
- **Errors:** consistent envelope (see §7).
- **Rate limits:** per-IP + per-key; `429` with `Retry-After` header when exceeded.
- **CORS:** allow-list of known client origins.
- **Time:** all timestamps ISO 8601 UTC.

---

## 2. `GET /search`

Full-text search over the index.

### Query parameters
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | string | **required** | Query string. |
| `limit` | int | `20` | Results per page (max `100`). |
| `offset` | int | `0` | Pagination offset. |
| `source` | string[] | – | Filter by source name(s), repeatable or CSV. |
| `type` | string[] | – | Filter by document type (`article`, `page`, `doc`…). |
| `lang` | string | – | ISO 639-1 language filter (`de`, `en`). |
| `tag` | string[] | – | Filter by tag(s). |
| `from` | date | – | Published on/after (`YYYY-MM-DD`). |
| `to` | date | – | Published on/before. |
| `sort` | enum | `relevance` | `relevance` \| `date_desc` \| `date_asc`. |
| `facets` | bool | `false` | Include facet counts in response. |
| `highlight` | bool | `true` | Wrap matches in `<mark>` in title/excerpt. |

### Example
```
GET /v1/search?q=klimapolitik&source=gogure&lang=de&limit=10&facets=true
```

### Response `200`
```json
{
  "query": "klimapolitik",
  "total": 128,
  "limit": 10,
  "offset": 0,
  "took_ms": 12,
  "results": [
    {
      "id": "gogure:9f2a…",
      "url": "https://gogure.media/artikel/klimapolitik-2026",
      "title": "Klimapolitik <mark>2026</mark>: Was sich ändert",
      "excerpt": "Ein Überblick über die neuen <mark>klimapolitik</mark>ischen …",
      "source": "gogure",
      "type": "article",
      "lang": "de",
      "author": "Redaktion",
      "published_at": "2026-03-14T08:00:00Z",
      "tags": ["klima", "politik"],
      "score": 0.984
    }
  ],
  "facets": {
    "source": { "gogure": 128 },
    "type":   { "article": 110, "page": 18 },
    "tag":    { "klima": 64, "politik": 51, "energie": 22 }
  }
}
```

---

## 3. `GET /suggest`

Fast autocomplete for the search-as-you-type dropdown (used by cust*m Tab).

### Query parameters
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | string | **required** | Partial query (prefix). |
| `limit` | int | `8` | Max suggestions (max `20`). |
| `source` | string[] | – | Restrict to source(s). |

### Response `200`
```json
{
  "query": "klima",
  "suggestions": [
    { "text": "klimapolitik 2026", "url": "https://gogure.media/…", "type": "article" },
    { "text": "klimaneutralität", "url": null, "type": "term" }
  ]
}
```

---

## 4. `GET /document/:id`

Fetch a single indexed document by id.

### Response `200`
```json
{
  "id": "gogure:9f2a…",
  "url": "https://gogure.media/artikel/klimapolitik-2026",
  "canonical_url": "https://gogure.media/artikel/klimapolitik-2026",
  "title": "Klimapolitik 2026: Was sich ändert",
  "excerpt": "Ein Überblick …",
  "content": "Vollständiger extrahierter Fließtext …",
  "headings": ["Was ändert sich", "Zeitplan", "Kritik"],
  "source": "gogure",
  "type": "article",
  "lang": "de",
  "author": "Redaktion",
  "published_at": "2026-03-14T08:00:00Z",
  "crawled_at": "2026-03-15T02:11:00Z",
  "content_hash": "sha256:…",
  "tags": ["klima", "politik"]
}
```
`404` if not found (see error envelope).

---

## 5. Document schema (index model)

The canonical shape written by the indexer and returned by the API.

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | `"{source}:{sha1(canonical_url)}"` |
| `url` | string | Fetched URL |
| `canonical_url` | string | From `<link rel=canonical>` or normalised url |
| `title` | string | `<title>` / og:title |
| `excerpt` | string | ~200 char clean summary |
| `content` | string | Readability main text (searchable, not always returned) |
| `headings` | string[] | h1–h3 |
| `source` | string | Source name from `sources.yaml` |
| `type` | string | `article` \| `page` \| `doc` … (heuristic/JSON-LD) |
| `lang` | string | Detected language |
| `author` | string? | JSON-LD / meta |
| `published_at` | date? | `article:published_time` / JSON-LD |
| `crawled_at` | date | Last crawl timestamp |
| `content_hash` | string | SHA-256 of `content` (dedup) |
| `tags` | string[] | From meta keywords / JSON-LD / rules |

**Meilisearch config**
- Searchable: `title`, `headings`, `excerpt`, `content`, `tags`.
- Filterable: `source`, `type`, `lang`, `tags`, `published_at`.
- Sortable: `published_at`, `crawled_at`.
- Ranking: `words`, `typo`, `proximity`, `attribute`, `sort`, `exactness` + custom
  recency boost.

---

## 6. Admin / write endpoints (auth: `x-zwep-key`)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/admin/sources` | Add/update a source (`sources.yaml` entry). |
| `GET` | `/admin/sources` | List sources + last-crawl status. |
| `POST` | `/admin/crawl/:source` | Trigger an immediate crawl. |
| `GET` | `/admin/crawls` | Crawl history + queue depth. |
| `DELETE` | `/admin/document/:id` | Remove a document from the index. |
| `POST` | `/admin/reindex/:source` | Full re-crawl + re-index a source. |

### `POST /admin/sources` body
```json
{
  "name": "gogure",
  "seeds": ["https://gogure.media/"],
  "allowedDomains": ["gogure.media"],
  "sitemap": "https://gogure.media/sitemap.xml",
  "schedule": "0 * * * *",
  "maxDepth": 4,
  "maxPages": 20000
}
```

---

## 7. Error envelope

All errors share one shape:
```json
{
  "error": {
    "code": "invalid_query",
    "message": "Parameter 'q' is required.",
    "status": 400
  }
}
```

| Status | `code` examples |
|--------|-----------------|
| `400` | `invalid_query`, `invalid_param` |
| `401` | `unauthorized` (missing/bad `x-zwep-key`) |
| `404` | `not_found` |
| `429` | `rate_limited` (includes `Retry-After`) |
| `500` | `internal_error` |
| `503` | `index_unavailable` (Meilisearch down) |

---

## 8. Health & meta

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/healthz` | Liveness (`{ "ok": true }`). |
| `GET` | `/v1/stats` | Public index stats (doc count per source, last updated). |

---

## 9. Client integration snippets

### cust*m Tab (dashboard "search Gogure")
```js
async function zwepSuggest(q) {
  const r = await fetch(
    `https://api.zwep.example/v1/suggest?q=${encodeURIComponent(q)}&source=gogure&limit=6`
  );
  if (!r.ok) return [];
  const { suggestions } = await r.json();
  return suggestions;
}
```

### Web UI (full search)
```js
const params = new URLSearchParams({ q, limit: 20, facets: "true" });
const res = await fetch(`https://api.zwep.example/v1/search?${params}`);
const data = await res.json();
```

---

*This contract is stable within `/v1`. The index engine (Meilisearch → Elastic) can
change behind it without breaking clients — that's the whole point of the API layer.*
