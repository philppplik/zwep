# Zwep — Web UI

> OpenAI-inspired search front end for the Zwep API. Vanilla TS + Vite, no
> framework. Talks only to `/v1/*` (never to Meilisearch directly).

## Stack
- **Vite 6** dev server + build
- **Vanilla TypeScript** (typed against `@zwep/shared`)
- **OpenAI design tokens** (`src/styles/tokens.css`) — see `docs/design.md`
- Inter font (rsms.me), dark/light theme toggle, instant suggestions

## Dev
```bash
# API must be running on :8080 (see ../services/README.md)
npm run dev        # http://localhost:5173  (proxies /v1 -> :8080)
```
The Vite dev server proxies `/v1/*` and `/healthz` to the Fastify API, so the
browser never needs CORS or absolute URLs.

## Build
```bash
npm run build      # -> dist/  (static, ~8 kB JS gzipped)
npm run preview    # serve dist/ on :4173
```
In production, serve `dist/` from the same origin as the API (reverse proxy),
so `/v1` resolves to the API without a separate proxy.

## Structure
```
web/
├── index.html
├── vite.config.ts        # dev proxy -> :8080
└── src/
    ├── main.ts           # mount, theme, query routing
    ├── client.ts         # fetch /v1/search /suggest /document /stats
    ├── components.ts      # SearchBar (+suggestions), ResultList, facets
    └── styles/
        ├── tokens.css     # OpenAI design tokens (light/dark)
        └── app.css        # layout + components
```
