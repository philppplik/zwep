# Zwep roadmap

Where Zwep is, where it should go, and why. Each item says what problem it
solves — a feature without a problem behind it is a liability, not an asset.

---

## The thesis

General web search optimises for the median query across billions of users. If
the sources you actually trust are buried, no amount of better ranking fixes
that: the corpus is wrong, not the ranking.

Zwep's bet is that **corpus curation is the product**. Everything below is
judged by one question: does it make a curated corpus easier to build, trust, or
use? Features that would turn Zwep into a general web crawler are explicitly out
of scope, no matter how technically interesting.

---

## Shipped

The crawl → extract → index → search path is complete, tested, and runs on
Windows, macOS and Linux.

| | |
| --- | --- |
| **Crawler** | robots.txt, per-host politeness, sitemaps, canonical de-duplication, fetch timeouts, size caps, Playwright fallback for JS pages |
| **Extractor** | Readability, JSON-LD (including `@graph`), Open Graph, language and date normalization |
| **Quality scoring** | 0–100 from depth, freshness, title clarity and structure, with the breakdown visible in the UI |
| **Index** | Meilisearch behind an adapter, typo tolerance, facets, optional hybrid vector search |
| **API** | Search, suggest, document, graph, overview, stats, and the admin surface |
| **Web UI** | Search with facets and pagination, Library source management, Settings, knowledge-graph view, AI overview |
| **CLI** | Full terminal client with `--json` on every command, plus an interactive REPL |
| **MCP server** | Read-only by default; crawl tools behind `--allow-write` |
| **Knowledge graph** | Entity extraction and co-mention edges in SQLite |
| **Quality gates** | 247 tests, CI on three platforms × two Node versions, CodeQL, dependency audit |

---

## Next: make the corpus maintain itself

The single largest gap. Today a crawl only happens when you ask for one, so an
index is stale the day after you build it. Everything here is about closing that
loop.

### Scheduled crawls

`SourceConfig.schedule` already holds a cron expression that nothing reads. A
scheduler inside the API — or a `zwep daemon` — would run it.

*Why it matters:* without this, every user has to build their own cron wrapper,
and most will not. An index nobody refreshes stops being trustworthy, which
undermines the entire premise.

### Incremental re-crawling

`content_hash` is already computed over the extracted text, so an unchanged page
is cheap to detect. What is missing is using it: send `If-Modified-Since`, honour
`304`, and skip re-indexing when the hash matches.

*Why it matters:* a full re-crawl of 20,000 pages to discover that six changed
is what makes people crawl rarely, which is what makes indexes stale. This turns
a nightly crawl from an event into a background detail.

### Change feeds

Once re-crawling is incremental, "what changed since yesterday?" becomes nearly
free: a `GET /v1/changes?since=…` endpoint, and a "New since your last visit"
row in the UI.

*Why it matters:* it turns Zwep from a thing you query into a thing that tells
you something. For a curated corpus — a competitor set, a regulator's site, a
research group's publications — the delta is often the whole point.

### Crawl health

Per-source: last successful crawl, error rate over time, pages that started
failing. Surfaced in the Library with a plain-language diagnosis.

*Why it matters:* sources rot silently. A site adds a `Disallow`, moves to a
JavaScript shell, or starts returning 403 to unknown agents — and right now you
only notice because results quietly disappear.

---

## Then: make results easier to trust

### Saved searches and alerts

Persist a query with its filters. Optionally notify when new documents match —
webhook, email, or an entry in the change feed.

*Why it matters:* the natural use of a curated index is standing interest, not
one-off lookup. This is also the smallest step from "search engine" to "monitor",
which is a materially more valuable product.

### Collections

Group sources into named sets — "Competitors", "Regulators", "Internal docs" —
and scope a search to one with a single click.

*Why it matters:* a corpus of 50 sources is not one corpus; it is several that
happen to share an index. Collections make that structure explicit instead of
forcing a mental `source:` filter.

### Duplicate and near-duplicate detection

Press releases get syndicated; documentation gets mirrored. A SimHash over the
extracted text would let results collapse into "and 4 similar".

*Why it matters:* a page of the same article from five outlets looks broken, and
it wastes the one screen of attention a search result page gets.

### Explainable ranking

A "why this result?" affordance showing the contribution of text match,
recency, quality and source. The quality popover already does a version of this.

*Why it matters:* the promise is "yours to rank". You cannot tune what you
cannot see, and today tuning means editing code and re-reading it.

### Per-source ranking weight

A multiplier in `SourceConfig`, so a primary source outranks an aggregator that
happens to use better SEO wording.

*Why it matters:* it is the most-requested knob in any curated search product,
and it is the difference between "my index" and "an index I own".

---

## Then: reach

### A read-only public mode

Serve a search UI with the Library and Settings removed, gated by a
`ZWEP_PUBLIC_MODE` flag.

*Why it matters:* the obvious second use of a curated index is publishing it —
a docs search, a community index, a museum catalogue. Today that means putting
an authenticating proxy in front and hoping nothing leaks.

### More index adapters

`IndexAdapter` was designed for this; only the Meilisearch implementation
exists. Typesense would be a near-drop-in; OpenSearch would suit larger corpora.

*Why it matters:* not everyone can run Meilisearch, and the abstraction is worth
nothing until a second implementation proves it.

### PDF and document ingestion

Extract text from PDFs, and optionally OCR scanned ones.

*Why it matters:* for research, legal and internal corpora, a large share of the
material is not HTML at all. The crawler currently skips these files by design.

### Browser extension for manual curation

One click to add the current page to a collection, or to add its domain as a
source.

*Why it matters:* curation happens while browsing, not while sitting in an admin
panel. Lowering the cost of "this is worth indexing" from a task to a reflex is
the highest-leverage change available to the product.

---

## The agent angle

This is where Zwep is most differentiated, and it deserves to be treated as a
first-class surface rather than an integration.

An agent's failure mode on the open web is credulity: it cannot tell a primary
source from a content farm. A curated index removes that problem by
construction — **every result carries your judgement**. That is worth more to an
agent than better ranking.

### Shipped

- MCP server over stdio, read-only by default
- `zwep_search`, `zwep_fetch_document`, `zwep_list_sources`, `zwep_graph`,
  `zwep_stats`; crawl tools behind `--allow-write` plus an admin key
- `--json` on every CLI command, and colour that disables itself off a TTY
- Tool errors returned inside the result so an agent can recover rather than
  losing its turn

### Next

**Streaming HTTP MCP transport.** Today it is stdio only, which means one agent
per process on the same machine. An HTTP transport would let a shared Zwep serve
a team's agents.

**Citation-shaped responses.** Return a stable quote plus its character offset
alongside each result, so an agent can cite a specific passage rather than a URL
and hope. This is the single highest-value agent feature: it turns "the model
said so" into "the model quoted your source, here".

**A retrieval tool tuned for RAG.** `zwep_context(query, token_budget)` that
returns the best passages, de-duplicated, trimmed to a budget — rather than
whole documents the agent has to triage. Right now `zwep_fetch_document`
truncates at 20,000 characters, which is a crude approximation of this.

**Per-agent scoped keys.** Instead of one admin key, issue keys scoped to a
collection and a permission set. An agent that may read your legal corpus should
not be able to crawl arbitrary URLs into it.

---

## Explicitly out of scope

Saying no is what keeps the thesis intact.

- **General web crawling.** Zwep crawls what you list. Discovery beyond the
  allow-list is a different product with a different cost structure.
- **Bypassing access controls.** No paywall circumvention, no CAPTCHA solving,
  no ignoring `robots.txt`. The `ZwepBot/1.0` user agent is honest on purpose.
- **A search-as-a-service backend.** Self-hosted, single-tenant. Multi-tenancy
  would reshape every part of the data model for a use case Zwep does not have.
- **Becoming a chatbot.** The AI overview summarizes retrieved results. Open-
  ended conversation is a different product, and the moment it stops being
  grounded in the corpus, the corpus stops being the point.

---

## Non-functional work

Less visible, and the reason the rest stays possible.

- **A benchmark corpus.** Crawl and index quality are currently judged by
  reading output. A fixture set with expected extractions would make regressions
  visible.
- **Structured logging.** The API logs through Pino but emits mostly prose.
  Structured crawl events would make health monitoring a query instead of a grep.
- **A published Docker image**, so "try Zwep" is one command rather than five.
- **End-to-end browser tests.** The jsdom component tests cover behaviour;
  nothing currently catches a broken build or a CSS regression.
- **Streaming crawl progress** over Server-Sent Events, replacing the polling
  the Library does today.

---

## How this list is ordered

Roughly by *how many other things it unlocks*:

1. **Scheduling and incremental crawling** — without them, every other feature
   operates on a stale index.
2. **Collections and saved searches** — the structure that alerts, public mode
   and scoped agent keys all build on.
3. **Citations and RAG-shaped retrieval** — where the agent story becomes
   genuinely differentiated rather than merely convenient.
4. **Everything else.**

Disagree? [Open an issue](https://github.com/philppplik/zwep/issues/new/choose).
An argued case for a different order is more useful than another feature request.
