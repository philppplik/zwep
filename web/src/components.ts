import type { SearchResponse, SearchResult } from '@zwep/shared';
import { suggest, graph, overview, type SuggestItem, type GraphResponse, type OverviewResponse } from './client.ts';

function debounce<T extends (...a: any[]) => void>(fn: T, ms: number): T {
  let t: ReturnType<typeof setTimeout> | undefined;
  return ((...args: any[]) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  }) as T;
}

export class SearchBar {
  readonly el: HTMLFormElement;
  private input: HTMLInputElement;
  private suggestBox: HTMLDivElement;
  private items: SuggestItem[] = [];
  private active = -1;
  private onSearch: (q: string) => void;

  constructor(onSearch: (q: string) => void) {
    this.onSearch = onSearch;
    this.el = document.createElement('form');
    this.el.className = 'z-search';
    this.el.innerHTML = `
      <input class="z-search__input" type="text" placeholder="Search the index…" autocomplete="off" spellcheck="false" />
      <button class="z-search__btn" type="submit" aria-label="Search">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
      </button>
      <div class="z-suggest" hidden></div>
    `;
    this.input = this.el.querySelector('.z-search__input')!;
    this.suggestBox = this.el.querySelector('.z-suggest')!;

    this.el.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = this.input.value.trim();
      if (q) {
        this.hideSuggest();
        this.onSearch(q);
      }
    });
    this.input.addEventListener('input', debounce(() => this.runSuggest(), 180));
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.input.addEventListener('blur', () => setTimeout(() => this.hideSuggest(), 150));
    document.addEventListener('click', (e) => {
      if (!this.el.contains(e.target as Node)) this.hideSuggest();
    });
  }

  focus() {
    this.input.focus();
  }

  setValue(q: string) {
    this.input.value = q;
  }

  private async runSuggest() {
    const q = this.input.value.trim();
    if (!q) return this.hideSuggest();
    try {
      this.items = await suggest(q);
      this.renderSuggest();
    } catch {
      this.hideSuggest();
    }
  }

  private renderSuggest() {
    if (!this.items.length) return this.hideSuggest();
    this.active = -1;
    this.suggestBox.innerHTML = this.items
      .map(
        (s, i) => `
        <div class="z-suggest__item" data-i="${i}">
          <span>${escapeHtml(s.text)}</span>
          <span class="z-suggest__type">${escapeHtml(s.type)}</span>
        </div>`
      )
      .join('');
    this.suggestBox.hidden = false;
    this.suggestBox.querySelectorAll<HTMLElement>('.z-suggest__item').forEach((node) => {
      node.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const i = Number(node.dataset.i);
        this.choose(i);
      });
    });
  }

  private choose(i: number) {
    const s = this.items[i];
    if (!s) return;
    this.input.value = s.text;
    this.hideSuggest();
    this.onSearch(s.text);
  }

  private onKey(e: KeyboardEvent) {
    if (this.suggestBox.hidden) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.active = Math.min(this.active + 1, this.items.length - 1);
      this.highlight();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.active = Math.max(this.active - 1, 0);
      this.highlight();
    } else if (e.key === 'Enter' && this.active >= 0) {
      e.preventDefault();
      this.choose(this.active);
    } else if (e.key === 'Escape') {
      this.hideSuggest();
    }
  }

  private highlight() {
    this.suggestBox.querySelectorAll<HTMLElement>('.z-suggest__item').forEach((n, i) => {
      n.classList.toggle('is-active', i === this.active);
    });
  }

  private hideSuggest() {
    this.suggestBox.hidden = true;
    this.items = [];
    this.active = -1;
  }
}

export class ResultList {
  readonly el: HTMLDivElement;
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'z-results';
  }

  render(resp: SearchResponse, query: string) {
    if (!resp.results.length) {
      this.el.innerHTML = `<div class="z-empty">No results for “${escapeHtml(query)}”.</div>`;
      return;
    }
    const meta = `${resp.total} result${resp.total === 1 ? '' : 's'} · ${resp.took_ms} ms`;
    const facets = resp.facets
      ? `<div class="z-facets">${facetChips(resp.facets)}</div>`
      : '';
    this.el.innerHTML = `
      <div class="z-results__meta">${meta}</div>
      ${facets}
      ${resp.results.map((r, i) => resultHtml(r, i)).join('')}
    `;
    // quality info popovers (toggle on click, close others)
    this.el.querySelectorAll<HTMLButtonElement>('[data-qinfo]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const pop = btn.parentElement!.querySelector('.z-quality__pop') as HTMLElement;
        const open = pop.classList.contains('is-open');
        this.el.querySelectorAll('.z-quality__pop.is-open').forEach((p) => p.classList.remove('is-open'));
        if (!open) pop.classList.add('is-open');
      });
    });
    document.addEventListener('click', () => {
      this.el.querySelectorAll('.z-quality__pop.is-open').forEach((p) => p.classList.remove('is-open'));
    }, { once: true });
    // open preview overlay when clicking a result (not the link itself)
    this.el.querySelectorAll<HTMLElement>('.z-result').forEach((art) => {
      art.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('a, button')) return;
        const raw = art.getAttribute('data-doc');
        if (!raw) return;
        try {
          const doc = JSON.parse(decodeURIComponent(raw)) as SearchResult;
          openOverlay(doc);
        } catch { /* ignore */ }
      });
    });
  }

  showSkeleton(count = 6) {
    const rows = Array.from({ length: count })
      .map(
        () => `
      <div class="z-skel">
        <div class="z-skel__line z-skel__line--sm"></div>
        <div class="z-skel__line z-skel__line--lg"></div>
        <div class="z-skel__line z-skel__line--md"></div>
      </div>`
      )
      .join('');
    this.el.innerHTML = `<div class="z-skel-wrap">${rows}</div>`;
  }

  setError(msg: string, onRetry?: () => void) {
    const retry = onRetry
      ? `<button class="z-btn z-btn--primary z-error__retry" type="button">Try again</button>`
      : '';
    this.el.innerHTML = `
      <div class="z-error">
        <div class="z-error__icon">!</div>
        <div class="z-error__msg">${escapeHtml(msg)}</div>
        ${retry}
      </div>`;
    if (onRetry) {
      this.el.querySelector('.z-error__retry')!.addEventListener('click', onRetry);
    }
  }

  clearStatus() {
    this.el.innerHTML = '';
  }
}

function resultHtml(r: SearchResult, i: number): string {
  const title = r._formatted?.title ?? escapeHtml(r.title);
  const excerpt = r._formatted?.excerpt ?? escapeHtml(r.excerpt);
  const url = escapeHtml(r.url);
  const host = safeHost(r.url);
  const tags = (r.tags ?? [])
    .map((t) => `<span class="z-chip">${escapeHtml(t)}</span>`)
    .join('');
  const q = r.quality;
  const qBadge = q
    ? `<span class="z-quality z-quality--${qualityBand(q.score)}" title="Quality ${Math.round(q.score * 100)}%">
        ${Math.round(q.score * 100)}
        <button class="z-quality__info" type="button" aria-label="What is the quality index?" data-qinfo>ⓘ</button>
        <span class="z-quality__pop" role="tooltip">
          <strong>Quality Index</strong>
          <span>Zwep scores each result 0–100 from four signals:</span>
          <ul>
            <li><b>Length</b> ${Math.round(q.length * 100)}% — content depth</li>
            <li><b>Freshness</b> ${Math.round(q.freshness * 100)}% — how recent</li>
            <li><b>Title</b> ${Math.round(q.title * 100)}% — title quality</li>
            <li><b>Structure</b> ${Math.round(q.structure * 100)}% — page structure</li>
          </ul>
          <span>Higher = more useful. Sorting by quality surfaces the best curated pages first.</span>
        </span>
      </span>`
    : '';
  return `
    <article class="z-result" style="animation-delay:${Math.min(i * 20, 200)}ms" data-doc='${encodeURIComponent(JSON.stringify(r))}'>
      <div class="z-result__head">
        ${r.favicon ? `<img class="z-result__fav" src="${encodeURI(r.favicon)}" alt="" loading="lazy" />` : ''}
        <span class="z-result__source">${escapeHtml(r.source)}</span>
        ${qBadge}
      </div>
      <h3 class="z-result__title"><a href="${encodeURI(r.url)}" target="_blank" rel="noopener">${title}</a></h3>
      <div class="z-result__url">${host}</div>
      <p class="z-result__excerpt">${excerpt}</p>
      ${tags ? `<div class="z-result__tags">${tags}</div>` : ''}
    </article>
  `;
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function qualityBand(score: number): 'low' | 'medium' | 'high' {
  if (score >= 0.7) return 'high';
  if (score >= 0.45) return 'medium';
  return 'low';
}

function facetChips(facets: NonNullable<SearchResponse['facets']>): string {
  const out: string[] = [];
  for (const [key, vals] of Object.entries(facets)) {
    for (const [val, count] of Object.entries(vals)) {
      if (!count) continue;
      out.push(`<button class="z-facet">${escapeHtml(val)} <span>(${count})</span></button>`);
    }
  }
  return out.join('');
}

/** Knowledge-card (Google-style right rail) built from JSON-LD structured data. */
function knowledgeCardHtml(doc: SearchResult): string {
  const s = doc.structured as Record<string, any> | null;
  if (!s) return '';
  const type = String(s['@type'] ?? '');
  const name = s.name ?? s.headline ?? doc.title;
  const desc = s.description ?? '';
  const img = s.image ?? s.thumbnailUrl ?? '';
  const rows: string[] = [];
  if (s.author?.name) rows.push(`<div class="z-card__row"><span>Author</span><b>${escapeHtml(String(s.author.name))}</b></div>`);
  if (s.datePublished) rows.push(`<div class="z-card__row"><span>Published</span><b>${escapeHtml(String(s.datePublished))}</b></div>`);
  if (s.brand?.name) rows.push(`<div class="z-card__row"><span>Brand</span><b>${escapeHtml(String(s.brand.name))}</b></div>`);
  if (s.offers?.price || s.price) rows.push(`<div class="z-card__row"><span>Price</span><b>${escapeHtml(String(s.offers?.price ?? s.price))} ${escapeHtml(String(s.offers?.priceCurrency ?? ''))}</b></div>`);
  return `
    <aside class="z-card">
      <div class="z-card__type">${escapeHtml(type)}</div>
      ${img ? `<img class="z-card__img" src="${encodeURI(String(img))}" alt="" />` : ''}
      <h4 class="z-card__name">${escapeHtml(String(name))}</h4>
      ${desc ? `<p class="z-card__desc">${escapeHtml(String(desc))}</p>` : ''}
      ${rows.join('')}
    </aside>
  `;
}

/** Blur-backdrop preview overlay for a single result. */
function openOverlay(doc: SearchResult) {
  const existing = document.querySelector('.z-overlay');
  if (existing) existing.remove();
  const host = safeHost(doc.url);
  const overlay = document.createElement('div');
  overlay.className = 'z-overlay';
  overlay.innerHTML = `
    <div class="z-overlay__backdrop" data-close></div>
    <div class="z-overlay__panel" role="dialog" aria-modal="true">
      <button class="z-overlay__close" type="button" aria-label="Close" data-close>×</button>
      <div class="z-overlay__body">
        <div class="z-overlay__main">
          <div class="z-result__head">
            ${doc.favicon ? `<img class="z-result__fav" src="${encodeURI(doc.favicon)}" alt="" />` : ''}
            <span class="z-result__source">${escapeHtml(doc.source)}</span>
          </div>
          <h3 class="z-overlay__title"><a href="${encodeURI(doc.url)}" target="_blank" rel="noopener">${escapeHtml(doc.title)}</a></h3>
          <div class="z-result__url">${host}</div>
          <p class="z-overlay__excerpt">${escapeHtml(doc.excerpt)}</p>
          <a class="z-btn z-btn--primary" href="${encodeURI(doc.url)}" target="_blank" rel="noopener">Open page ↗</a>
        </div>
        ${knowledgeCardHtml(doc) ? `<div class="z-overlay__side">${knowledgeCardHtml(doc)}</div>` : ''}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-open'));
  overlay.querySelectorAll<HTMLElement>('[data-close]').forEach((el) =>
    el.addEventListener('click', () => {
      overlay.classList.remove('is-open');
      setTimeout(() => overlay.remove(), 180);
    })
  );
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') {
      overlay.classList.remove('is-open');
      setTimeout(() => overlay.remove(), 180);
      document.removeEventListener('keydown', onKey);
    }
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Render a knowledge-graph neighborhood as an interactive canvas force-graph. */
export async function renderGraph(el: HTMLElement, query: string) {
  el.innerHTML = `<div class="z-graph-loading">Building knowledge graph for "${escapeHtml(query)}"…</div>`;
  let data: GraphResponse;
  try {
    data = await graph(query);
  } catch (e) {
    el.innerHTML = `<div class="z-empty">Could not load graph: ${(e as Error).message}</div>`;
    return;
  }
  if (!data.nodes.length) {
    el.innerHTML = `<div class="z-empty">No entities found for "${escapeHtml(query)}". Crawl more sources to grow the graph.</div>`;
    return;
  }
  el.innerHTML = `
    <div class="z-graph">
      <div class="z-graph__bar">
        <span class="z-graph__title">Knowledge Graph</span>
        <span class="z-graph__stats">${data.nodes.length} entities · ${data.edges.length} relations · ${data.stats.entities} total in graph</span>
      </div>
      <canvas class="z-graph__canvas"></canvas>
    </div>
  `;
  drawForceGraph(el.querySelector('canvas')!, data);
}

/** Minimal force-directed graph on canvas (no deps). */
function drawForceGraph(canvas: HTMLCanvasElement, data: GraphResponse) {
  const dpr = window.devicePixelRatio || 1;
  const parent = canvas.parentElement!;
  function resize() {
    canvas.width = parent.clientWidth * dpr;
    canvas.height = Math.max(360, parent.clientHeight - 60) * dpr;
    canvas.style.width = parent.clientWidth + 'px';
    canvas.style.height = Math.max(360, parent.clientHeight - 60) + 'px';
  }
  resize();
  window.addEventListener('resize', resize);

  const nodes = data.nodes.map((n, i) => ({
    ...n,
    x: canvas.width / 2 + Math.cos((i / data.nodes.length) * Math.PI * 2) * 120 * dpr,
    y: canvas.height / 2 + Math.sin((i / data.nodes.length) * Math.PI * 2) * 120 * dpr,
    vx: 0,
    vy: 0,
  }));
  const idMap = new Map(nodes.map((n) => [n.id, n]));
  const edges = data.edges.filter((e) => idMap.has(e.src) && idMap.has(e.dst));

  let dragNode: any = null;
  let raf = 0;

  function tick() {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        let d = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (4000 * dpr * dpr) / (d * d);
        dx /= d; dy /= d;
        a.vx += dx * force; a.vy += dy * force;
        b.vx -= dx * force; b.vy -= dy * force;
      }
    }
    for (const e of edges) {
      const a = idMap.get(e.src)!, b = idMap.get(e.dst)!;
      let dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (d - 90 * dpr) * 0.02;
      dx /= d; dy /= d;
      a.vx += dx * force; a.vy += dy * force;
      b.vx -= dx * force; b.vy -= dy * force;
    }
    for (const n of nodes) {
      n.vx += (canvas.width / 2 - n.x) * 0.002;
      n.vy += (canvas.height / 2 - n.y) * 0.002;
      n.vx *= 0.85; n.vy *= 0.85;
      if (n !== dragNode) { n.x += n.vx; n.y += n.vy; }
    }
    draw();
    raf = requestAnimationFrame(tick);
  }

  function draw() {
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const edgeColor = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)';
    const textColor = isDark ? '#e8e8ee' : '#1a1a1f';
    ctx.strokeStyle = edgeColor;
    ctx.lineWidth = 1 * dpr;
    for (const e of edges) {
      const a = idMap.get(e.src)!, b = idMap.get(e.dst)!;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    for (const n of nodes) {
      const r = (8 + Math.min(n.doc_count, 10)) * dpr;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = n.type === 'org' ? '#ff6600' : isDark ? '#5b9dff' : '#1f4ed8';
      ctx.fill();
      ctx.fillStyle = textColor;
      ctx.font = `${12 * dpr}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(n.label.slice(0, 18), n.x, n.y + r + 14 * dpr);
    }
  }

  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * dpr;
    const my = (e.clientY - rect.top) * dpr;
    dragNode = nodes.find((n) => Math.hypot(n.x - mx, n.y - my) < (8 + Math.min(n.doc_count, 10)) * dpr + 4);
  });
  canvas.addEventListener('mousemove', (e) => {
    if (!dragNode) return;
    const rect = canvas.getBoundingClientRect();
    dragNode.x = (e.clientX - rect.left) * dpr;
    dragNode.y = (e.clientY - rect.top) * dpr;
  });
  window.addEventListener('mouseup', () => { dragNode = null; });

  cancelAnimationFrame(raf);
  tick();
}

/** AI Overview box (Google-style summary from curated results via LLM). */
export async function renderOverview(el: HTMLElement, query: string) {
  el.innerHTML = `<div class="z-overview z-overview--loading"><span class="z-overview__spark">✦</span> Generating overview…</div>`;
  let data: OverviewResponse;
  try {
    data = await overview(query);
  } catch {
    el.innerHTML = '';
    return;
  }
  if (!data.overview || !data.overview.trim()) {
    el.innerHTML = '';
    return;
  }
  const sources = (data.sources ?? [])
    .map(
      (s) =>
        `<a class="z-overview__src" href="${encodeURI(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.source || s.title)}</a>`
    )
    .join('');
  el.innerHTML = `
    <div class="z-overview">
      <div class="z-overview__head"><span class="z-overview__spark">✦</span> Übersicht mit KI${data.cached ? ' <span class="z-overview__badge">cached</span>' : ''}</div>
      <div class="z-overview__body">${escapeHtml(data.overview).replace(/\n/g, '<br>')}</div>
      ${sources ? `<div class="z-overview__sources">${sources}</div>` : ''}
      <div class="z-overview__foot">Zusammenfassung aus kuratierten Quellen · Generative KI ist experimentell.</div>
    </div>
  `;
}
