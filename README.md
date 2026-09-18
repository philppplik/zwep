<div align="center">

<img src="web/public/zwep-logo.png" alt="" width="88" />

# Zwep

**A small, self-hosted search engine.**
Crawl what you curate. Search it in milliseconds. Nothing leaves your machine.

[![CI](https://github.com/philppplik/zwep/actions/workflows/ci.yml/badge.svg)](https://github.com/philppplik/zwep/actions/workflows/ci.yml)
[![CodeQL](https://github.com/philppplik/zwep/actions/workflows/codeql.yml/badge.svg)](https://github.com/philppplik/zwep/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.6-green.svg)](.nvmrc)

[Quickstart](#quickstart) · [Why](#why-zwep-exists) · [CLI](#the-command-line) ·
[For AI agents](#for-ai-agents) · [Docs](#documentation) · [Contributing](CONTRIBUTING.md)

</div>

---

## Why Zwep exists

General web search optimises for everyone, which means it optimises for nobody
in particular. If the fifty sites you actually trust are buried under SEO spam,
the problem is not ranking — it is the corpus.

Zwep inverts that. **You** choose the corpus. It crawls that set, builds its own
index, and answers queries from it. The result is a search engine where every
hit is from a source you vouched for.

- **Focused, not the whole web.** You define what gets crawled.
- **Private by construction.** Queries are answered locally. The UI loads no
  third-party scripts, analytics or fonts.
- **Yours to rank.** Tune relevance, recency, quality weighting and facets.
- **API-first.** One stable REST contract. The web UI, the CLI and any agent
  are all just clients.
- **Small.** The whole UI is ~18 kB gzipped, with no framework.

Zwep respects `robots.txt`, rate-limits itself, and identifies as `ZwepBot/1.0`.
It is **not** a general-purpose scraper.

---

## Quickstart

**Prerequisites:** [Node 22.6+](https://nodejs.org) and
[Docker](https://docs.docker.com/get-docker/). Works on Windows, macOS and Linux.

```bash
# 1. Get the code
git clone https://github.com/philppplik/zwep
cd zwep
npm install

# 2. Configure (the defaults work for local development)
cp .env.example .env

# 3. Start Meilisearch and Redis
npm run infra:up

# 4. Start the API (:8080) and the web UI (:5173)
npm run dev
```

Open **<http://localhost:5173>**. The first crawl takes about a minute:

```bash
# Index the built-in smoke-test source
npx zwep crawl example

# Search it
npx zwep search "example domain"
```

<details>
<summary><b>Platform notes</b></summary>

`npm run dev` is a Node script, so the same command works in PowerShell, cmd,
Git Bash, zsh and bash. It health-checks the API before telling you the UI is
ready and forwards Ctrl-C to both processes, including on Windows, where it
tears down the whole process tree with `taskkill`.

**Windows:** Docker Desktop must be running before `npm run infra:up`. If
`better-sqlite3` fails to install, install the
[Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
with the "Desktop development with C++" workload, then `npm rebuild`.

**macOS (Apple Silicon):** everything runs natively. Meilisearch's image is
multi-arch.

**Linux:** if Playwright's Chromium fails to launch, install its system
dependencies with `npx playwright install-deps chromium`.

</details>

<details>
<summary><b>Without Docker</b></summary>

Zwep needs Meilisearch reachable at `MEILI_HOST`; how it gets there is up to
you. Install it [natively](https://www.meilisearch.com/docs/learn/self_hosted/install_meilisearch_locally)
and start it with a matching key:

```bash
meilisearch --master-key=zwep_dev_master_key_change_me
```

Redis is currently optional — the crawler runs inline.

</details>

<details>
<summary><b>Something is not working</b></summary>

| Symptom | Cause and fix |
| --- | --- |
| Search returns 500, or the Library shows `ECONNREFUSED` | The API is not running. The Vite dev server proxies `/v1/*` to port 8080. Use `npm run dev`, which starts both. |
| `index_unavailable` | Meilisearch is not reachable. `npm run infra:up`, then check <http://localhost:7700/health>. |
| Library says "Admin key required" | Set it under Settings → Admin access. In development it is `zwep_admin_dev_key`. |
| A crawl indexes 0 documents | The source's `allowedDomains` may not include the seed's host, or `robots.txt` disallows `ZwepBot`. Run `zwep crawl <source> --json` to see `skipped` versus `failed`. |
| `zwep: command not found` | Use `npx zwep` inside the repository, or `npm link` to install it globally. |
| AI overview never appears | It is off by default. Turn it on in Settings and pick a provider. With `ollama`, make sure `ollama serve` is running. |

Still stuck? `zwep status --json` reports what Zwep thinks the state is —
include it when you [open an issue](https://github.com/philppplik/zwep/issues/new/choose).

</details>

---

## How it works

```
 sources.yaml ─┐
               ├──▶ Crawler ──▶ Extractor ──▶ Indexer ──▶ Meilisearch
 Library UI  ──┘    robots.txt   Readability   quality       │
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
| **Indexer** | Meilisearch behind an adapter interface, so the engine can be swapped. Typo tolerance, facets, and optional hybrid vector search. |
| **Graph** | Extracts entities and co-mentions into SQLite. No extra container. |
| **API** | Fastify. `/v1/search`, `/v1/suggest`, `/v1/document/:id`, `/v1/graph`, `/v1/overview`, plus admin routes. |

Full detail in [`docs/architecture.md`](docs/architecture.md).

---

## Curating sources

A **source** is a set of seed URLs plus the domains the crawler may follow.
Manage them in the Library UI, through the admin API, or from the CLI:

```bash
zwep sources add my-blog --seed https://example.com/blog --max-pages 200
zwep crawl my-blog
zwep sources list
```

Two kinds:

- **`web`** (default) — seeds plus `allowedDomains`. The crawler stays inside
  the allow-list, follows a sitemap if given, and de-duplicates by canonical URL.
- **`google`** — a list of queries is run against Google and the result URLs are
  crawled. Disabled by default; see below.

Disabling a source keeps its configuration but removes it from search results,
which is the quickest way to test how a source affects relevance.

> **About the Google source.** It is **off by default** (`GOOGLE_PROXY_ENABLED`),
> because enabling it means your configured queries leave your machine. It is
> also fragile by design: Google serves a JavaScript-only shell to non-browser
> clients and rate-limits datacenter IPs, so a plain fetch often returns zero
> links. It degrades gracefully — reporting `indexed: 0` rather than crashing —
> and works from an IP Google does not block. For reliable results, put a search
> API or residential proxy behind it.

---

## The command line

```bash
npx zwep help
```

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

The CLI talks to the HTTP API, so the same binary works against a local dev
server, a container, or a Zwep on another machine:

```bash
ZWEP_API=https://search.internal.example zwep search "quarterly report"
```

Every command takes `--json`, and colour turns itself off when stdout is not a
terminal — so piping into `jq` or a script always yields clean output:

```bash
zwep search "climate" --json | jq -r '.results[] | "\(.quality.score)\t\(.url)"'
```

---

## For AI agents

Zwep is built to be an agent's private research corpus. Two ways in.

### MCP server

`zwep mcp` speaks the Model Context Protocol over stdio. Register it once and
any MCP-capable client — Claude Code, Claude Desktop, Cursor — can search your
index as a first-class tool:

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

Read-only by default. The crawl tools (`zwep_crawl_url`, `zwep_crawl_source`)
appear only when the server is started with `--allow-write` **and** an admin key
is present — an agent that can index arbitrary URLs is a very different trust
level from one that can only read what you curated:

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

Tool failures are returned *inside* the result with `isError: true`, not as
transport errors, so an agent can read the message and recover instead of
losing its turn.

### Plain HTTP

For anything that is not MCP, the REST API needs no client library:

```bash
curl "http://localhost:8080/v1/search?q=klimapolitik&limit=5&facets=true"
```

The full contract is in [`docs/api.md`](docs/api.md).

---

## Configuration

Everything is environment variables; see [`.env.example`](.env.example) for the
annotated list. The ones that matter most:

| Variable | Default | Notes |
| --- | --- | --- |
| `ZWEP_ADMIN_KEY` | `zwep_admin_dev_key` | **Change this** before exposing the API. |
| `MEILI_MASTER_KEY` | `zwep_dev_master_key_change_me` | **Change this** too. |
| `API_HOST` | `127.0.0.1` | Loopback by default. Widen only behind a proxy. |
| `API_CORS_ORIGINS` | `*` | Set to your real origin in production. |
| `API_RATE_LIMIT` | `120` | Requests per minute per IP. `0` disables. |
| `GOOGLE_PROXY_ENABLED` | `false` | Opt-in. Sends queries to Google. |
| `EMBED_PROVIDER` | `none` | `ollama` or `openrouter` enables semantic search. |
| `LLM_PROVIDER` | `none` | `ollama` (local) or `openrouter` (cloud) for AI Overview. |

Read [SECURITY.md](SECURITY.md) before putting Zwep on a network. It documents
what the security model does and does not cover.

---

## Optional: semantic search and AI overview

Both are off by default and both work fully locally with
[Ollama](https://ollama.com):

```bash
ollama pull nomic-embed-text   # embeddings
ollama pull llama3.1           # overview generation
```

Then set `EMBED_PROVIDER=ollama` and `LLM_PROVIDER=ollama`, or pick them in
Settings — the UI pushes them to the server without a restart.

With `openrouter`, queries and result excerpts are sent to a third party. With
`ollama`, nothing leaves your machine. If a provider is unreachable, the feature
disables itself for a minute and search continues unaffected.

---

## Development

```bash
npm run dev            # API + web UI
npm test               # 247 tests, no network needed
npm run test:watch     # re-run affected tests as you type
npm run verify         # lint + typecheck + test (what CI runs)
npm run build          # production web bundle
```

The test suite runs in a few seconds with nothing installed beyond `npm ci` —
Meilisearch, Ollama and OpenRouter are all faked. CI runs it on Ubuntu, Windows
and macOS across Node 22 and 24.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the project layout, code style and
review expectations.

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
covered by tests, and runs on all three desktop platforms. The knowledge graph,
semantic search and AI overview are functional and optional.

Not there yet: a built-in scheduler, incremental re-crawling, and multi-user
access control. See [`docs/roadmap.md`](docs/roadmap.md).

## Related

The [cust\*m Tab](https://github.com/philppplik/custm-tab) browser extension is
one possible client — it can offer "search Zwep" from its dashboard. Neither
project depends on the other's internals, only on the API contract.

## License

[MIT](LICENSE)
