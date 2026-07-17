# Zwep — Backend

> Production-grade, self-hosted mini search engine. Crawls a curated set of
> sources, extracts clean documents, indexes them in Meilisearch, and serves
> fast, faceted, typo-tolerant search through a small Fastify API.
>
> Status: **Phase 1 — vertical slice working** (crawl → extract → index →
> search verified end-to-end with live data).

---

## Architecture

```
config/sources.yaml          # crawl seeds (curated sources)
        │
   @zwep/crawler    ──  BFS crawl, robots.txt + crawl-delay, JS render via Playwright
        │  CrawlPage (html)
   @zwep/extractor  ──  Readability + metadata + language + content hash
        │  Document
   @zwep/indexer    ──  IndexAdapter (Meilisearch) — engine-agnostic
        │  upsert
   Meilisearch  ◄───  index "zwep_documents"
        │  search
   @zwep/api        ──  Fastify: /v1/search /suggest /document /stats /healthz
        │
   clients (cust*m Tab, web UI, …)   ← never talk to Meili directly
```

Packages (npm workspaces):

| Package | Responsibility |
|---|---|
| `@zwep/shared` | `Document`, `SearchParams`, `SearchResult` contracts (mirror `docs/api.md`) |
| `@zwep/config` | env schema (zod) + `sources.yaml` loader |
| `@zwep/crawler` | politeness-aware BFS crawler, Playwright render fallback |
| `@zwep/extractor` | Readability text extraction + metadata |
| `@zwep/indexer` | `IndexAdapter` interface + Meilisearch implementation |
| `@zwep/api` | Fastify HTTP service |
| `@zwep/worker` | CLI: `zwep crawl <source> [maxPages]` |

---

## Prerequisites

- **Node.js ≥ 20** (tested on 24, uses native TS strip — no build step)
- **Docker + Docker Compose** (for Meilisearch + Redis)
- **Playwright Chromium** (for JS-heavy pages):
  `npx playwright install chromium`

---

## Quickstart

```bash
# 1. install workspace deps
npm install
npx playwright install chromium

# 2. start Meilisearch + Redis
cp .env.example .env
docker compose up -d meilisearch redis

# 3. crawl a source (see config/sources.yaml)
node --experimental-strip-types services/worker/src/cli.ts crawl example 50

# 4. start the API
node --experimental-strip-types services/api/src/server.ts
#   → http://127.0.0.1:8080/healthz

# 5. search
curl "http://127.0.0.1:8080/v1/search?q=example&source=example&facets=true"
```

---

## Configuration

All config via `.env` (see `.env.example`):

| Var | Default | Purpose |
|---|---|---|
| `MEILI_HOST` | `http://127.0.0.1:7700` | Meilisearch URL |
| `MEILI_MASTER_KEY` | — | Master key (set in `.env`) |
| `MEILI_INDEX` | `zwep_documents` | Index UID |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Queue (P2) |
| `CRAWLER_CONCURRENCY` | `4` | Parallel fetches per source |
| `CRAWLER_DELAY_MS` | `500` | Min politeness delay (ms) |
| `CRAWLER_USER_AGENT` | `ZwepBot/0.1` | UA sent to sites |
| `API_PORT` / `API_HOST` | `8080` / `0.0.0.0` | HTTP bind |
| `API_CORS_ORIGINS` | `http://localhost:3000` | CORS allowlist (CSV) |

Sources are declared in **`config/sources.yaml`** — `seeds`, `sitemap`,
`allowedDomains`, `maxPages`, `maxDepth`, `respectRobots`.

---

## API

Base: `http://127.0.0.1:8080`

| Method | Path | Params | Notes |
|---|---|---|---|
| GET | `/healthz` | — | liveness |
| GET | `/v1/stats` | — | `{ ok, indexed }` |
| GET | `/v1/search` | `q, limit, offset, source, type, tag, lang, from, to, sort, facets, highlight` | main search |
| GET | `/v1/suggest` | `q, limit, source` | instant suggestions |
| GET | `/v1/document/:id` | — | fetch one document |

Full contract + examples: **`docs/api.md`**.

### Example

```bash
curl "http://127.0.0.1:8080/v1/search?q=more&source=example&facets=true"
# => { "query":"more", "total":1, "took_ms":6,
#      "results":[{ "id":"example_7b6cd9a1d881", "title":"Example Domain", ... }],
#      "facets":{ "source":{"example":1}, "type":{"page":1}, "lang":{"en":1} } }
```

---

## Notes / decisions

- **No build step.** Node ≥ 20 runs `.ts` directly via
  `--experimental-strip-types`. Relative imports use the `.ts` extension.
- **Engine-agnostic index.** Clients never touch Meilisearch. Swapping to
  Elastic later means writing one new `IndexAdapter`.
- **Polite by default.** `robots.txt`, `Crawl-delay`, and a per-host minimum
  delay are always honoured. Curate `allowedDomains` strictly.
- **Playwright is a fallback**, not the default path. Static HTML is fetched
  first; only JS-heavy pages get rendered.

---

## Next (roadmap)

See **`docs/roadmap.md`**: incremental crawl scheduling (BullMQ+Redis),
quality scoring, the OpenAI-styled web UI, admin console, and deployment.
