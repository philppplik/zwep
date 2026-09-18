/**
 * Small DOM helpers shared by every view.
 *
 * Deliberately not a framework: Zwep's UI is a handful of screens, and the
 * whole bundle staying under a few kilobytes is part of the product promise.
 * What we do need is the safety these helpers enforce — escaping by default
 * and listeners that can always be torn down.
 */

/** Escape a string for safe interpolation into HTML text or an attribute. */
export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Allow only `<mark>` through, escaping everything else.
 *
 * Search highlights arrive from the API as pre-marked HTML. The text around
 * the marks comes from crawled pages, so it is untrusted: escaping first and
 * then restoring just the `<mark>` pair is what keeps a crafted page title
 * from injecting script into the results list.
 */
export function sanitizeHighlight(html: unknown): string {
  return escapeHtml(html).replace(/&lt;(\/?)mark&gt;/g, '<$1mark>');
}

/** Restrict a URL to http(s) so a `javascript:` href can never be rendered. */
export function safeUrl(url: unknown): string {
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '#';
    return u.toString();
  } catch {
    return '#';
  }
}

export function safeHost(url: unknown): string {
  try {
    return new URL(String(url)).host.replace(/^www\./, '');
  } catch {
    return String(url ?? '');
  }
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  html?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  if (html !== undefined) node.innerHTML = html;
  return node;
}

/**
 * Collects teardown callbacks so a view can be unmounted cleanly.
 * Every `window`/`document` listener and every timer goes through this — the
 * old graph view leaked a `resize` listener and an animation frame loop that
 * kept burning CPU after the user navigated away.
 */
export class Disposables {
  private fns: (() => void)[] = [];

  add(fn: () => void): void {
    this.fns.push(fn);
  }

  listen<T extends EventTarget>(
    target: T,
    type: string,
    handler: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, handler, options);
    this.fns.push(() => target.removeEventListener(type, handler, options));
  }

  interval(fn: () => void, ms: number): ReturnType<typeof setInterval> {
    const id = setInterval(fn, ms);
    this.fns.push(() => clearInterval(id));
    return id;
  }

  raf(loop: () => void): void {
    let id = 0;
    const tick = () => {
      loop();
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    this.fns.push(() => cancelAnimationFrame(id));
  }

  dispose(): void {
    for (const fn of this.fns.splice(0)) {
      try {
        fn();
      } catch {
        /* teardown must never throw */
      }
    }
  }
}

/**
 * Trap keyboard focus inside a modal and restore it on close.
 * Without this a screen-reader or keyboard user tabs straight out of the
 * dialog into the page behind it.
 */
export function trapFocus(container: HTMLElement, onEscape?: () => void): () => void {
  const previous = document.activeElement as HTMLElement | null;
  const selector =
    'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

  const focusable = () =>
    [...container.querySelectorAll<HTMLElement>(selector)].filter((n) => n.offsetParent !== null);

  focusable()[0]?.focus();

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onEscape?.();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = focusable();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  container.addEventListener('keydown', onKey);
  return () => {
    container.removeEventListener('keydown', onKey);
    previous?.focus?.();
  };
}

/** Format an ISO date as a short, locale-aware label. */
export function formatDate(iso?: string): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(t);
}

/** Debounce, returning a cancellable wrapper. */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
): ((...args: A) => void) & { cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wrapped = (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
  };
  return wrapped;
}
