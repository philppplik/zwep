import type { SearchResponse, SearchResult } from '@zwep/shared';
import { suggest, type SuggestItem } from './client.ts';

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
  const tags = (r.tags ?? [])
    .map((t) => `<span class="z-chip">${escapeHtml(t)}</span>`)
    .join('');
  const q = r.quality;
  const qBadge = q
    ? `<span class="z-quality z-quality--${qualityBand(q.score)}" title="length ${Math.round(q.length * 100)}% · freshness ${Math.round(q.freshness * 100)}% · title ${Math.round(q.title * 100)}% · structure ${Math.round(q.structure * 100)}%">${Math.round(q.score * 100)}</span>`
    : '';
  return `
    <article class="z-result" style="animation-delay:${Math.min(i * 20, 200)}ms">
      <div class="z-result__source">${escapeHtml(r.source)} · ${escapeHtml(r.lang)} ${qBadge}</div>
      <h3 class="z-result__title"><a href="${encodeURI(r.url)}" target="_blank" rel="noopener">${title}</a></h3>
      <div class="z-result__url">${escapeHtml(r.url)}</div>
      <p class="z-result__excerpt">${excerpt}</p>
      ${tags ? `<div class="z-result__tags">${tags}</div>` : ''}
    </article>
  `;
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
