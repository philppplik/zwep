# Contributing to Zwep

Thanks for wanting to help. This document covers what you need to get a change
merged: how to run the project, what the code is expected to look like, and how
pull requests are reviewed.

## Table of contents

- [Getting set up](#getting-set-up)
- [The development loop](#the-development-loop)
- [Project layout](#project-layout)
- [Code style](#code-style)
- [Testing](#testing)
- [Commit messages](#commit-messages)
- [Pull requests](#pull-requests)
- [Reporting bugs](#reporting-bugs)

## Getting set up

You need **Node 22.6 or newer** (`.nvmrc` pins the version) and **Docker** for
Meilisearch and Redis.

```bash
git clone https://github.com/philppplik/zwep
cd zwep
npm install
cp .env.example .env
npm run infra:up      # Meilisearch on :7700, Redis on :6379
npm run dev           # API on :8080, web UI on :5173
```

`npm run dev` waits for the API to answer before telling you the UI is ready.
If it warns that the API never came up, the search UI will return 500s — check
that Meilisearch is running.

Playwright is only needed for pages that require JavaScript rendering. Install
its browser once if you plan to crawl such sites:

```bash
npx playwright install chromium
```

## The development loop

| Command | What it does |
| --- | --- |
| `npm run dev` | API and web UI together, with the API health-checked |
| `npm test` | The full suite, once |
| `npm run test:watch` | Re-run affected tests as you type |
| `npm run lint` | ESLint over everything |
| `npm run typecheck` | `tsc --noEmit` for both the backend and the web project |
| `npm run format` | Prettier, in place |
| `npm run verify` | Lint, typecheck and test — what CI runs |
| `npm run build` | Production web bundle |
| `node bin/zwep.mjs help` | The CLI |

Run `npm run verify` before you open a pull request. It is the same gate CI
applies, so a green local run means a green CI run.

## Project layout

```
zwep/
├── bin/zwep.mjs        # CLI entry point
├── cli/                # CLI internals: API client, MCP server, terminal UI
├── packages/
│   ├── shared/         # Types shared by every package — the API contract
│   ├── config/         # Env schema, .env loading, the source store
│   └── quality/        # Document quality scoring
├── services/
│   ├── api/            # Fastify server (app.ts builds it, server.ts binds it)
│   ├── crawler/        # Fetching, robots.txt, URL canonicalization
│   ├── extractor/      # HTML → Document
│   ├── indexer/        # Meilisearch adapter and the search contract
│   ├── embed/          # Optional embedding providers
│   ├── llm/            # Optional LLM providers for AI Overview
│   ├── graph/          # SQLite knowledge graph
│   └── worker/         # Crawl orchestration and the crawl CLI
├── web/                # Vite + TypeScript UI (no framework)
├── tests/
│   ├── node/           # Services and packages
│   ├── web/            # jsdom component tests
│   └── cli/            # CLI and MCP protocol
└── docs/               # Concept, architecture, API, design, roadmap
```

Packages refer to each other by their workspace name (`@zwep/config`), never by
a relative path across package boundaries. If you need something from another
package, export it there first.

## Code style

Prettier and ESLint decide formatting and the mechanical rules; `npm run
format` and `npm run lint:fix` will handle those. What they cannot check:

**Write comments that explain why, not what.** The reader can see that a loop
iterates. What they cannot see is the constraint that made you write it that
way. Comments that restate the code are noise; comments that record a decision
are the most valuable lines in the file.

```ts
// Good — records a constraint the reader cannot infer.
// Per-host politeness is serialized through a promise chain, so N parallel
// workers cannot burst a single host.

// Not useful — restates the code.
// Loop over the hosts and wait.
```

**Match the surrounding code.** Naming, comment density and idiom should be
consistent within a file. A change that reads like it was always there is
easier to review than one that is merely correct.

**Prefer narrow, named types over `any`.** `any` is allowed at the Meilisearch
and Fastify boundaries, where upstream types are looser than ours, and ESLint
warns rather than errors there. Everywhere else, model the shape.

**Fail loudly at the boundary, degrade gracefully inside.** Invalid input to the
API returns a typed error envelope. An unreachable optional provider (LLM,
embeddings) disables the feature and logs — it never fails a search.

## Testing

Tests live in `tests/`, split into three Vitest projects:

- `tests/node/` — services and packages, plain Node environment
- `tests/web/` — UI behaviour, jsdom environment
- `tests/cli/` — the CLI and the MCP protocol

Run one project with `npx vitest run --project web`.

A few expectations:

**Test behaviour, not implementation.** The API tests drive routes through
`app.inject()`; the MCP tests drive the server through JSON-RPC, exactly as an
agent would. Neither reaches into internals, so both survive refactoring.

**Every bug fix gets a regression test, with a comment saying what broke.**

```ts
it('keeps the enabled flag', () => {
  // Regression guard: `enabled` was missing from the schema, and Zod strips
  // unknown keys — every activate/deactivate toggle was silently discarded.
  expect(sourceSchema.parse({ ...source, enabled: false }).enabled).toBe(false);
});
```

**No network in tests.** Meilisearch, Ollama and OpenRouter are all faked. The
suite runs in a few seconds on a laptop with nothing else installed; keep it
that way.

**Isolate state.** `tests/setup.node.ts` points every suite at a temporary data
directory. If your test writes files, write them there.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/), because the type
prefix is what drives the changelog:

```
<type>(<optional scope>): <summary in the imperative>

<body: why this change, what it affects, what you decided against>
```

Types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`,
`chore`.

```
fix(crawler): derive the document id from the URL, not the page content

Hashing the body minted a new id every time a page changed, leaving the
previous revision orphaned in the index. The id is now the source plus the
canonical URL, which is what docs/api.md always documented.
```

The summary line should be under 72 characters. The body is where the value is:
say why the change was necessary and what you ruled out.

## Pull requests

1. Branch from `main`: `git checkout -b fix/crawler-timeout`.
2. Make the change, with tests.
3. Run `npm run verify`.
4. Add an entry to `CHANGELOG.md` under "Unreleased".
5. Open the PR and fill in the template.

`main` is protected: changes land through a pull request with CI green. CI runs
lint, formatting, types and the full suite on Ubuntu, Windows and macOS across
Node 22 and 24, plus a CodeQL scan and a dependency audit.

Reviews look for, in order: does it do what it says; is it correct at the edges
(empty input, unreachable service, hostile content); is it tested; is it
documented; does it read like the rest of the codebase.

Small pull requests get reviewed faster and merged sooner. If a change grows
past a few hundred lines, consider whether it is really two changes.

## Reporting bugs

Open an issue using the bug template. The single most useful thing you can
include is the output of:

```bash
zwep status --json
```

For anything security-related, please use
[a private advisory](https://github.com/philppplik/zwep/security/advisories/new)
rather than a public issue. See [SECURITY.md](SECURITY.md).

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By taking
part, you agree to uphold it.
