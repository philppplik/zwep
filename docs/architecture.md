# Zwep — Architecture

> Technical design for the Zwep self-hosted search engine: crawler, indexer,
> search index, API, and clients. Target: production-grade but deployable on a
> single small VPS to start.

---

## 1. High-level overview

```
                    ┌──────────────────────────────────────────────┐
                    │                  ZWEP CORE                    │
                    │                                               │
  seeds/sitemaps ──▶│  Crawler ──▶ Fetch Queue ──▶ Renderer        │
                    │   (Node)      (BullMQ/Redis)   (Playwright)   │
                    │                                   │           │
                    │                                   ▼           │
                    │                              Extractor        │
                    │                          (readability +       │
                    │                           metadata parse)     │
                    │                                   │           │
                    │                                   ▼           │
                    │                              Indexer ──▶ Meilisearch
                    │                                               │  (index)
                    │  Search API (Fastify) ◀───────────────────────┘
                    │       │                                       │
                    └───────┼───────────────────────────────────────┘
                            │  REST / JSON
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
        cust*m Tab     Web UI        Admin Panel
        (extension)   (search)     (sources/status)
```

---

## 2. Components

### 2.1 Crawler (`services/crawler`)
- **Runtime:** Node.js (LTS), TypeScript.
- **Seeding:** reads `sources.yaml` — a list of `{ name, seeds[], allowedDomains[],
  sitemap?, schedule, maxDepth, maxPages }`.
- **Discovery:** starts from seeds + optional `sitemap.xml`; follows links only
  within `allowedDomains` up to `maxDepth`.
- **Politeness:**
  - Parses and honours `robots.txt` per domain (`robots-parser`).
  - Per-domain concurrency cap + configurable delay (token-bucket).
  - Global concurrency cap.
  - User-Agent: `ZwepBot/1.0 (+https://zwep.example)`.
- **Dedup:** URL canonicalization (strip fragments, sort query, honour
  `<link rel=canonical>`); content hash (SHA-256 of extracted text) to skip
  unchanged pages.
- **Output:** enqueues fetch jobs onto the queue.

### 2.2 Fetch Queue (`Redis` + `BullMQ`)
- Durable job queue decouples discovery from fetching/rendering.
- Retries with exponential backoff; dead-letter queue for permanent failures.
- Priorities: sitemap URLs > discovered links; re-crawl jobs scheduled by TTL.

### 2.3 Renderer (`Playwright`)
- Headless Chromium renders JS-heavy pages so SPA content is captured.
- **Fast path:** try a plain `fetch()` first; only spin up Playwright if the page
  needs JS (heuristic: little text in raw HTML, or flagged per-source).
- Resource blocking: images/fonts/media aborted to save bandwidth.
- Timeout + memory guards; one browser context per job, recycled pool.

### 2.4 Extractor (`services/extractor`)
- **Main content:** Mozilla Readability (`@mozilla/readability` + `jsdom`) to strip
  nav/ads/boilerplate.
- **Metadata:** `<title>`, `meta description`, OpenGraph, `article:published_time`,
  canonical URL, `lang`, headings (h1–h3), JSON-LD (`Article`, `NewsArticle`).
- **Normalisation:** collapse whitespace, detect language (`franc`), derive
  `excerpt` (first ~200 chars of clean text).
- **Output document (see api.md §Document schema).**

### 2.5 Indexer (`services/indexer`)
- Writes documents to **Meilisearch** (default) via batch upserts.
- Configures searchable attributes, filterable facets, ranking rules, synonyms,
  stop-words, and typo tolerance.
- Handles deletes (pages gone / 404 / removed from sitemap).

### 2.6 Search API (`services/api`, Fastify)
- Thin, fast HTTP layer over the index. **Clients never talk to Meilisearch
  directly** — the API enforces the public contract, rate limits, and API keys.
- Endpoints: `/search`, `/suggest`, `/document/:id`, `/healthz` (see `api.md`).
- CORS allow-list for known clients (cust*m Tab, web UI).
- Optional API-key auth (`x-zwep-key`) for write/admin routes.

### 2.7 Admin Panel + Web UI (`apps/web`)
- **Web UI:** public search page (OpenAI-styled — see `design.md`).
- **Admin:** manage sources, trigger crawls, view queue depth, last-crawl status,
  index size, error log. Auth-gated.

---

## 3. Data flow (one crawl cycle)

1. Scheduler fires for a source (cron per `schedule`).
2. Crawler loads `robots.txt`, expands sitemap, seeds the queue.
3. Workers pull jobs → fetch (fast path or Playwright) → extract → hash.
4. If content hash changed (or new): indexer upserts the document.
5. URLs removed from sitemap / returning 404 → indexer deletes.
6. Metrics + status written for the admin panel.

---

## 4. Storage

| Data | Store | Why |
|------|-------|-----|
| Search index | **Meilisearch** | Fast, typo-tolerant, easy facets, tiny ops burden |
| Job queue | **Redis** (BullMQ) | Durable, battle-tested queue |
| Crawl state / sources / URL ledger | **SQLite** (v1) → Postgres (scale) | URL → last hash, last crawl, status |
| Raw HTML snapshots (optional) | Filesystem / S3 | Debug + re-extract without re-fetch |

**Why Meilisearch over Elasticsearch for v1:** single binary, sub-50ms queries,
built-in typo tolerance + facets, trivial to run. Elasticsearch/OpenSearch is the
documented upgrade path when scale (10M+ docs, complex relevance) demands it — the
indexer is written behind an `IndexAdapter` interface so swapping is isolated.

---

## 5. Tech stack summary

| Layer | Choice |
|-------|--------|
| Language | TypeScript (Node LTS) |
| Crawler/render | Playwright (Chromium) |
| Content extraction | @mozilla/readability + jsdom |
| Queue | BullMQ on Redis |
| Index | Meilisearch (adapter: Elastic/OpenSearch) |
| API | Fastify |
| Web/Admin | Next.js (App Router) or Vite + React |
| State DB | SQLite (better-sqlite3) → Postgres |
| Deploy | Docker Compose (api, worker, redis, meilisearch, web) |

---

## 6. Deployment topology

**Single-VPS (start):** one Docker Compose stack:
```
services:
  meilisearch   # index
  redis         # queue
  api           # Fastify search API
  worker        # crawler + extractor + indexer workers
  web           # search UI + admin
```

**Scale-out (later):** separate worker fleet, managed Redis, Meilisearch cloud or
Elasticsearch cluster, API behind a load balancer + CDN for the web UI.

---

## 7. Cross-cutting concerns

- **robots & law:** honour `robots.txt`, `noindex`, crawl-delay; only crawl domains
  you own or are permitted to. Whitelist-only by design.
- **Rate limiting:** per-domain (crawler) and per-client (API).
- **Observability:** structured logs (pino), `/metrics` (Prometheus), crawl
  dashboards in the admin panel.
- **Security:** API keys for write/admin; CORS allow-list; input validation (zod);
  no secrets in the repo (`.env` + `.env.example`).
- **Idempotency:** content-hash dedup means re-runs don't churn the index.

---

## 8. Repository layout (planned)

```
Zwep/
├── docs/                  # concept, architecture, design, api, roadmap
├── services/
│   ├── crawler/           # discovery + politeness + queue seeding
│   ├── extractor/         # readability + metadata
│   ├── indexer/           # IndexAdapter (Meilisearch impl)
│   └── api/               # Fastify search API
├── apps/
│   └── web/               # search UI + admin (OpenAI design system)
├── packages/
│   ├── shared/            # types (Document, SearchResult), utils
│   └── config/            # sources.yaml loader, env schema
├── docker-compose.yml
├── .env.example
└── README.md
```

See `api.md` for the exact request/response contract and document schema.
