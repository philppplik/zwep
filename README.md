<div align="center">

<img src="web/public/zwep-logo.png" alt="" width="88" />

# Zwep

**A search engine for the sources you trust — and nothing else.**

Zwep crawls a list of sites you choose, builds its own index, and answers your
searches from it. No ads, no SEO spam, no tracking. It runs on your machine, and
your queries never leave it.

[![CI](https://github.com/philppplik/zwep/actions/workflows/ci.yml/badge.svg)](https://github.com/philppplik/zwep/actions/workflows/ci.yml)
[![CodeQL](https://github.com/philppplik/zwep/actions/workflows/codeql.yml/badge.svg)](https://github.com/philppplik/zwep/actions/workflows/codeql.yml)
[![npm](https://img.shields.io/npm/v/zwep.svg)](https://www.npmjs.com/package/zwep)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.6-green.svg)](.nvmrc)

[What is this?](#what-is-this) · [Is it for you?](#is-zwep-for-you) ·
[Install](#install) · [Usage](#usage) · [For AI agents](#for-ai-agents) ·
[Docs](#documentation)

</div>

---

## What is this?

Web search optimises for the average query across billions of people. That makes
it very good at "weather tomorrow" and increasingly bad at finding the fifty
sites you actually rely on — those are buried under content farms optimised to
rank, not to be right.

Zwep flips the problem around. **You pick the corpus.** Add the sites that
matter to you; Zwep crawls them, extracts clean text, scores each page for
quality, and gives you a fast, faceted search over exactly that material. Every
result comes from something you vouched for.

It is three things in one repository:

| | |
| --- | --- |
| **A crawler and indexer** | Fetches your sources politely, extracts text and metadata, and indexes it in Meilisearch |
| **A search API and web UI** | A clean REST API with a fast browser interface on top |
| **A CLI and MCP server** | Search from your terminal, or give an AI agent your private corpus as a tool |

Zwep respects `robots.txt`, rate-limits itself, and identifies as
`ZwepBot/1.0`. It is **not** a general-purpose web scraper.

---

## Is Zwep for you?

**Yes, if you are:**

- **A researcher or analyst** who keeps returning to the same 30 journals,
  agencies or company sites, and wants one search across all of them.
- **A developer** who wants to search a set of documentation sites without the
  results being polluted by tutorial spam and outdated Stack Overflow copies.
- **Someone running a publication or a site** who wants real search over their
  own archive, with ranking they control.
- **Building with AI agents** and tired of the agent citing a content farm. A
  curated index means every retrieved source already passed your judgement — see
  [For AI agents](#for-ai-agents).
- **Privacy-minded.** Your queries are answered locally. The UI loads no
  third-party scripts, analytics, or even web fonts.

**Probably not, if you:**

- Want to search the whole web. Zwep only knows what you tell it to crawl.
- Want a hosted service you sign up for. Zwep is self-hosted, single-tenant.
- Need multi-user accounts and per-user permissions. There is one admin key, not
  a user model — see [SECURITY.md](SECURITY.md).
- Want to crawl sites that forbid it. Zwep honours `robots.txt` by design.

---

## Install

There are two pieces, and you may only want the first.

### 1. The CLI and MCP server — from npm

Zero dependencies, works anywhere Node runs. This is what you install to *use* a
Zwep, or to connect an AI agent to one.

```bash
npm install -g zwep
```

Or run it without installing:

```bash
npx zwep --help
```

It talks to a Zwep API over HTTP, so it works against a Zwep on your laptop, in a
container, or on another machine:

```bash
export ZWEP_API=http://127.0.0.1:8080     # the default
zwep status
```

### 2. The search engine itself — from source

This is the crawler, indexer, API and web UI. It needs
[Node 22.6+](https://nodejs.org) and [Docker](https://docs.docker.com/get-docker/)
(for Meilisearch). Works on Windows, macOS and Linux.

```bash
# Get the code
git clone https://github.com/philppplik/zwep
cd zwep
npm install

# Configure — the defaults work for local development
cp .env.example .env

# Start Meilisearch and Redis
npm run infra:up

# Start the API (:8080) and the web UI (:5173)
npm run dev
```

Open **<http://localhost:5173>**. Then index something:

```bash
npx zwep crawl example          # the built-in smoke-test source
npx zwep search "example domain"
```

<details>
<summary><b>Platform notes</b></summary>

`npm run dev` is a Node script, so the same command works in PowerShell, cmd,
Git Bash, zsh and bash. It health-checks the API before telling you the UI is
ready, and forwards Ctrl-C to both processes — including on Windows, where it
tears down the whole process tree.

**Windows:** start Docker Desktop before `npm run infra:up`. If `better-sqlite3`
fails to build, install the
[Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
with the "Desktop development with C++" workload, then run `npm rebuild`.

**macOS (Apple Silicon):** everything runs natively; Meilisearch's image is
multi-arch.

**Linux:** if Playwright's Chromium fails to launch, run
`npx playwright install-deps chromium`.

</details>

<details>
<summary><b>Without Docker</b></summary>

Zwep only needs Meilisearch reachable at `MEILI_HOST`. Install it
[natively](https://www.meilisearch.com/docs/learn/self_hosted/install_meilisearch_locally)
and start it with a matching key:

```bash
meilisearch --master-key=zwep_dev_master_key_change_me
```

Redis is optional today — the crawler runs inline.

</details>

<details>
<summary><b>Troubleshooting</b></summary>

| Symptom | Cause and fix |
| --- | --- |
| Search returns 500, or the Library shows `ECONNREFUSED` | The API is not running. The web UI proxies `/v1/*` to port 8080. Use `npm run dev`, which starts both. |
| `index_unavailable` | Meilisearch is unreachable. Run `npm run infra:up`, then check <http://localhost:7700/health>. |
| Library says "Admin key required" | Set it under Settings → Admin access. In development it is `zwep_admin_dev_key`. |
| A crawl indexes 0 documents | The source's `allowedDomains` may not cover the seed's host, or `robots.txt` disallows `ZwepBot`. Run `zwep crawl <source> --json` to see `skipped` versus `failed`. |
| `zwep: command not found` | `npm install -g zwep`, or use `npx zwep`. |
| AI overview never appears | It is off by default. Enable it in Settings and pick a provider. For `ollama`, make sure `ollama serve` is running. |

Still stuck? `zwep status --json` prints what Zwep believes its state is —
include it when you
[open an issue](https://github.com/philppplik/zwep/issues/new/choose).

</details>

---

## Usage

### Curating sources

A **source** is a set of seed URLs plus the domains the crawler may follow. Manage
them in the Library UI, through the admin API, or from the terminal:

```bash
zwep sources add my-docs --seed https://example.com/docs --max-pages 200
zwep crawl my-docs
zwep sources list
```

Disabling a source keeps its configuration but drops it out of search results —
the quickest way to see how a source affects your relevance.

Two kinds of source exist:

- **`web`** (default) — seeds plus `allowedDomains`. The crawler stays inside the
  allow-list, follows a sitemap if you give it one, and de-duplicates by
  canonical URL.
- **`google`** — a list of queries is run against Google and the result URLs are
  crawled. **Off by default** (`GOOGLE_PROXY_ENABLED`), because enabling it means
  your queries leave your machine. It is also fragile: Google serves a
  JavaScript-only shell to non-browser clients, so a plain fetch often returns
  nothing. It degrades gracefully rather than crashing.

### Searching

From the browser at <http://localhost:5173>, or from the terminal:

```bash
zwep search "climate policy"
zwep search "climate policy" --source my-docs --type article --limit 5
zwep overview "climate policy"     # AI summary of the top results
zwep graph "climate"               # knowledge-graph neighbourhood
zwep repl                          # interactive session
```

Every command takes `--json`, and colour switches itself off when stdout is not a
terminal — so piping into `jq` or a script always gives clean output:

```bash
zwep search "climate" --json | jq -r '.results[] | "\(.quality.score)\t\(.url)"'
```

### All commands

```
SEARCH
  search <query>        Search the index
  suggest <partial>     Title autocompletions
  doc <id>              Print one document in full
  overview <query>      AI summary of the top results
  graph <term>          Knowledge-graph neighbourhood
  repl                  Interactive search session

INDEX  (needs ZWEP_ADMIN_KEY)
  status                Index health and counts
  sources list          List curated sources
  sources add <name> --seed <url>[,<url>] [--domain d] [--max-pages N]
  sources enable|disable|rm <name>
  crawl <source>        Crawl one source (--all for every enabled one)
  index <url>           Crawl and index a single URL
  deindex --yes         Delete every indexed document

AGENTS
  mcp [--allow-write]   Run as an MCP server on stdio
  --json                Machine-readable output for any command
```

### Plain HTTP

The REST API needs no client library:

```bash
curl "http://localhost:8080/v1/search?q=klimapolitik&limit=5&facets=true"
```

The full contract is in [`docs/api.md`](docs/api.md).

---

## For AI agents

An agent's weakness on the open web is credulity — it cannot tell a primary
source from a content farm. A curated index removes that problem by
construction: **every result already carries your judgement.**

### MCP server

`zwep mcp` speaks the [Model Context Protocol](https://modelcontextprotocol.io)
over stdio. Register it once and any MCP-capable client — Claude Code, Claude
Desktop, Cursor — can search your index as a first-class tool:

```json
{
  "mcpServers": {
    "zwep": {
      "command": "npx",
      "args": ["-y", "zwep", "mcp"],
      "env": { "ZWEP_API": "http://127.0.0.1:8080" }
    }
  }
}
```

| Tool | What it does |
| --- | --- |
| `zwep_search` | Ranked results with title, URL, excerpt, source and quality score |
| `zwep_fetch_document` | One document in full, truncated to protect the context window |
| `zwep_list_sources` | What the corpus actually covers |
| `zwep_graph` | Entities related to a term |
| `zwep_stats` | Index health |

**Read-only by default.** The crawl tools (`zwep_crawl_url`,
`zwep_crawl_source`) only appear when the server is started with
`--allow-write` **and** an admin key is present — an agent that can index
arbitrary URLs is a very different trust level from one that can only read what
you curated:

```json
{
  "command": "npx",
  "args": ["-y", "zwep", "mcp", "--allow-write"],
  "env": {
    "ZWEP_API": "http://127.0.0.1:8080",
    "ZWEP_ADMIN_KEY": "your-key"
  }
}
```

Tool failures come back *inside* the result with `isError: true`, not as
transport errors, so an agent can read the message and recover instead of losing
its turn.

---

## How it works

```
 sources.yaml ─┐
               ├──▶ Crawler ──▶ Extractor ──▶ Indexer ──▶ Meilisearch
 Library UI  ──┤    robots.txt   Readability   quality       │
 CLI / API   ──┘    politeness   JSON-LD       scoring       │
                         │                                   │
                         └──▶ Knowledge graph (SQLite)       │
                                                             ▼
                                              Search API (Fastify, :8080)
                                                             │
                                          ┌──────────────────┼─────────────┐
                                          ▼                  ▼             ▼
                                      Web UI            zwep CLI      MCP agents
```

| Stage | What it does |
| --- | --- |
| **Crawler** | Fetches allow-listed URLs. Honours `robots.txt` and `crawl-delay`, serializes requests per host, caps time and response size, and renders JavaScript-heavy pages with Playwright only when the raw HTML is too thin. |
| **Extractor** | Readability for the body, plus `og:`, JSON-LD and heading metadata. Normalizes language to ISO 639-1 and dates to ISO 8601. |
| **Quality** | Scores every document 0–100 from content depth, freshness, title clarity and structure. The breakdown is visible in the UI. |
| **Indexer** | Meilisearch behind an adapter interface, so the engine can be swapped. Typo tolerance, facets, optional hybrid vector search. |
| **Graph** | Extracts entities and co-mentions into SQLite. No extra container. |
| **API** | Fastify. `/v1/search`, `/v1/suggest`, `/v1/document/:id`, `/v1/graph`, `/v1/overview`, plus admin routes. |

The whole web UI is about 18 kB gzipped, with no framework. Full detail in
[`docs/architecture.md`](docs/architecture.md).

---

## Configuration

Everything is environment variables; [`.env.example`](.env.example) documents all
of them. The ones that matter most:

| Variable | Default | Notes |
| --- | --- | --- |
| `ZWEP_API` | `http://127.0.0.1:8080` | Which Zwep the CLI and MCP server talk to. |
| `ZWEP_ADMIN_KEY` | `zwep_admin_dev_key` | **Change this** before exposing the API. |
| `MEILI_MASTER_KEY` | `zwep_dev_master_key_change_me` | **Change this** too. |
| `API_HOST` | `127.0.0.1` | Loopback by default. Widen only behind a proxy. |
| `API_CORS_ORIGINS` | `*` | Set to your real origin in production. |
| `API_RATE_LIMIT` | `120` | Requests per minute per IP. `0` disables. |
| `GOOGLE_PROXY_ENABLED` | `false` | Opt-in. Sends queries to Google. |
| `EMBED_PROVIDER` | `none` | `ollama` or `openrouter` enables semantic search. |
| `LLM_PROVIDER` | `none` | `ollama` (local) or `openrouter` (cloud) for AI Overview. |

Read [SECURITY.md](SECURITY.md) before putting Zwep on a network — it states
plainly what the security model does and does not cover.

### Optional: semantic search and AI overview

Both are off by default, and both work fully locally with
[Ollama](https://ollama.com):

```bash
ollama pull nomic-embed-text   # embeddings
ollama pull llama3.1           # overview generation
```

Set `EMBED_PROVIDER=ollama` and `LLM_PROVIDER=ollama`, or pick them in Settings —
the UI pushes them to the server without a restart. With `openrouter`, queries
and result excerpts go to a third party; with `ollama`, nothing leaves your
machine. If a provider is unreachable, the feature disables itself for a minute
and search continues unaffected.

---

## Development

```bash
npm run dev            # API + web UI
npm test               # 259 tests, no network needed
npm run test:watch     # re-run affected tests as you type
npm run verify         # lint + typecheck + test (what CI runs)
npm run build          # production web bundle
```

The suite runs in a few seconds with nothing installed beyond `npm ci` —
Meilisearch, Ollama and OpenRouter are all faked. CI runs it on Ubuntu, Windows
and macOS across Node 22 and 24, plus CodeQL and a dependency audit.

See [CONTRIBUTING.md](CONTRIBUTING.md) for project layout, code style and review
expectations.

---

## Documentation

| Document | Contents |
| --- | --- |
| [`docs/concept.md`](docs/concept.md) | Why a private index, who it is for, what is out of scope |
| [`docs/architecture.md`](docs/architecture.md) | Components, data flow, storage, deployment |
| [`docs/api.md`](docs/api.md) | REST endpoints, parameters, response and document schemas |
| [`docs/design.md`](docs/design.md) | Design system: tokens, type scale, components |
| [`docs/roadmap.md`](docs/roadmap.md) | What is built, what is next, and why |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Setup, style, testing, pull requests |
| [`SECURITY.md`](SECURITY.md) | Security model, deployment checklist, reporting |
| [`CHANGELOG.md`](CHANGELOG.md) | What changed in each release |

---

## Status

**Working, and in use.** The crawl → extract → index → search path is complete,
covered by 259 tests, and runs on all three desktop platforms. The knowledge
graph, semantic search and AI overview are functional and optional.

Not there yet: a built-in scheduler, incremental re-crawling, and multi-user
access control. The reasoning and priorities are in
[`docs/roadmap.md`](docs/roadmap.md).

Zwep is pre-1.0. The REST contract in [`docs/api.md`](docs/api.md) is stable in
practice, but it may still change before 1.0; breaking changes are listed in
[CHANGELOG.md](CHANGELOG.md).

## Contributing

Contributions are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers how to get
set up, what the code is expected to look like, and how pull requests are
reviewed. Bug reports and feature requests go through the
[issue templates](https://github.com/philppplik/zwep/issues/new/choose);
security reports go through a
[private advisory](https://github.com/philppplik/zwep/security/advisories/new).

Everyone taking part is expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Related

The [cust\*m Tab](https://github.com/philppplik/custm-tab) browser extension is
one possible client — it can offer "search Zwep" from its dashboard. Neither
project depends on the other's internals, only on the API contract.

## License

[MIT](LICENSE) © Philipp Paulik

Free to use, modify, distribute and sell, including commercially. The only
condition is that the copyright notice and licence text travel with the code.
The software comes with no warranty.
