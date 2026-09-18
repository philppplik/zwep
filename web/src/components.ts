import type { SearchResponse, SearchResult, FacetCounts } from '@zwep/shared';
import {
  suggest,
  graph,
  overview,
  ApiError,
  type SuggestItem,
  type GraphResponse,
  type OverviewResponse,
} from './client.ts';
import {
  Disposables,
  debounce,
  escapeHtml,
  formatDate,
  safeHost,
  safeUrl,
  sanitizeHighlight,
  trapFocus,
} from './dom.ts';

// ---------------------------------------------------------------------------
// Search bar
// ---------------------------------------------------------------------------

/**
 * The search input, with a debounced suggestion list.
 *
 * Implements the ARIA combobox pattern: the listbox is owned by the input,
 * the active option is announced through `aria-activedescendant`, and arrow
 * keys move the selection without moving DOM focus.
 */
export class SearchBar {
  readonly el: HTMLFormElement;
  private input: HTMLInputElement;
  private suggestBox: HTMLDivElement;
  private items: SuggestItem[] = [];
  private active = -1;
  private onSearch: (q: string) => void;
  private disposables = new Disposables();
  private inflight?: AbortController;
  private destroyed = false;
  private runSuggest = debounce(() => void this.fetchSuggestions(), 180);

  constructor(onSearch: (q: string) => void) {
    this.onSearch = onSearch;
    this.el = document.createElement('form');
    this.el.className = 'z-search';
    this.el.setAttribute('role', 'search');
    this.el.innerHTML = `
      <label class="z-sr-only" for="z-q">Search the index</label>
      <input
        class="z-search__input"
        id="z-q"
        name="q"
        type="search"
        placeholder="Search the index…"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        role="combobox"
        aria-expanded="false"
        aria-controls="z-suggest"
        aria-autocomplete="list"
      />
      <button class="z-search__clear" type="button" aria-label="Clear search" hidden>×</button>
      <button class="z-search__btn" type="submit" aria-label="Search">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>
        </svg>
      </button>
      <div class="z-suggest" id="z-suggest" role="listbox" aria-label="Suggestions" hidden></div>
    `;
    this.input = this.el.querySelector('.z-search__input')!;
    this.suggestBox = this.el.querySelector('.z-suggest')!;
    const clear = this.el.querySelector<HTMLButtonElement>('.z-search__clear')!;

    this.el.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = this.input.value.trim();
      if (!q) return;
      this.hideSuggest();
      this.onSearch(q);
    });

    this.input.addEventListener('input', () => {
      clear.hidden = !this.input.value;
      this.runSuggest();
    });
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    clear.addEventListener('click', () => {
      this.input.value = '';
      clear.hidden = true;
      this.hideSuggest();
      this.input.focus();
    });

    // Close the suggestion list when focus or a click leaves the search area.
    this.disposables.listen(document, 'click', (e) => {
      if (!this.el.contains(e.target as Node)) this.hideSuggest();
    });
    this.disposables.listen(document, 'focusin', (e) => {
      if (!this.el.contains(e.target as Node)) this.hideSuggest();
    });
  }

  focus(): void {
    this.input.focus();
    this.input.select();
  }

  setValue(q: string): void {
    this.input.value = q;
    this.el.querySelector<HTMLButtonElement>('.z-search__clear')!.hidden = !q;
  }

  get value(): string {
    return this.input.value;
  }

  /**
   * Tear the bar down: cancel the pending debounce, abort any in-flight
   * request and drop every listener.
   *
   * The `destroyed` flag matters because the element can outlive the call —
   * the shell reuses one search bar across views, so a keystroke arriving
   * after teardown would otherwise schedule a fresh request against a
   * component nobody is listening to any more.
   */
  destroy(): void {
    this.destroyed = true;
    this.runSuggest.cancel();
    this.inflight?.abort();
    this.inflight = undefined;
    this.disposables.dispose();
  }

  private async fetchSuggestions(): Promise<void> {
    if (this.destroyed) return;
    const q = this.input.value.trim();
    if (q.length < 2) return this.hideSuggest();
    // Cancel the previous request: with fast typing, late responses used to
    // overwrite the list with stale suggestions.
    this.inflight?.abort();
    const ctrl = new AbortController();
    this.inflight = ctrl;
    try {
      const items = await suggest(q, 8, ctrl.signal);
      if (ctrl.signal.aborted) return;
      this.items = items;
      this.renderSuggest();
    } catch {
      this.hideSuggest();
    }
  }

  private renderSuggest(): void {
    if (!this.items.length) return this.hideSuggest();
    this.active = -1;
    this.suggestBox.innerHTML = this.items
      .map(
        (s, i) => `
        <div class="z-suggest__item" role="option" id="z-suggest-${i}" aria-selected="false" data-i="${i}">
          <span class="z-suggest__text">${escapeHtml(s.text)}</span>
          <span class="z-suggest__type">${escapeHtml(s.type)}</span>
        </div>`,
      )
      .join('');
    this.suggestBox.hidden = false;
    this.input.setAttribute('aria-expanded', 'true');
    this.suggestBox.querySelectorAll<HTMLElement>('.z-suggest__item').forEach((node) => {
      // `mousedown` rather than `click`: the input's blur would otherwise hide
      // the list before the click landed.
      node.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.choose(Number(node.dataset.i));
      });
    });
  }

  private choose(i: number): void {
    const s = this.items[i];
    if (!s) return;
    this.setValue(s.text);
    this.hideSuggest();
    this.onSearch(s.text);
  }

  private onKey(e: KeyboardEvent): void {
    if (this.suggestBox.hidden) {
      if (e.key === 'ArrowDown') this.runSuggest();
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.move(-1);
        break;
      case 'Enter':
        if (this.active >= 0) {
          e.preventDefault();
          this.choose(this.active);
        }
        break;
      case 'Escape':
        e.preventDefault();
        this.hideSuggest();
        break;
    }
  }

  private move(delta: number): void {
    const n = this.items.length;
    if (!n) return;
    this.active = (this.active + delta + n + 1) % (n + 1); // the extra slot is "nothing selected"
    if (this.active === n) this.active = -1;
    this.highlight();
  }

  private highlight(): void {
    this.suggestBox.querySelectorAll<HTMLElement>('.z-suggest__item').forEach((n, i) => {
      const on = i === this.active;
      n.classList.toggle('is-active', on);
      n.setAttribute('aria-selected', String(on));
      if (on) n.scrollIntoView({ block: 'nearest' });
    });
    if (this.active >= 0) this.input.setAttribute('aria-activedescendant', `z-suggest-${this.active}`);
    else this.input.removeAttribute('aria-activedescendant');
  }

  private hideSuggest(): void {
    this.suggestBox.hidden = true;
    this.suggestBox.innerHTML = '';
    this.items = [];
    this.active = -1;
    this.input.setAttribute('aria-expanded', 'false');
    this.input.removeAttribute('aria-activedescendant');
  }
}

// ---------------------------------------------------------------------------
// Result list
// ---------------------------------------------------------------------------

export interface ResultListHandlers {
  onFacet?: (kind: keyof FacetCounts, value: string) => void;
  onPage?: (offset: number) => void;
  onRetry?: () => void;
}

/** Facet keys in the order they are shown, with their display labels. */
const FACET_GROUPS: { key: keyof FacetCounts; label: string }[] = [
  { key: 'source', label: 'Source' },
  { key: 'type', label: 'Type' },
  { key: 'lang', label: 'Language' },
  { key: 'tag', label: 'Tag' },
];

export class ResultList {
  readonly el: HTMLDivElement;
  private handlers: ResultListHandlers;
  private disposables = new Disposables();
  private activeFacets = new Map<string, string>();

  constructor(handlers: ResultListHandlers = {}) {
    this.handlers = handlers;
    this.el = document.createElement('div');
    this.el.className = 'z-results';
    this.el.setAttribute('aria-live', 'polite');
    this.el.setAttribute('aria-busy', 'false');

    // One delegated listener for the whole list, instead of rebinding every
    // result on each render.
    this.el.addEventListener('click', (e) => this.onClick(e));
  }

  setActiveFacets(facets: Map<string, string>): void {
    this.activeFacets = facets;
  }

  destroy(): void {
    this.disposables.dispose();
  }

  render(resp: SearchResponse, query: string): void {
    this.el.setAttribute('aria-busy', 'false');
    if (!resp.results.length) {
      this.el.innerHTML = emptyStateHtml(query, this.activeFacets.size > 0);
      return;
    }
    const semantic = resp.semantic ? ' · <span class="z-badge">hybrid</span>' : '';
    const meta = `${resp.total.toLocaleString()} result${resp.total === 1 ? '' : 's'} · ${resp.took_ms} ms${semantic}`;

    this.el.innerHTML = `
      <div class="z-results__meta">${meta}</div>
      ${this.facetsHtml(resp.facets)}
      <ol class="z-results__list" start="${resp.offset + 1}">
        ${resp.results.map((r, i) => `<li>${resultHtml(r, i)}</li>`).join('')}
      </ol>
      ${paginationHtml(resp)}
    `;
  }

  showSkeleton(count = 6): void {
    this.el.setAttribute('aria-busy', 'true');
    this.el.innerHTML = `<div class="z-skel-wrap" aria-hidden="true">${Array.from({ length: count })
      .map(
        () => `
      <div class="z-skel">
        <div class="z-skel__line z-skel__line--sm"></div>
        <div class="z-skel__line z-skel__line--lg"></div>
        <div class="z-skel__line z-skel__line--md"></div>
      </div>`,
      )
      .join('')}</div>`;
  }

  setError(err: unknown): void {
    this.el.setAttribute('aria-busy', 'false');
    const apiErr = err instanceof ApiError ? err : null;
    const message = apiErr
      ? apiErr.isOffline
        ? 'Cannot reach the search service.'
        : apiErr.message
      : ((err as Error)?.message ?? 'Something went wrong while searching.');
    const hint = apiErr?.isOffline
      ? 'The web UI proxies /v1/* to the API on port 8080. Start both with <code>npm run dev</code>.'
      : apiErr?.code === 'index_unavailable'
        ? 'Meilisearch is not reachable. Start it with <code>npm run infra:up</code>.'
        : '';
    this.el.innerHTML = `
      <div class="z-error" role="alert">
        <div class="z-error__icon" aria-hidden="true">!</div>
        <div class="z-error__body">
          <div class="z-error__msg">${escapeHtml(message)}</div>
          ${hint ? `<p class="z-error__hint">${hint}</p>` : ''}
        </div>
        <button class="z-btn z-btn--primary" type="button" data-action="retry">Try again</button>
      </div>`;
  }

  clear(): void {
    this.el.innerHTML = '';
  }

  private facetsHtml(facets?: FacetCounts): string {
    if (!facets) return '';
    const groups = FACET_GROUPS.map(({ key, label }) => {
      const values = facets[key];
      if (!values) return '';
      const chips = Object.entries(values)
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([value, n]) => {
          const on = this.activeFacets.get(key) === value;
          return `<button class="z-facet${on ? ' is-active' : ''}" type="button"
              data-facet="${escapeHtml(key)}" data-value="${escapeHtml(value)}"
              aria-pressed="${on}">${escapeHtml(value)} <span>${n}</span></button>`;
        })
        .join('');
      return chips ? `<div class="z-facets__group"><span class="z-facets__label">${label}</span>${chips}</div>` : '';
    }).join('');
    if (!groups) return '';
    const clear = this.activeFacets.size
      ? `<button class="z-facet z-facet--clear" type="button" data-facet="__clear">Clear filters</button>`
      : '';
    return `<div class="z-facets">${groups}${clear}</div>`;
  }

  private onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;

    const retry = target.closest('[data-action="retry"]');
    if (retry) return this.handlers.onRetry?.();

    const facet = target.closest<HTMLElement>('[data-facet]');
    if (facet) {
      const kind = facet.dataset.facet!;
      if (kind === '__clear') return this.handlers.onFacet?.('source' as keyof FacetCounts, '');
      return this.handlers.onFacet?.(kind as keyof FacetCounts, facet.dataset.value ?? '');
    }

    const page = target.closest<HTMLElement>('[data-offset]');
    if (page) return this.handlers.onPage?.(Number(page.dataset.offset));

    const info = target.closest<HTMLElement>('[data-qinfo]');
    if (info) {
      e.stopPropagation();
      const pop = info.parentElement?.querySelector('.z-quality__pop');
      const wasOpen = pop?.classList.contains('is-open');
      this.el.querySelectorAll('.z-quality__pop.is-open').forEach((p) => p.classList.remove('is-open'));
      if (!wasOpen) pop?.classList.add('is-open');
      info.setAttribute('aria-expanded', String(!wasOpen));
      return;
    }

    // Clicking the card (but not a link or button inside it) opens the preview.
    const card = target.closest<HTMLElement>('.z-result');
    if (card && !target.closest('a, button')) {
      const raw = card.getAttribute('data-doc');
      if (!raw) return;
      try {
        openPreview(JSON.parse(decodeURIComponent(raw)) as SearchResult);
      } catch {
        /* a malformed payload just means no preview */
      }
    }
  }
}

function emptyStateHtml(query: string, filtered: boolean): string {
  return `
    <div class="z-empty">
      <div class="z-empty__icon" aria-hidden="true">⌕</div>
      <h2 class="z-empty__title">No results for “${escapeHtml(query)}”</h2>
      <ul class="z-empty__hints">
        ${filtered ? '<li>Clear the active filters — they may be excluding every match.</li>' : ''}
        <li>Check the spelling, or try a broader term.</li>
        <li>The index only contains what you curated. Add a source in the
            <a href="/library" data-route="/library">Library</a> and crawl it.</li>
      </ul>
    </div>`;
}

function paginationHtml(resp: SearchResponse): string {
  const { offset, limit, total } = resp;
  if (total <= limit) return '';
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.ceil(total / limit);
  const prev = offset > 0 ? offset - limit : -1;
  const next = offset + limit < total ? offset + limit : -1;
  return `
    <nav class="z-pager" aria-label="Search results pages">
      <button class="z-btn" type="button" data-offset="${prev}" ${prev < 0 ? 'disabled' : ''}>← Previous</button>
      <span class="z-pager__label">Page ${page} of ${pages.toLocaleString()}</span>
      <button class="z-btn" type="button" data-offset="${next}" ${next < 0 ? 'disabled' : ''}>Next →</button>
    </nav>`;
}

function qualityBand(score: number): 'low' | 'medium' | 'high' {
  if (score >= 0.7) return 'high';
  if (score >= 0.45) return 'medium';
  return 'low';
}

function resultHtml(r: SearchResult, i: number): string {
  // Highlighted variants are HTML from the API; everything else is escaped.
  const title = r.highlighted?.title ? sanitizeHighlight(r.highlighted.title) : escapeHtml(r.title);
  const excerpt = r.highlighted?.excerpt
    ? sanitizeHighlight(r.highlighted.excerpt)
    : escapeHtml(r.excerpt);
  const url = safeUrl(r.url);
  const published = formatDate(r.published_at);
  const tags = (r.tags ?? [])
    .slice(0, 5)
    .map((t) => `<span class="z-chip">${escapeHtml(t)}</span>`)
    .join('');
  const q = r.quality;

  return `
    <article class="z-result" style="animation-delay:${Math.min(i * 20, 200)}ms"
             data-doc="${escapeHtml(encodeURIComponent(JSON.stringify(r)))}">
      <div class="z-result__head">
        ${r.favicon ? `<img class="z-result__fav" src="${escapeHtml(safeUrl(r.favicon))}" alt="" loading="lazy" width="16" height="16" />` : ''}
        <span class="z-result__source">${escapeHtml(r.source)}</span>
        ${published ? `<span class="z-result__date">${escapeHtml(published)}</span>` : ''}
        ${q ? qualityBadgeHtml(q.score, q) : ''}
      </div>
      <h3 class="z-result__title">
        <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${title}</a>
      </h3>
      <div class="z-result__url">${escapeHtml(safeHost(r.url))}</div>
      <p class="z-result__excerpt">${excerpt}</p>
      ${tags ? `<div class="z-result__tags">${tags}</div>` : ''}
    </article>`;
}

function qualityBadgeHtml(score: number, q: NonNullable<SearchResult['quality']>): string {
  const pct = (n: number) => Math.round(n * 100);
  return `
    <span class="z-quality z-quality--${qualityBand(score)}">
      ${pct(score)}
      <button class="z-quality__info" type="button" data-qinfo
              aria-label="How is the quality index calculated?" aria-expanded="false">i</button>
      <span class="z-quality__pop" role="tooltip">
        <strong>Quality index</strong>
        <span>Every result is scored 0–100 from four signals:</span>
        <ul>
          <li><b>Length</b> ${pct(q.length)} — content depth</li>
          <li><b>Freshness</b> ${pct(q.freshness)} — how recent</li>
          <li><b>Title</b> ${pct(q.title)} — title clarity</li>
          <li><b>Structure</b> ${pct(q.structure)} — heading structure</li>
        </ul>
        <span>Higher means more substantial. It informs ranking, it does not replace it.</span>
      </span>
    </span>`;
}

// ---------------------------------------------------------------------------
// Preview overlay
// ---------------------------------------------------------------------------

/** Knowledge card built from a result's JSON-LD structured data. */
function knowledgeCardHtml(doc: SearchResult): string {
  const s = doc.structured as Record<string, unknown> | null | undefined;
  if (!s) return '';
  const pick = (v: unknown): string => {
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object' && 'name' in v) return String((v as { name: unknown }).name);
    return '';
  };
  const rows: string[] = [];
  const row = (label: string, value: string) =>
    value ? `<div class="z-card__row"><span>${label}</span><b>${escapeHtml(value)}</b></div>` : '';
  rows.push(row('Author', pick(s.author)));
  rows.push(row('Published', formatDate(typeof s.datePublished === 'string' ? s.datePublished : undefined)));
  rows.push(row('Brand', pick(s.brand)));
  const offers = s.offers as { price?: unknown; priceCurrency?: unknown } | undefined;
  const price = offers?.price ?? s.price;
  rows.push(row('Price', price ? `${price} ${offers?.priceCurrency ?? ''}`.trim() : ''));

  const img = typeof s.image === 'string' ? s.image : Array.isArray(s.image) ? String(s.image[0]) : '';
  const type = String(s['@type'] ?? '');
  const name = pick(s.name) || pick(s.headline) || doc.title;
  const desc = typeof s.description === 'string' ? s.description : '';

  if (!rows.filter(Boolean).length && !desc && !img) return '';
  return `
    <aside class="z-card" aria-label="Structured data">
      ${type ? `<div class="z-card__type">${escapeHtml(type)}</div>` : ''}
      ${img ? `<img class="z-card__img" src="${escapeHtml(safeUrl(img))}" alt="" loading="lazy" />` : ''}
      <h4 class="z-card__name">${escapeHtml(name)}</h4>
      ${desc ? `<p class="z-card__desc">${escapeHtml(desc)}</p>` : ''}
      ${rows.join('')}
    </aside>`;
}

/** Blur-backdrop preview for a single result. */
export function openPreview(doc: SearchResult): void {
  document.querySelector('.z-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'z-overlay';
  const url = safeUrl(doc.url);
  const card = knowledgeCardHtml(doc);
  overlay.innerHTML = `
    <div class="z-overlay__backdrop" data-close></div>
    <div class="z-overlay__panel" role="dialog" aria-modal="true" aria-labelledby="z-overlay-title">
      <button class="z-overlay__close" type="button" aria-label="Close preview" data-close>×</button>
      <div class="z-overlay__body">
        <div class="z-overlay__main">
          <div class="z-result__head">
            ${doc.favicon ? `<img class="z-result__fav" src="${escapeHtml(safeUrl(doc.favicon))}" alt="" width="16" height="16" />` : ''}
            <span class="z-result__source">${escapeHtml(doc.source)}</span>
            ${doc.published_at ? `<span class="z-result__date">${escapeHtml(formatDate(doc.published_at))}</span>` : ''}
          </div>
          <h3 class="z-overlay__title" id="z-overlay-title">
            <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(doc.title)}</a>
          </h3>
          <div class="z-result__url">${escapeHtml(safeHost(doc.url))}</div>
          <p class="z-overlay__excerpt">${escapeHtml(doc.excerpt)}</p>
          <a class="z-btn z-btn--primary" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">
            Open page ↗
          </a>
        </div>
        ${card ? `<div class="z-overlay__side">${card}</div>` : ''}
      </div>
    </div>`;

  document.body.appendChild(overlay);
  document.body.classList.add('z-no-scroll');
  requestAnimationFrame(() => overlay.classList.add('is-open'));

  const panel = overlay.querySelector<HTMLElement>('.z-overlay__panel')!;
  const releaseFocus = trapFocus(panel, () => close());

  function close() {
    releaseFocus();
    overlay.classList.remove('is-open');
    document.body.classList.remove('z-no-scroll');
    setTimeout(() => overlay.remove(), 180);
  }

  overlay.querySelectorAll<HTMLElement>('[data-close]').forEach((n) =>
    n.addEventListener('click', close),
  );
}

// ---------------------------------------------------------------------------
// Knowledge graph
// ---------------------------------------------------------------------------

/**
 * Render a knowledge-graph neighbourhood as an interactive canvas force graph.
 * Returns a teardown function — the caller MUST call it when leaving the view,
 * otherwise the simulation keeps running in the background.
 */
export async function renderGraph(
  el: HTMLElement,
  query: string,
  signal?: AbortSignal,
): Promise<() => void> {
  el.innerHTML = `<div class="z-graph-loading">Building the knowledge graph for “${escapeHtml(query)}”…</div>`;
  let data: GraphResponse;
  try {
    data = await graph(query, signal);
  } catch (e) {
    el.innerHTML = `<div class="z-empty"><p>Could not load the graph: ${escapeHtml((e as Error).message)}</p></div>`;
    return () => {};
  }
  if (!data.nodes.length) {
    el.innerHTML = `<div class="z-empty">
      <h2 class="z-empty__title">No entities for “${escapeHtml(query)}”</h2>
      <p>The graph grows as you crawl. Index more sources to see connections.</p>
    </div>`;
    return () => {};
  }
  el.innerHTML = `
    <div class="z-graph">
      <div class="z-graph__bar">
        <span class="z-graph__title">Knowledge graph</span>
        <span class="z-graph__stats">
          ${data.nodes.length} entities · ${data.edges.length} relations · ${data.stats.entities} in the graph
        </span>
      </div>
      <canvas class="z-graph__canvas" role="img"
              aria-label="Force-directed graph of ${escapeHtml(String(data.nodes.length))} related entities"></canvas>
    </div>`;
  return drawForceGraph(el.querySelector('canvas')!, data);
}

/** Minimal force-directed layout on canvas, no dependencies. */
function drawForceGraph(canvas: HTMLCanvasElement, data: GraphResponse): () => void {
  const disposables = new Disposables();
  const dpr = window.devicePixelRatio || 1;
  const parent = canvas.parentElement!;

  const resize = () => {
    const w = parent.clientWidth;
    const h = Math.max(360, parent.clientHeight - 60);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  };
  resize();
  disposables.listen(window, 'resize', resize);

  const nodes = data.nodes.map((n, i) => ({
    ...n,
    x: canvas.width / 2 + Math.cos((i / data.nodes.length) * Math.PI * 2) * 120 * dpr,
    y: canvas.height / 2 + Math.sin((i / data.nodes.length) * Math.PI * 2) * 120 * dpr,
    vx: 0,
    vy: 0,
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = data.edges.filter((e) => byId.has(e.src) && byId.has(e.dst));

  let dragNode: (typeof nodes)[number] | null = null;
  const radius = (n: (typeof nodes)[number]) => (8 + Math.min(n.doc_count, 10)) * dpr;

  const draw = () => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)';
    ctx.lineWidth = dpr;
    for (const e of edges) {
      const a = byId.get(e.src)!;
      const b = byId.get(e.dst)!;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    for (const n of nodes) {
      const r = radius(n);
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = n.type === 'org' ? '#ff6600' : isDark ? '#5b9dff' : '#1f4ed8';
      ctx.fill();
      ctx.fillStyle = isDark ? '#e8e8ee' : '#1a1a1f';
      ctx.font = `${12 * dpr}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(n.label.slice(0, 18), n.x, n.y + r + 14 * dpr);
    }
  };

  disposables.raf(() => {
    // Repulsion between every pair, attraction along edges, gentle centring.
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        const d = Math.hypot(dx, dy) || 1;
        const force = (4000 * dpr * dpr) / (d * d);
        dx /= d;
        dy /= d;
        a.vx += dx * force;
        a.vy += dy * force;
        b.vx -= dx * force;
        b.vy -= dy * force;
      }
    }
    for (const e of edges) {
      const a = byId.get(e.src)!;
      const b = byId.get(e.dst)!;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      const force = (d - 90 * dpr) * 0.02;
      dx /= d;
      dy /= d;
      a.vx += dx * force;
      a.vy += dy * force;
      b.vx -= dx * force;
      b.vy -= dy * force;
    }
    for (const n of nodes) {
      n.vx += (canvas.width / 2 - n.x) * 0.002;
      n.vy += (canvas.height / 2 - n.y) * 0.002;
      n.vx *= 0.85;
      n.vy *= 0.85;
      if (n !== dragNode) {
        n.x += n.vx;
        n.y += n.vy;
      }
    }
    draw();
  });

  const pointAt = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * dpr, y: (e.clientY - rect.top) * dpr };
  };
  disposables.listen(canvas, 'mousedown', ((e: MouseEvent) => {
    const p = pointAt(e);
    dragNode = nodes.find((n) => Math.hypot(n.x - p.x, n.y - p.y) < radius(n) + 4) ?? null;
  }) as EventListener);
  disposables.listen(canvas, 'mousemove', ((e: MouseEvent) => {
    if (!dragNode) return;
    const p = pointAt(e);
    dragNode.x = p.x;
    dragNode.y = p.y;
  }) as EventListener);
  disposables.listen(window, 'mouseup', () => {
    dragNode = null;
  });

  return () => disposables.dispose();
}

// ---------------------------------------------------------------------------
// AI overview
// ---------------------------------------------------------------------------

/** Google-style AI summary of the top curated results. */
export async function renderOverview(
  el: HTMLElement,
  query: string,
  signal?: AbortSignal,
): Promise<void> {
  el.innerHTML = `
    <div class="z-overview z-overview--loading">
      <span class="z-overview__spark" aria-hidden="true">✦</span> Generating overview…
    </div>`;
  let data: OverviewResponse;
  try {
    data = await overview(query, signal);
  } catch (e) {
    // A missing or unreachable LLM is an expected state, not an error to shout
    // about: the overview is opt-in and the results below are unaffected.
    el.innerHTML =
      e instanceof ApiError && e.code === 'llm_unavailable'
        ? `<div class="z-overview z-overview--off">
             <span class="z-overview__spark" aria-hidden="true">✦</span>
             AI overview is enabled but no model is reachable.
             <a href="/settings" data-route="/settings">Configure a provider</a>.
           </div>`
        : '';
    return;
  }
  if (!data.overview?.trim()) {
    el.innerHTML = '';
    return;
  }
  const sources = (data.sources ?? [])
    .map(
      (s, i) =>
        `<a class="z-overview__src" href="${escapeHtml(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer">
           <span class="z-overview__srcnum">${i + 1}</span>${escapeHtml(s.source || safeHost(s.url))}
         </a>`,
    )
    .join('');
  el.innerHTML = `
    <section class="z-overview" aria-label="AI overview">
      <div class="z-overview__head">
        <span class="z-overview__spark" aria-hidden="true">✦</span> AI overview
        ${data.cached ? '<span class="z-overview__badge">cached</span>' : ''}
      </div>
      <div class="z-overview__body">${escapeHtml(data.overview).replace(/\n/g, '<br>')}</div>
      ${sources ? `<div class="z-overview__sources">${sources}</div>` : ''}
      <p class="z-overview__foot">
        Summarized from your curated sources. Generative AI can be wrong — check the sources.
      </p>
    </section>`;
}
