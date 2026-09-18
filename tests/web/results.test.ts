import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchResponse, SearchResult } from '@zwep/shared';
import { ResultList } from '../../web/src/components.ts';
import { ApiError } from '../../web/src/client.ts';

function result(over: Partial<SearchResult> = {}): SearchResult {
  return {
    id: 'a1',
    url: 'https://example.com/article',
    canonical_url: 'https://example.com/article',
    title: 'Climate policy explained',
    excerpt: 'A summary of the debate.',
    content: '',
    headings: [],
    source: 'news',
    type: 'article',
    lang: 'en',
    crawled_at: '2026-01-01T00:00:00Z',
    content_hash: 'h',
    tags: ['climate'],
    score: 0.8,
    quality: { score: 0.82, length: 0.9, freshness: 0.8, title: 0.7, structure: 0.6 },
    ...over,
  };
}

function response(over: Partial<SearchResponse> = {}): SearchResponse {
  return {
    query: 'climate',
    total: 1,
    limit: 20,
    offset: 0,
    took_ms: 7,
    results: [result()],
    ...over,
  };
}

let list: ResultList;
const handlers = { onFacet: vi.fn(), onPage: vi.fn(), onRetry: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  list = new ResultList(handlers);
  document.body.appendChild(list.el);
});

describe('rendering results', () => {
  it('shows the count and timing', () => {
    list.render(response({ total: 42 }), 'climate');
    expect(list.el.textContent).toContain('42 results');
    expect(list.el.textContent).toContain('7 ms');
  });

  it('uses the singular form for one result', () => {
    list.render(response({ total: 1 }), 'climate');
    expect(list.el.textContent).toContain('1 result ');
  });

  it('links the title to the document, opening safely in a new tab', () => {
    list.render(response(), 'climate');
    const a = list.el.querySelector<HTMLAnchorElement>('.z-result__title a')!;
    expect(a.href).toBe('https://example.com/article');
    expect(a.target).toBe('_blank');
    expect(a.rel).toContain('noopener');
    expect(a.rel).toContain('noreferrer');
  });

  it('renders <mark> highlights from the API', () => {
    list.render(
      response({
        results: [result({ highlighted: { title: '<mark>Climate</mark> policy', excerpt: 'x' } })],
      }),
      'climate',
    );
    expect(list.el.querySelector('.z-result__title mark')?.textContent).toBe('Climate');
  });

  it('escapes a hostile title instead of executing it', () => {
    list.render(
      response({ results: [result({ title: '<img src=x onerror="window.__pwned=1">' })] }),
      'x',
    );
    expect(list.el.querySelector('img')).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('refuses a javascript: URL', () => {
    list.render(response({ results: [result({ url: 'javascript:alert(1)' })] }), 'x');
    const a = list.el.querySelector<HTMLAnchorElement>('.z-result__title a')!;
    expect(a.getAttribute('href')).toBe('#');
  });

  it('shows the quality badge with a rounded percentage', () => {
    list.render(response(), 'climate');
    expect(list.el.querySelector('.z-quality')?.textContent).toContain('82');
    expect(list.el.querySelector('.z-quality--high')).not.toBeNull();
  });

  it('marks the list as no longer busy after rendering', () => {
    list.showSkeleton();
    expect(list.el.getAttribute('aria-busy')).toBe('true');
    list.render(response(), 'climate');
    expect(list.el.getAttribute('aria-busy')).toBe('false');
  });
});

describe('empty state', () => {
  it('names the query and offers next steps', () => {
    list.render(response({ total: 0, results: [] }), 'unicorns');
    expect(list.el.textContent).toContain('No results for “unicorns”');
    expect(list.el.textContent).toContain('Library');
  });

  it('suggests clearing filters when some are active', () => {
    list.setActiveFacets(new Map([['source', 'news']]));
    list.render(response({ total: 0, results: [] }), 'x');
    expect(list.el.textContent).toContain('Clear the active filters');
  });

  it('escapes the query in the empty state', () => {
    list.render(response({ total: 0, results: [] }), '<script>x</script>');
    expect(list.el.querySelector('script')).toBeNull();
  });
});

describe('facets', () => {
  const withFacets = response({
    facets: { source: { news: 12, blog: 3 }, type: { article: 15 }, tag: {}, lang: { en: 15 } },
  });

  it('renders a chip per facet value with its count', () => {
    list.render(withFacets, 'climate');
    const chips = [...list.el.querySelectorAll('.z-facet')].map((n) => n.textContent?.trim());
    expect(chips.some((t) => t?.startsWith('news'))).toBe(true);
    expect(chips.some((t) => t?.includes('12'))).toBe(true);
  });

  it('orders values by count, descending', () => {
    list.render(withFacets, 'climate');
    const sourceChips = [...list.el.querySelectorAll('.z-facets__group')][0];
    const labels = [...sourceChips.querySelectorAll('.z-facet')].map((n) => n.textContent?.trim());
    expect(labels[0]).toContain('news');
  });

  it('notifies the caller when a facet is clicked', () => {
    // Regression guard: facet chips were rendered as buttons with no handler,
    // so clicking a filter did nothing at all.
    list.render(withFacets, 'climate');
    list.el.querySelector<HTMLButtonElement>('[data-facet="source"][data-value="news"]')!.click();
    expect(handlers.onFacet).toHaveBeenCalledWith('source', 'news');
  });

  it('marks the active facet with aria-pressed', () => {
    list.setActiveFacets(new Map([['source', 'news']]));
    list.render(withFacets, 'climate');
    const active = list.el.querySelector('[data-value="news"]')!;
    expect(active.getAttribute('aria-pressed')).toBe('true');
    expect(active.classList.contains('is-active')).toBe(true);
  });

  it('offers a clear-filters control only while filters are active', () => {
    list.render(withFacets, 'climate');
    expect(list.el.querySelector('.z-facet--clear')).toBeNull();
    list.setActiveFacets(new Map([['type', 'article']]));
    list.render(withFacets, 'climate');
    expect(list.el.querySelector('.z-facet--clear')).not.toBeNull();
  });

  it('omits empty facet values', () => {
    list.render(response({ facets: { source: { news: 0 } } }), 'x');
    expect(list.el.querySelector('[data-value="news"]')).toBeNull();
  });
});

describe('pagination', () => {
  it('is hidden when everything fits on one page', () => {
    list.render(response({ total: 5, limit: 20 }), 'x');
    expect(list.el.querySelector('.z-pager')).toBeNull();
  });

  it('shows the current page out of the total', () => {
    list.render(response({ total: 95, limit: 20, offset: 40 }), 'x');
    expect(list.el.querySelector('.z-pager__label')?.textContent).toContain('Page 3 of 5');
  });

  it('disables Previous on the first page', () => {
    list.render(response({ total: 95, limit: 20, offset: 0 }), 'x');
    const prev = list.el.querySelectorAll<HTMLButtonElement>('.z-pager .z-btn')[0];
    expect(prev.disabled).toBe(true);
  });

  it('disables Next on the last page', () => {
    list.render(response({ total: 95, limit: 20, offset: 80 }), 'x');
    const buttons = list.el.querySelectorAll<HTMLButtonElement>('.z-pager .z-btn');
    expect(buttons[buttons.length - 1].disabled).toBe(true);
  });

  it('reports the requested offset', () => {
    list.render(response({ total: 95, limit: 20, offset: 20 }), 'x');
    const buttons = list.el.querySelectorAll<HTMLButtonElement>('.z-pager .z-btn');
    buttons[buttons.length - 1].click();
    expect(handlers.onPage).toHaveBeenCalledWith(40);
  });

  it('numbers the list from the current offset', () => {
    list.render(response({ total: 95, limit: 20, offset: 40 }), 'x');
    expect(list.el.querySelector('ol')?.getAttribute('start')).toBe('41');
  });
});

describe('error states', () => {
  it('explains an offline API and how to start it', () => {
    list.setError(new ApiError('boom', 0, 'offline'));
    expect(list.el.textContent).toContain('Cannot reach the search service');
    expect(list.el.textContent).toContain('npm run dev');
  });

  it('explains an unreachable index', () => {
    list.setError(new ApiError('down', 503, 'index_unavailable'));
    expect(list.el.textContent).toContain('npm run infra:up');
  });

  it('exposes the error to assistive technology', () => {
    list.setError(new Error('nope'));
    expect(list.el.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('wires up the retry button', () => {
    list.setError(new Error('nope'));
    list.el.querySelector<HTMLButtonElement>('[data-action="retry"]')!.click();
    expect(handlers.onRetry).toHaveBeenCalled();
  });
});

describe('quality popover', () => {
  it('toggles open and reports its state', () => {
    list.render(response(), 'climate');
    const info = list.el.querySelector<HTMLButtonElement>('[data-qinfo]')!;
    expect(info.getAttribute('aria-expanded')).toBe('false');
    info.click();
    expect(list.el.querySelector('.z-quality__pop')?.classList.contains('is-open')).toBe(true);
    expect(info.getAttribute('aria-expanded')).toBe('true');
    info.click();
    expect(list.el.querySelector('.z-quality__pop')?.classList.contains('is-open')).toBe(false);
  });
});
