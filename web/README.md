# Zwep web UI

The search front end. Vanilla TypeScript and Vite, no framework. It talks only
to `/v1/*` — never to Meilisearch directly.

## Why no framework

Zwep has four screens: search, Library, Settings, and the graph view. React plus
a router would be larger than the entire application, which currently ships at
about **18 kB gzipped** including all CSS.

The trade is explicit DOM work and manual teardown. `src/dom.ts` carries that
weight: `Disposables` collects every listener, timer and animation frame a view
creates so the router can release them in one call, and `escapeHtml` /
`sanitizeHighlight` / `safeUrl` make the safe path the short one.

## Development

```bash
# From the repository root — starts the API and this UI together:
npm run dev
```

Vite proxies `/v1/*` and `/healthz` to the API on port 8080, so the browser sees
one origin and CORS never comes up. If the API is not running, search returns
500 and the Library shows a connection error.

To point the proxy at a Zwep somewhere else:

```bash
ZWEP_API=https://search.internal.example npm run dev --workspace web
```

## Build

```bash
npm run build      # → web/dist/
npm run preview --workspace web
```

Serve `dist/` from the same origin as the API, so `/v1` resolves without an
extra hop.

## Structure

```
web/
├── index.html            # pre-paint theme script; no external stylesheets
└── src/
    ├── main.ts           # shell, router, keyboard shortcuts, search state
    ├── client.ts         # typed API client, ApiError, timeouts
    ├── components.ts     # SearchBar, ResultList, preview overlay, graph, overview
    ├── admin.ts          # LibraryView — source management
    ├── dom.ts            # escaping, Disposables, focus trap, debounce
    ├── settings.ts       # localStorage-backed settings and theme resolution
    ├── views/settings.ts # Settings screen
    └── styles/
        ├── tokens.css    # design tokens, light and dark
        └── app.css       # layout and components
```

## Conventions

**Escape everything, allow `<mark>` deliberately.** Result text comes from
crawled pages. `escapeHtml` is the default; `sanitizeHighlight` is the single
exception, and it lets exactly one tag through.

**Every view returns its teardown.** The router disposes the previous view
before mounting the next. A view that registers a `window` listener or an
animation loop without routing it through `Disposables` will leak.

**Routing is history-based, with one `popstate` listener.** Links opt in with
`data-route="/path"`; a delegated handler on `document` intercepts them, so
browser back and forward work everywhere.

**No third-party requests.** No CDN fonts, no analytics, no external scripts.
A font stylesheet would receive every page view — and the referrer carries the
search query, which defeats the point of a private index.

## Accessibility

The search suggestions implement the ARIA combobox pattern
(`aria-expanded`, `aria-activedescendant`, `role="listbox"`/`"option"`).
Modals trap focus and restore it on close. Results announce through a live
region. There is one focus-ring definition for the whole app, and
`prefers-reduced-motion` disables the decorative animation.

## Testing

Component behaviour is tested under jsdom from the repository root:

```bash
npx vitest run --project web
```
