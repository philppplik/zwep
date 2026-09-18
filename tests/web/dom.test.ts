import { describe, expect, it, vi } from 'vitest';
import {
  Disposables,
  debounce,
  escapeHtml,
  formatDate,
  safeHost,
  safeUrl,
  sanitizeHighlight,
  trapFocus,
} from '../../web/src/dom.ts';

describe('escapeHtml', () => {
  it('neutralises every HTML-significant character', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
    );
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('escapes the ampersand first so entities are not double-decoded', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('coerces non-strings instead of throwing', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(42)).toBe('42');
  });
});

describe('sanitizeHighlight', () => {
  it('keeps <mark> and escapes everything else', () => {
    expect(sanitizeHighlight('<mark>Climate</mark> policy')).toBe('<mark>Climate</mark> policy');
  });

  it('strips an injected script even when it sits next to a real highlight', () => {
    // Highlighted text is built from crawled page titles, so it is untrusted.
    const out = sanitizeHighlight('<mark>a</mark><img src=x onerror=alert(1)>');
    expect(out).toContain('<mark>a</mark>');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('does not let an attribute survive inside the allowed tag', () => {
    const out = sanitizeHighlight('<mark onclick="evil()">x</mark>');
    expect(out).not.toContain('onclick="evil()"');
  });
});

describe('safeUrl', () => {
  it('passes http and https through', () => {
    expect(safeUrl('https://example.com/a')).toBe('https://example.com/a');
  });

  it.each(['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd', 'nonsense', null])(
    'rejects %s',
    (url) => {
      expect(safeUrl(url)).toBe('#');
    },
  );
});

describe('safeHost', () => {
  it('returns the bare host without www', () => {
    expect(safeHost('https://www.example.com/a?b=1')).toBe('example.com');
  });

  it('falls back to the raw input for junk', () => {
    expect(safeHost('not a url')).toBe('not a url');
  });
});

describe('formatDate', () => {
  it('formats a valid ISO date', () => {
    expect(formatDate('2025-03-04T00:00:00Z')).not.toBe('');
  });

  it('returns an empty string for missing or invalid input', () => {
    expect(formatDate(undefined)).toBe('');
    expect(formatDate('soon')).toBe('');
  });
});

describe('Disposables', () => {
  it('removes every registered listener on dispose', () => {
    const d = new Disposables();
    const target = document.createElement('div');
    const handler = vi.fn();
    d.listen(target, 'click', handler);
    target.dispatchEvent(new Event('click'));
    expect(handler).toHaveBeenCalledTimes(1);

    d.dispose();
    target.dispatchEvent(new Event('click'));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('clears intervals on dispose', () => {
    vi.useFakeTimers();
    const d = new Disposables();
    const fn = vi.fn();
    d.interval(fn, 100);
    vi.advanceTimersByTime(250);
    expect(fn).toHaveBeenCalledTimes(2);
    d.dispose();
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('cancels animation frames on dispose', async () => {
    // Regression guard: the graph view's force simulation kept running after
    // the user navigated away, burning CPU for the rest of the session.
    const d = new Disposables();
    const loop = vi.fn();
    d.raf(loop);
    await new Promise((r) => setTimeout(r, 40));
    const afterMount = loop.mock.calls.length;
    expect(afterMount).toBeGreaterThan(0);
    d.dispose();
    await new Promise((r) => setTimeout(r, 40));
    expect(loop.mock.calls.length).toBe(afterMount);
  });

  it('keeps disposing even when one teardown throws', () => {
    const d = new Disposables();
    const after = vi.fn();
    d.add(() => {
      throw new Error('boom');
    });
    d.add(after);
    expect(() => d.dispose()).not.toThrow();
    expect(after).toHaveBeenCalled();
  });
});

describe('trapFocus', () => {
  it('focuses the first interactive element and restores focus on release', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();

    const modal = document.createElement('div');
    modal.innerHTML = '<button id="a">A</button><button id="b">B</button>';
    document.body.appendChild(modal);

    const release = trapFocus(modal);
    expect(document.activeElement?.id).toBe('a');
    release();
    expect(document.activeElement).toBe(outside);
  });

  it('calls the escape handler on Escape', () => {
    const modal = document.createElement('div');
    modal.innerHTML = '<button>A</button>';
    document.body.appendChild(modal);
    const onEscape = vi.fn();
    trapFocus(modal, onEscape);
    modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onEscape).toHaveBeenCalled();
  });
});

describe('debounce', () => {
  it('collapses rapid calls into one', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d();
    d();
    d();
    vi.advanceTimersByTime(150);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('can be cancelled before firing', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d();
    d.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
