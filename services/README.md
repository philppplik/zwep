# Zwep backend

The crawl → extract → index → search pipeline, plus the HTTP API that serves it.

For the reasoning behind the structure, see
[`../docs/architecture.md`](../docs/architecture.md). This file is the map.

## Data flow

```
config/sources.yaml ──seeds once──▶ data/sources.json
                                           │
   @zwep/crawler       BFS crawl, robots.txt + crawl-delay, per-host politeness,
        │              fetch timeout and size cap, Playwright only when needed
        │  CrawlPage (raw HTML)
        ▼
   @zwep/extractor     Readability + JSON-LD + Open Graph, language and date
        │              normalization; returns null for navigation-only pages
        │  Document
        ├──▶ @zwep/quality   0–1 composite from depth, freshness, title, structure
        ├──▶ @zwep/graph     entities + co-mention edges → SQLite
        ▼
   @zwep/indexer       Meilisearch behind IndexAdapter; optional vectors
        │
        ▼
   @zwep/api           Fastify on :8080
```

## Packages

| Package | Responsibility |
| --- | --- |
| `@zwep/shared` | Types only. **This is the API contract.** |
| `@zwep/config` | Env schema, `.env` loading, the source store |
| `@zwep/quality` | Document quality scoring (pure, injectable clock) |
| `@zwep/crawler` | Fetching, robots.txt, sitemaps, URL canonicalization |
| `@zwep/extractor` | HTML → `Document` |
| `@zwep/indexer` | `IndexAdapter` + the Meilisearch implementation |
| `@zwep/embed` | Optional embedding providers (Ollama, OpenRouter) |
| `@zwep/llm` | Optional LLM providers, prompt, and the overview cache |
| `@zwep/graph` | SQLite knowledge graph |
| `@zwep/worker` | `crawlSource` orchestration and the crawl CLI |
| `@zwep/api` | HTTP routes, auth, rate limiting, task registry |

Packages refer to each other by workspace name, never by a relative path across
a package boundary.

## Running it

```bash
# From the repository root
npm run infra:up    # Meilisearch :7700, Redis :6379
npm run api         # API only, :8080
npm run dev         # API + web UI, with a health check
```

Crawl from the command line:

```bash
npx zwep crawl example            # one source, with live progress
npx zwep crawl --all              # every enabled source
npx zwep index https://example.com/page
```

The lower-level worker CLI is still there if you want the pipeline without the
HTTP API in between:

```bash
npm run crawl -- example 50
```

## Two things worth knowing before you change anything

**The document id must stay derived from the URL.** It is
`{source}_{sha256(canonicalUrl)[0..15]}`. Deriving it from content mints a new
document on every change and orphans the previous one — that was a real bug, and
`tests/node/url.test.ts` now locks the invariant down.

**Optional providers must fail soft.** `getEmbedProvider()` and
`getLlmProvider()` return `null` when unreachable and back off for 60 seconds.
Nothing in the search path may throw because an optional feature is unavailable.

## Testing

```bash
npx vitest run --project node
```

No test needs a network or a running Meilisearch. The API is exercised through
`app.inject()` against a fake `IndexAdapter`; providers are stubbed. Keep it
that way — the suite finishing in seconds is what makes it get run.
