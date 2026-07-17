# Zwep — Concept

> **Zwep** is a small, self-hosted search engine. A crawler indexes a curated set
> of sources; a search API serves fast, ranked results; a thin client (browser
> extension, web UI, or the cust*m Tab dashboard) queries the API.
>
> Zwep is **not** a general web crawler. It is a *focused* index — you decide what
> gets crawled (e.g. your own sites, curated publications, a whitelist of domains).

---

## 1. Why build our own index?

Public search engines are general-purpose, ad-driven, and give you no control over
ranking, freshness, or coverage. For a publisher or content site there is real
value in a *focused* engine:

| Problem with public search | What Zwep gives you |
|----------------------------|---------------------|
| Your content competes with the whole web | A dedicated index of *only* the sources you choose |
| No control over ranking | Ranking you own and can tune (recency, section, author) |
| No structured filters | Facets by site, type, date, tag, language |
| Slow to reflect new content | Crawl on your schedule; near-real-time re-index |
| Privacy: queries are tracked | Self-hosted — queries never leave your infra |
| No API you control | A clean REST/JSON API any client can call |

**The pitch:** Zwep is a private, brandable mini-Google for a defined universe of
content. It powers site search, an internal knowledge index, or a "search my
world" feature inside cust*m Tab.

---

## 2. What Zwep is (and is not)

**Zwep IS:**
- A **crawler** (Node + Playwright) that fetches and renders a whitelist of URLs.
- An **indexer** that extracts clean text + metadata and writes to a search index.
- A **search index** (Meilisearch by default; Elasticsearch/OpenSearch optional).
- A **search API** (Node/Fastify) that clients query.
- A **minimal web UI** for search + an admin panel for sources & crawl status.

**Zwep is NOT:**
- A general web crawler that scrapes the whole internet (legal/scale/abuse issues).
- A browser-embedded crawler (impossible & would get an extension rejected).
- A scraper of sites that forbid it — Zwep honours `robots.txt` and rate limits.

---

## 3. Primary use-cases

1. **Site / publication search** — index all published articles/issues so readers (and
   editors) get instant, ranked, faceted search across the whole catalogue.
2. **cust*m Tab integration** — the extension's dashboard search bar can query the
   Zwep API as an optional source ("search Zwep") alongside web engines.
3. **Internal knowledge index** — crawl a whitelist of docs/wikis/sites you care
   about into one searchable place.
4. **White-label site search** — drop-in search for any WordPress site the agency
   builds (Zwep crawls the sitemap, exposes a search widget).

---

## 4. Scope boundaries (v1)

- **Whitelist only.** Crawl starts from an explicit `seeds` list + optional
  `sitemap.xml`. No open-ended discovery beyond `allowedDomains`.
- **Politeness first.** Respect `robots.txt`, per-domain concurrency + delay,
  identifiable User-Agent (`ZwepBot/1.0`).
- **Text + metadata only.** No media indexing in v1 (title, description, body text,
  headings, canonical URL, published date, tags, language).
- **Single tenant.** One index namespace per deployment in v1; multi-tenant later.

---

## 5. Success criteria

- Crawl a 5,000-page site end-to-end without manual intervention.
- Query latency **< 50 ms** p95 for a warm index (Meilisearch target).
- New/changed pages searchable within one crawl cycle (configurable, e.g. hourly).
- A client (cust*m Tab / web UI) can integrate search in **< 1 hour** using the API.

---

## 6. Naming & positioning

- **Zwep** — short, ownable, brandable. The product is "a Zwep index" / "search
  powered by Zwep".
- Bot identifies as `ZwepBot/1.0 (+https://…)` so site owners can recognise it.

See `architecture.md` for how the pieces fit, `api.md` for the contract, and
`design.md` for the UI system (OpenAI-inspired).
