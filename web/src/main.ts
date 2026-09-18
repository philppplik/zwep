import './styles/tokens.css';
import './styles/app.css';

import type { FacetCounts } from '@zwep/shared';
import { SearchBar, ResultList, renderGraph, renderOverview } from './components.ts';
import { search, stats, ApiError } from './client.ts';
import { LibraryView } from './admin.ts';
import { renderSettings } from './views/settings.ts';
import { Disposables, escapeHtml } from './dom.ts';
import { applyTheme, loadSettings, saveSettings, type Theme } from './settings.ts';

/**
 * Application shell and router.
 *
 * Routing is history-based with a single `popstate` listener, so the browser's
 * back and forward buttons work everywhere. Each view returns its teardown
 * through `viewDisposables`, which is flushed before the next view mounts.
 */

const root = document.getElementById('app')!;

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

applyTheme(loadSettings().theme);

// Follow the OS when the user chose "system".
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
  if (loadSettings().theme === 'system') applyTheme('system');
});

const topbar = document.createElement('header');
topbar.className = 'z-topbar';
topbar.innerHTML = `
  <a class="z-topbar__brand" href="/" data-route="/">
    <img class="z-topbar__logo" src="/zwep-logo.png" alt="" width="28" height="28" />
    <span>Zwep</span>
  </a>
  <span class="z-topbar__title" id="z-view-title"></span>
  <nav class="z-topbar__nav" aria-label="Main">
    <a class="z-topbar__link" href="/library" data-route="/library">Library</a>
    <a class="z-topbar__link" href="/settings" data-route="/settings">Settings</a>
    <button class="z-topbar__theme" id="z-theme" type="button" aria-label="Switch colour theme"></button>
  </nav>
`;
root.appendChild(topbar);

const main = document.createElement('main');
main.className = 'z-main';
main.id = 'z-main';
root.appendChild(main);

const footer = document.createElement('footer');
footer.className = 'z-footer';
footer.innerHTML = `
  <span class="z-footer__tag" id="z-footer-tag">A small, self-hosted search engine. Search what you curate.</span>
  <nav class="z-footer__nav" aria-label="Footer">
    <a class="z-footer__link" href="https://github.com/philppplik/zwep" target="_blank" rel="noopener noreferrer">GitHub</a>
    <a class="z-footer__link" href="/library" data-route="/library">Library</a>
    <a class="z-footer__link" href="/settings" data-route="/settings">Settings</a>
  </nav>
`;
root.appendChild(footer);

function paintThemeButton(): void {
  const btn = topbar.querySelector<HTMLButtonElement>('#z-theme')!;
  const t = loadSettings().theme;
  btn.textContent = t === 'dark' ? '☀' : t === 'light' ? '☾' : '◐';
  btn.title = `Theme: ${t} (click to cycle)`;
}
paintThemeButton();

topbar.querySelector('#z-theme')!.addEventListener('click', () => {
  const order: Theme[] = ['system', 'light', 'dark'];
  const next = order[(order.indexOf(loadSettings().theme) + 1) % order.length];
  saveSettings({ theme: next });
  applyTheme(next);
  paintThemeButton();
});

// One delegated handler for every in-app link, anywhere in the document.
document.addEventListener('click', (e) => {
  const link = (e.target as HTMLElement).closest<HTMLElement>('[data-route]');
  if (!link) return;
  // Let the browser handle modified clicks (new tab, download, …).
  const me = e as MouseEvent;
  if (me.metaKey || me.ctrlKey || me.shiftKey || me.altKey || me.button !== 0) return;
  e.preventDefault();
  navigate(link.dataset.route!);
});

// ---------------------------------------------------------------------------
// Search state
// ---------------------------------------------------------------------------

interface SearchState {
  q: string;
  offset: number;
  type: string;
  facets: Map<string, string>;
  view: 'results' | 'graph';
}

const state: SearchState = { q: '', offset: 0, type: '', facets: new Map(), view: 'results' };

let searchAbort: AbortController | undefined;
const viewDisposables = new Disposables();

const searchBar = new SearchBar((q) => {
  state.q = q;
  state.offset = 0;
  state.facets.clear();
  navigate(searchUrl());
});

const results = new ResultList({
  onRetry: () => void runSearch(),
  onPage: (offset) => {
    if (offset < 0) return;
    state.offset = offset;
    navigate(searchUrl());
    main.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  onFacet: (kind, value) => {
    if (!value) state.facets.clear();
    else if (state.facets.get(kind) === value) state.facets.delete(kind);
    else state.facets.set(kind, value);
    state.offset = 0;
    navigate(searchUrl());
  },
});

function searchUrl(): string {
  const sp = new URLSearchParams({ q: state.q });
  if (state.type) sp.set('type', state.type);
  if (state.offset) sp.set('offset', String(state.offset));
  for (const [k, v] of state.facets) sp.set(`f_${k}`, v);
  if (state.view === 'graph') sp.set('view', 'graph');
  return `/?${sp}`;
}

const TABS = [
  { id: '', label: 'All' },
  { id: 'article', label: 'Articles' },
  { id: 'page', label: 'Pages' },
  { id: 'product', label: 'Products' },
  { id: 'video', label: 'Videos' },
  { id: 'graph', label: 'Graph' },
];

function renderHome(): void {
  main.className = 'z-main z-main--center';
  main.innerHTML = `
    <div class="z-hero">
      <img class="z-hero__logo" src="/zwep-logo.png" alt="" width="72" height="72" />
      <h1 class="z-hero__title">Zwep</h1>
      <p class="z-hero__sub">Search only what you curated.</p>
    </div>`;
  main.appendChild(searchBar.el);
  const tips = document.createElement('p');
  tips.className = 'z-hero__tips';
  tips.innerHTML = `Press <kbd>/</kbd> to focus · <a href="/library" data-route="/library">manage sources</a>`;
  main.appendChild(tips);
  results.clear();
  searchBar.focus();
}

function renderSearchShell(): void {
  main.className = 'z-main';
  main.innerHTML = '';

  const brand = document.createElement('div');
  brand.className = 'z-results__brand';
  main.appendChild(brand);
  main.appendChild(searchBar.el);

  const tabs = document.createElement('div');
  tabs.className = 'z-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.innerHTML = TABS.map((t) => {
    const active =
      t.id === 'graph' ? state.view === 'graph' : state.view === 'results' && state.type === t.id;
    return `<button class="z-tab${active ? ' is-active' : ''}" type="button" role="tab"
              aria-selected="${active}" data-type="${t.id}">${t.label}</button>`;
  }).join('');
  tabs.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.z-tab');
    if (!btn) return;
    const id = btn.dataset.type ?? '';
    if (id === 'graph') {
      state.view = 'graph';
    } else {
      state.view = 'results';
      state.type = id;
    }
    state.offset = 0;
    navigate(searchUrl());
  });
  main.appendChild(tabs);

  const overviewBox = document.createElement('div');
  overviewBox.id = 'z-overview';
  overviewBox.className = 'z-overview-wrap';
  main.appendChild(overviewBox);

  main.appendChild(results.el);
}

async function runSearch(): Promise<void> {
  if (!state.q.trim()) return renderHome();

  renderSearchShell();
  searchBar.setValue(state.q);
  results.setActiveFacets(state.facets);
  results.showSkeleton();

  searchAbort?.abort();
  searchAbort = new AbortController();
  const { signal } = searchAbort;

  const settings = loadSettings();
  const overviewEl = document.getElementById('z-overview');
  if (settings.overview && overviewEl) void renderOverview(overviewEl, state.q, signal);

  try {
    const resp = await search(
      {
        q: state.q,
        facets: true,
        limit: settings.resultsPerPage,
        offset: state.offset,
        type: state.type ? [state.type] : facetList('type'),
        source: facetList('source'),
        tag: facetList('tag'),
        lang: state.facets.get('lang'),
        semantic: settings.semantic || undefined,
      },
      signal,
    );
    if (signal.aborted) return;
    results.render(resp, state.q);
  } catch (e) {
    if (signal.aborted || (e as Error).name === 'AbortError') return;
    results.setError(e instanceof ApiError ? e : new Error(String(e)));
  }
}

function facetList(kind: keyof FacetCounts): string[] | undefined {
  const v = state.facets.get(kind);
  return v ? [v] : undefined;
}

async function showGraph(): Promise<void> {
  renderSearchShell();
  searchBar.setValue(state.q);
  results.clear();

  const wrap = document.createElement('div');
  wrap.className = 'z-graph-view';
  main.appendChild(wrap);

  const exportBtn = document.createElement('button');
  exportBtn.className = 'z-btn z-graph-export';
  exportBtn.type = 'button';
  exportBtn.textContent = '⬇ Export graph as JSON';
  exportBtn.addEventListener('click', () => {
    window.open(`/v1/graph?q=${encodeURIComponent(state.q)}&export=json`, '_blank', 'noopener');
  });
  main.appendChild(exportBtn);

  searchAbort?.abort();
  searchAbort = new AbortController();
  const teardown = await renderGraph(wrap, state.q, searchAbort.signal);
  viewDisposables.add(teardown);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function navigate(url: string, replace = false): void {
  if (replace) history.replaceState({}, '', url);
  else history.pushState({}, '', url);
  void route();
}

function setTitle(title: string): void {
  topbar.querySelector('#z-view-title')!.textContent = title;
  document.title = title ? `${title} · Zwep` : 'Zwep — self-hosted search';
}

async function route(): Promise<void> {
  viewDisposables.dispose();
  searchAbort?.abort();
  document.querySelector('.z-overlay')?.remove();
  document.body.classList.remove('z-no-scroll');

  const path = location.pathname;
  const params = new URLSearchParams(location.search);

  // `/admin` is kept as an alias so old bookmarks keep working.
  if (path.startsWith('/library') || path.startsWith('/admin')) {
    setTitle('Library');
    main.className = 'z-main';
    main.innerHTML = '';
    const view = new LibraryView();
    main.appendChild(view.el);
    viewDisposables.add(() => view.destroy());
    await view.mount();
    return;
  }

  if (path.startsWith('/settings')) {
    setTitle('Settings');
    main.className = 'z-main';
    main.innerHTML = '';
    const teardown = renderSettings(main);
    viewDisposables.add(teardown);
    return;
  }

  state.q = params.get('q') ?? '';
  state.type = params.get('type') ?? '';
  state.offset = Number(params.get('offset')) || 0;
  state.view = params.get('view') === 'graph' ? 'graph' : 'results';
  state.facets = new Map(
    [...params.entries()].filter(([k]) => k.startsWith('f_')).map(([k, v]) => [k.slice(2), v]),
  );

  if (!state.q) {
    setTitle('');
    return renderHome();
  }
  setTitle(state.q);
  if (state.view === 'graph') return showGraph();
  return runSearch();
}

window.addEventListener('popstate', () => void route());

// ---------------------------------------------------------------------------
// Global keyboard shortcuts
// ---------------------------------------------------------------------------

document.addEventListener('keydown', (e) => {
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName);
  if (e.key === '/' && !typing) {
    e.preventDefault();
    searchBar.focus();
  }
  if (e.key === 'Escape' && typing && (e.target as HTMLElement).tagName === 'INPUT') {
    (e.target as HTMLInputElement).blur();
  }
  if (e.key === 'g' && !typing && state.q) {
    state.view = state.view === 'graph' ? 'results' : 'graph';
    navigate(searchUrl());
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

void route();

stats()
  .then((s) => {
    const tag = footer.querySelector('#z-footer-tag');
    if (!tag || !s.ok) return;
    tag.innerHTML =
      `<strong>${s.indexed.toLocaleString()}</strong> documents · ` +
      `<strong>${s.sourcesEnabled}</strong> of ${s.sources} sources active`;
  })
  .catch((e) => {
    const tag = footer.querySelector('#z-footer-tag');
    if (!tag) return;
    // "API offline" and "the API is up but Meilisearch is not" need different
    // commands to fix, so they must not share a message.
    const indexDown = e instanceof ApiError && e.code === 'index_unavailable';
    const [label, hint] = indexDown
      ? ['Index unavailable', 'npm run infra:up']
      : ['API offline', 'npm run dev'];
    tag.innerHTML = `<span class="z-footer__warn">${label}</span> — run <code>${escapeHtml(hint)}</code>`;
  });
