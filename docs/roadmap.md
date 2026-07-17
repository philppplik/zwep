# Zwep — Roadmap

> Phased plan from empty repo to a running self-hosted mini search engine.
> Each phase is shippable on its own; you can stop after any phase and still have
> something useful.

---

## Phase 0 — Foundations (docs + skeleton)
**Goal:** repo scaffold, decisions locked, everyone can run "hello world".

- [x] `docs/` — concept, architecture, design, api, roadmap
- [ ] Monorepo scaffold (pnpm workspaces): `services/*`, `apps/web`, `packages/*`
- [ ] `docker-compose.yml` (meilisearch + redis) + `.env.example`
- [ ] Shared types package (`Document`, `SearchResult`) from `api.md`
- [ ] CI: lint + typecheck + build

**Done when:** `docker compose up` starts Meilisearch + Redis; `pnpm build` passes.

---

## Phase 1 — Crawl → Index → Search (vertical slice)
**Goal:** end-to-end for ONE source, no UI polish.

- [ ] Crawler: seed + `robots.txt` + sitemap parse + allowed-domains
- [ ] Fetch queue (BullMQ) with retries
- [ ] Fast-path fetch; Playwright fallback for JS pages
- [ ] Extractor: Readability + metadata + content hash
- [ ] Indexer: Meilisearch upsert + config (searchable/filterable/sortable)
- [ ] API: `GET /search` + `GET /healthz`
- [ ] `sources.yaml` with the first real source (e.g. example.com)

**Done when:** crawl a real site and get ranked JSON results from `/search`.

---

## Phase 2 — Search UI (OpenAI design system)
**Goal:** a clean public search page people actually use.

- [ ] Next.js/Vite app wired to `/search` + `/suggest`
- [ ] Implement `design.md` tokens (light/dark, typography, spacing)
- [ ] Search bar (hero + in-header), result list, `<mark>` highlighting
- [ ] Facets/filters (source, type, tag, date) + sort
- [ ] Empty / loading (skeleton) / error states
- [ ] Keyboard nav + a11y checklist pass

**Done when:** a non-technical user can search and filter comfortably.

---

## Phase 3 — Operability (admin + scheduling)
**Goal:** run it without touching the terminal.

- [ ] Admin panel: sources CRUD, trigger crawl, queue depth, last-crawl status
- [ ] Scheduled crawls (cron per source) + incremental re-index by hash
- [ ] Delete handling (404 / removed from sitemap)
- [ ] Structured logs (pino) + `/metrics` (Prometheus) + basic dashboards
- [ ] API keys for write/admin + per-client rate limits

**Done when:** sources self-refresh on schedule; admin shows health at a glance.

---

## Phase 4 — cust*m Tab integration
**Goal:** "search Zwep" inside the browser new tab.

- [ ] Add Zwep as an optional search source in cust*m Tab settings
- [ ] Dashboard suggest dropdown backed by `/suggest`
- [ ] "Open in Zwep web UI" for full results
- [ ] Graceful offline/error fallback (never blocks web search)

**Done when:** typing in cust*m Tab shows Zwep results inline.

---

## Phase 5 — Scale & polish (optional)
**Goal:** grow beyond a single small VPS when needed.

- [ ] `IndexAdapter` → Elasticsearch/OpenSearch for large corpora
- [ ] Worker fleet + managed Redis
- [ ] Synonyms, custom ranking (recency/section boosts), spell-correct
- [ ] Multi-tenant index namespaces (per-site search for agency clients)
- [ ] Optional embeddings/semantic re-ranking (hybrid search)
- [ ] Raw HTML snapshots to S3 for re-extraction without re-fetch

**Done when:** Zwep handles millions of docs and multiple client sites.

---

## Cross-phase definition of done
Every phase must keep:
- `robots.txt` + politeness respected (never regress).
- Clients only talk to the API, never the index directly.
- No secrets committed (`.env` only).
- Docs updated when the contract changes.

---

## Suggested first milestone
**"One real site, searchable, pretty."** = Phase 1 + Phase 2 for example.com.
That alone is a demoable, brandable mini search engine.
