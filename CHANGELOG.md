# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.1] — 2026-09-18

### Fixed

- **`npm run dev` never started on Windows.** The runner spawned children with
  `shell: true`, which concatenates the command and its arguments into one
  string *without quoting them*. Node's default install path is
  `C:\Program Files\nodejs\node.exe`, so cmd.exe split it at the space and
  reported `'C:\Program' is not recognized` — on every Windows machine with a
  default Node install. Nothing uses a shell any more: both children launch as
  `node <script>`, which needs none and cannot be mis-split. This also removes
  the `DEP0190` deprecation warning.

### Added

- **`zwep doctor`.** Checks Node, the engine, `.env`, Docker, Meilisearch, the
  API and the ports, and prints the exact command that fixes anything wrong. It
  separates optional from required, so a missing Docker no longer reads like a
  broken install. `--json` for scripts and agents.
- `npm run infra:up` explains itself when Docker is missing instead of failing
  with the shell's `'docker' is not recognized`. Docker is one way to run
  Meilisearch, not the only one, and the message now says so and gives the
  platform-specific alternative.
- The API turns startup failures into explanations. `EADDRINUSE` prints the
  port, how to check whether it is Zwep itself, and how to use another port —
  instead of a Node stack trace. `ZWEP_DEBUG=1` still shows the stack.
- The dev runner explains why the API exited, warns when Meilisearch is
  unreachable before you hit a 503, and detects missing dependencies.
- An unknown CLI command suggests the closest real one.
- `zwep check`, `zwep diagnose` and `zwep setup` alias `zwep doctor`.

## [0.3.0] — 2026-09-18

### Added

- **The CLI starts Zwep for you.** A command that needs the API now starts a
  local installation in the background and waits for it, instead of failing with
  "cannot reach the API". It only does this for a loopback `ZWEP_API` and only
  when it can find a checkout — starting a local server while you are pointed at
  a remote one would silently search the wrong index. `--no-auto-start` or
  `ZWEP_NO_AUTOSTART=1` opts out.
- `zwep up [--web]` and `zwep down` to control the background server
  explicitly. `up` also brings up Meilisearch through Docker when it is
  available, and reports plainly when it is not.
- `zwep update` reports whether a newer release exists and prints the command
  that matches how this copy was installed — global, project-local, npx or a git
  checkout each need a different one. A once-a-day notice appears after other
  commands.
- **Settings → Updates** in the web UI: the running version, a "Check for
  updates" button, and an automatic daily check that can be switched off. The
  registry request is made by the server, never the browser, so npm never
  receives a referrer carrying a search query.
- `GET /v1/version` and `GET /v1/update` on the API.
- `zwep status` now reports the CLI version, the installation path, and whether
  the running server was started by this CLI.
- The CLI version is read from package.json instead of being hardcoded in three
  places — 0.3.0 nearly shipped with the MCP server still announcing 0.2.0.

### Changed

- Upgraded the whole dependency tree: eslint 9 to 10, TypeScript 5.9 to 6,
  Vite 6 to 8, zod 3 to 4, js-yaml 4 to 5, @fastify/cors 10 to 11,
  meilisearch 0.45 to 0.62, @types/node 22 to 26, globals 15 to 17,
  playwright 1.61 to 1.63, and the GitHub Actions to v7.
  - meilisearch renamed its client class and replaced `index.waitForTask()`
    with a chained `.waitTask()` on the returned enqueued-task promise.
  - js-yaml dropped its default export; the named `load` is imported instead,
    and `@types/js-yaml` is gone since the package now ships its own types.
  - TypeScript is held at 6 rather than 7, because typescript-eslint still caps
    its peer at `<6.1.0`.

### Fixed

- Two dead initializations in the crawler and extractor, surfaced by eslint 10's
  `no-useless-assignment`: both variables were assigned a value that every path
  overwrote before reading.

## [0.2.0] — 2026-09-18

The first release with a test suite, CI, and a command line. Most of this entry
is repairs: the previous version had several defects that made documented
features not work at all.

### Added

- **`zwep` CLI.** An ASCII terminal client covering search, suggest, document
  fetch, AI overview, knowledge graph, index status, source management,
  crawling and an interactive `repl`. `--json` on any command emits
  machine-readable output, and colour disables itself when stdout is not a TTY.
- **MCP server (`zwep mcp`).** Exposes the index to any MCP-capable agent over
  stdio as JSON-RPC, with no dependencies. Read-only by default; the crawl
  tools require both `--allow-write` and an admin key.
- **Test suite.** 259 tests across three Vitest projects — services and
  packages, jsdom component behaviour, and the CLI/MCP protocol. No test needs
  a network or a running Meilisearch.
- **CI.** Lint, formatting, types and the full suite on Ubuntu, Windows and
  macOS across Node 22 and 24, plus CodeQL and a dependency audit.
- **Search pagination** and **working facet filters** in the web UI.
- **Theme selector** (system / light / dark) that follows the operating system.
- **Admin key management** in Settings, replacing the hard-coded default.
- `GET /v1/admin/crawl/:id` to poll a single crawl task.
- `POST /v1/admin/clear-cache` to drop cached AI overviews.
- `?purge=true` on source deletion, to remove that source's documents too.
- Repository hygiene: `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`,
  `CODE_OF_CONDUCT.md`, issue and pull-request templates, `CODEOWNERS`,
  Dependabot, `.editorconfig`, `.nvmrc` and `.gitattributes`.

### Fixed

- **`POST /v1/settings` threw a `ReferenceError`.** `applyRuntimeLlmSettings`
  was called but never imported.
- **Three Library actions threw a `ReferenceError` on click.** "Crawl all",
  "Clear index" and "Index URL" called functions the module never imported.
- **Crawl progress never resolved.** The UI polled `GET /v1/admin/crawl/:id`,
  which did not exist, so every single-source crawl polled a 404 forever.
- **Setting `GOOGLE_PROXY_ENABLED=true` crashed the API at boot.** The variable
  was declared as a boolean, but environment variables are strings, so the
  schema threw — and that value is exactly what the API's own error message
  told you to set.
- **`npm run build` and `npm run typecheck` failed on a clean checkout.** There
  was no root `tsconfig.json`.
- **Re-crawling a changed page duplicated it.** The document id hashed the page
  content, so any change minted a new id and orphaned the previous revision.
  The id now derives from the source and canonical URL, as documented.
- **Enabling or disabling a source did nothing.** `enabled` was missing from
  the validation schema, and Zod strips unknown keys, so the value was
  discarded on every save.
- **Semantic search always returned a 400.** The hybrid query omitted the
  embedder name, which Meilisearch rejects. Embeddings were also written to
  `_embeddings` instead of `_vectors`, so they were never used.
- **Search highlights were requested but discarded.** They are now returned in
  a typed `highlighted` field.
- **The language facet split every language in two.** `franc` reports ISO 639-3
  (`deu`) while HTML `lang` gives ISO 639-1 (`de`); both are normalized now.
- **The junk-page filter could never fire**, because it required an empty title
  and the title falls back to the URL.
- **Browser back and forward were broken** in the single-page app, and the
  "← Search" button was bound to the wrong element and did nothing.
- **Facet chips did nothing.** They were rendered as buttons with no handler.
- **The knowledge graph stored mirrored duplicate edges**, and its organisation
  detection was unreachable because the entity pattern could not match `GmbH`,
  `AG` or `LLC`.
- **Quality freshness scores drifted** in a long-running server: the clock was
  captured once at module load.
- **`npm run dev` never worked on Windows.** The runner derived its working
  directory from a `file:` URL's `pathname`, which yields `/C:/Users/...`.
- **The graph view leaked** a `resize` listener and an animation-frame loop that
  kept running after navigating away.
- A transient provider failure disabled embeddings or the LLM for the entire
  process lifetime; failures now back off for 60 seconds.

### Security

- **`POST /v1/settings` was unauthenticated**, letting any visitor of the web UI
  repoint the server's LLM provider and read back its configuration. It is now
  admin-gated like every other mutating endpoint.
- The admin key is sent in the `x-admin-key` header instead of a query
  parameter, so it no longer lands in browser history, referrers or proxy logs.
  Comparison is constant-time.
- Search filter values are quoted, closing a filter-injection hole on the
  `source`, `tag` and `lang` parameters.
- Added an in-process rate limiter (`API_RATE_LIMIT`, default 120/min).
- The API binds `127.0.0.1` by default instead of `0.0.0.0`.
- The crawler enforces a fetch timeout, a content-type check and a response
  size cap, and refuses to leave the configured domains even when the
  allow-list is empty.
- **Removed the Google Fonts and rsms.me stylesheet links from the web UI.**
  Zwep's premise is that queries never leave your infrastructure, but a font
  CDN receives every page view — and the referrer carries the search query.
- `npm audit` reports zero vulnerabilities, down from seven.
- Fixed three findings from a CodeQL scan:
  - `isGoogleOwned` used a bare suffix check, which also matches a look-alike
    host such as `evilgoogle.com` — so one was classified as Google's own
    infrastructure. It now matches the registrable domain or a subdomain of it.
  - The knowledge graph trimmed separators from entity ids with a regular
    expression that backtracks polynomially. The input is crawled page text, so
    a page of punctuation was a cheap way to stall a crawl.
  - Provider error bodies reached the log verbatim, so a response containing a
    newline could forge log entries. Untrusted text now goes through
    `oneLine()`, and the LLM provider name is a validated union rather than an
    arbitrary string.

### Changed

- The Admin console is now called **Library**, and reads as a source-management
  screen rather than a debug panel. `/admin` still routes there.
- The UI is English throughout; the AI overview box was previously German.
- Native `confirm()` dialogs replaced with accessible in-app dialogs.
- The API entry point is split into `app.ts` (buildable and testable) and
  `server.ts` (binds the port).
- Empty and error states name the command that fixes the situation.
- Accessibility: consistent focus ring, skip link, ARIA combobox semantics on
  suggestions, focus trapping in modals, live regions, and support for
  `prefers-reduced-motion`.
- The source table reflows into cards on screens under 720px.
- `README.md` rewritten; it previously described the project as being in the
  "design phase" while the whole engine was built.

### Removed

- `start-dev.sh` and `start-dev.bat`, superseded by the cross-platform
  `npm run dev`.
- `scripts/probe-google.ts` and `scripts/smoke-admin.ts`, superseded by the
  test suite.

[Unreleased]: https://github.com/philppplik/zwep/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/philppplik/zwep/releases/tag/v0.3.1
[0.3.0]: https://github.com/philppplik/zwep/releases/tag/v0.3.0
[0.2.0]: https://github.com/philppplik/zwep/releases/tag/v0.2.0
