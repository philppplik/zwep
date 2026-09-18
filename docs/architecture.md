# Zwep architecture

How the pieces fit together, what state lives where, and which decisions are
load-bearing. This describes **what is built**, not what is planned — anything
aspirational is in [`roadmap.md`](roadmap.md).

---

## Contents

- [Overview](#overview)
- [The pipeline](#the-pipeline)
- [Components](#components)
- [State](#state)
- [Key decisions](#key-decisions)
- [Deployment](#deployment)
- [Extending it](#extending-it)

---

## Overview

```
  config/sources.yaml  ──seeds once──▶  data/sources.json
                                              │
                                              ▼
  ┌───────────────────────────────────────────────────────────────────┐
  │                          ZWEP CORE                                │
  │                                                                   │
  │   Crawler ──▶ Extractor ──▶ Quality ──▶ Indexer ──▶ Meilisearch   │
  │   robots.txt   Readability   0–100       adapter        :7700     │
  │   politeness   JSON-LD       scoring                       │      │
  │   Playwright   Open Graph                                  │      │
  │       │                                                    │      │
  │       └──▶ Knowledge graph ──▶ SQLite                      │      │
  │            entities, co-mentions                           │      │
  │                                                            ▼      │
  │                                  Search API (Fastify, :8080)      │
  └────────────────────────────────────────────┬──────────────────────┘
                                               │  REST / JSON
                    ┌──────────────────────────┼──────────────────────┐
                    ▼                          ▼                      ▼
              Web UI (:5173)            zwep CLI              MCP agents
              Vite, no framework        bin/zwep.mjs          zwep mcp
```

Every client goes through the API. None of them — not even the web UI — talks
to Meilisearch directly. That is what lets the index engine be replaced without
touching a single client.

---

## The pipeline

A page's journey from a URL to a search result:

**1. Enqueue.** `Crawler.enqueue` canonicalizes the URL (drop the fragment,
lowercase the host, strip `www.` and tracking parameters, sort query keys,
remove a trailing slash), rejects it if it looks like an asset or falls outside
`allowedDomains`, and records it in a `seen` set. De-duplication happens **at
enqueue time**, not at fetch time, so the same URL is never fetched twice in a
run.

**2. Politeness.** Each host owns a promise chain. A request links itself onto
the tail, so requests to one host are spaced by at least
`max(CRAWLER_DELAY_MS, robots crawl-delay)` even with many workers running.
Different hosts never block each other.

**3. Fetch.** `fetch` with a timeout, following redirects. A non-HTML
content type is skipped. The body is read through a capped reader that stops at
`CRAWLER_MAX_BYTES` rather than buffering whatever arrives.

**4. Render, conditionally.** If the HTML has little visible text, or has an
empty `#app`/`#root`/`#__next`, the page is re-fetched through Playwright.
Chromium is launched lazily — a crawl of static pages never starts a browser —
and is always closed in a `finally`.

**5. Extract.** Readability produces the body text; `og:`, JSON-LD (including
`@graph`) and headings produce the metadata. Language is normalized to ISO
639-1 and dates to ISO 8601. A page with too little text and no description
returns `null` and never reaches the index.

**6. Score.** Quality is computed from content depth (log-scaled), freshness,
title clarity and heading structure, weighted 0.40/0.25/0.20/0.15.

**7. Index.** Documents are batched 50 at a time. If an embedding provider is
configured, vectors are attached as `_vectors`. The document id is
`{source}_{sha256(canonicalUrl)[0..15]}` — derived from the URL, never from the
content, so a re-crawl updates the document in place instead of creating a
second copy.

**8. Graph.** Entities are extracted heuristically (capitalised runs, optionally
with a legal-form suffix), normalized through an alias map and a bounded fuzzy
merge, then written to SQLite with co-mention edges stored once per pair.

---

## Components

### `packages/shared`

Types only, no runtime code. `Document`, `SearchResult`, `SearchResponse`,
`SourceConfig`, `CrawlTask`. **This package is the API contract.** Changing a
field here is an API change.

### `packages/config`

The environment schema (Zod), `.env` loading, and the source store.

Environment variables are strings, so every boolean goes through a coercion
that accepts `true/1/yes/on`. `.env` is loaded through Node's built-in
`process.loadEnvFile`, with real environment values winning — which is what CI
and container deployments expect.

Sources live in `data/sources.json`, seeded from `config/sources.yaml` on first
run. Writes are atomic (temp file, then rename), and a corrupt store falls back
to the YAML seed rather than taking the API down.

### `packages/quality`

Pure scoring functions. The clock is injectable, so freshness cannot drift in a
long-running process and tests can pin it.

### `services/crawler`

`Crawler` (breadth-first, per-source), `GoogleSourceCrawler`, robots.txt
handling with a per-**origin** cache (scheme matters — an http and an https
origin are different servers to the robots protocol), sitemap parsing bounded by
depth and count, and URL canonicalization.

### `services/extractor`

HTML → `Document`. Readability gets its own DOM copy because it mutates the one
it is given.

### `services/indexer`

`IndexAdapter` is the seam; `MeiliAdapter` is the only implementation. `Indexer`
builds filters and translates the response into the public `SearchResponse`.

Filter values are quoted before interpolation. Hybrid search passes the embedder
name, without which Meilisearch rejects the request outright.

### `services/embed`, `services/llm`

Optional providers for semantic search and AI Overview. Both degrade to `null`
rather than throwing, and a failed probe disables the provider for 60 seconds
rather than for the process lifetime.

### `services/graph`

SQLite knowledge graph. Two tables, no extra container.

### `services/worker`

`crawlSource` orchestrates crawler → extractor → indexer → graph and returns a
summary rather than calling `process.exit`, which is what makes it embeddable in
the API.

### `services/api`

Fastify. Split deliberately:

- `app.ts` — `build()` returns a configured instance. Tests use `app.inject()`
  and never bind a port.
- `server.ts` — binds the port, handles signals.
- `tasks.ts` — the in-memory crawl task registry.

### `web`

Vite + TypeScript, **no framework**. ~18 kB gzipped. `dom.ts` holds the escaping
and teardown helpers every view depends on; `Disposables` is how views release
listeners, timers and animation frames.

### `cli` and `bin`

`bin/zwep.mjs` is the entry point; `cli/` holds the HTTP client, the MCP server
and the terminal renderer. Plain JavaScript, no build step, no native modules —
so the CLI runs anywhere Node runs, against any reachable Zwep.

---

## State

| Where | What | Notes |
| --- | --- | --- |
| `data/sources.json` | Source definitions | Written atomically. Safe to edit by hand while the API is stopped. |
| Meilisearch | The document index | The only large store. Reproducible by re-crawling. |
| `data/graph.db` | Knowledge graph | SQLite, WAL mode. |
| `data/overview_cache.db` | Cached AI overviews | Keyed by provider + model + query. Expendable. |
| In memory | Crawl tasks, rate limiter, runtime LLM override | Deliberately ephemeral. |
| Browser `localStorage` | UI settings and the admin key | Per browser, never sent anywhere except as the `x-admin-key` header. |

**Back up `data/`.** Meilisearch can be rebuilt by crawling; `sources.json`
cannot be rebuilt at all.

---

## Key decisions

**Adapter in front of the index.** `IndexAdapter` costs one indirection and buys
the ability to move to Typesense or OpenSearch without touching the API, the UI
or the CLI. It also makes the API testable without a running Meilisearch, which
is why the suite runs in seconds.

**The document id derives from the URL, not the content.** Content-derived ids
mint a new document on every change and orphan the old one. This was a real bug;
the invariant is now enforced by a test.

**No framework in the web UI.** Zwep has a handful of screens. React would be
larger than the entire application. The cost is manual DOM work and explicit
teardown — hence `Disposables`.

**Optional features fail soft.** An unreachable LLM or embedding provider
disables that feature and logs. It never fails a search. Optional means optional.

**The crawler runs in-process.** Redis and BullMQ are in `docker-compose.yml`
but unused: for a curated corpus, sequential crawling is fast enough and one
fewer moving part is worth more than throughput. The seam is there when a corpus
outgrows it.

**Escape at render, not at ingest.** Crawled content is stored as extracted and
escaped when rendered. Escaping at ingest would corrupt the text for every other
consumer — the API, the CLI, an agent.

**The admin key is a header.** Query strings leak into history, referrers and
logs. The key is compared in constant time.

---

## Deployment

### Development

```bash
npm run infra:up   # Meilisearch :7700, Redis :6379
npm run dev        # API :8080, web UI :5173
```

Vite proxies `/v1/*` to the API, so the browser sees a single origin and CORS
never enters the picture during development.

### Production sketch

```
          ┌─────────────────────────────────┐
  :443 ──▶│ Reverse proxy (TLS, auth)       │
          └───────────┬──────────┬──────────┘
                      │          │
              /v1/*   ▼          ▼  /*
               ┌────────────┐  ┌──────────────┐
               │ Zwep API   │  │ web/dist     │
               │ :8080      │  │ static files │
               └─────┬──────┘  └──────────────┘
                     │
               ┌─────▼────────┐
               │ Meilisearch  │  not published
               │ :7700        │
               └──────────────┘
```

1. `npm run build` produces `web/dist`. Serve it statically.
2. Run the API with `API_HOST=127.0.0.1` behind the proxy.
3. Keep Meilisearch on a private network.
4. Terminate TLS at the proxy — the admin key is a bearer credential.
5. Set `API_CORS_ORIGINS` to your real origin.

The full list is in [SECURITY.md](../SECURITY.md).

### Sizing

Meilisearch is the memory consumer; everything else is modest. A corpus of tens
of thousands of documents runs comfortably on a 2 GB VPS. Crawling is
network-bound, not CPU-bound — except when Playwright runs, so a JavaScript-heavy
source wants more headroom.

---

## Extending it

**A different search engine.** Implement `IndexAdapter` and return it from
`getAdapter()`. Nothing else changes.

**A different extraction strategy.** `extract(page, source)` is one function
returning `Document | null`. Swapping in a different parser is a local change.

**LLM-based entity extraction.** `KnowledgeGraph.extractEntities` is static and
takes text, so replacing the heuristic is a drop-in.

**New API routes.** Add them in `app.ts`. Read routes are public; mutating
routes take the `admin` preHandler. Add types to `packages/shared` and document
them in `api.md` — the contract lives in those two places, and nowhere else.
