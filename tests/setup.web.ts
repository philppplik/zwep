/**
 * Web (jsdom) test setup.
 *
 * jsdom does not implement `matchMedia`, `requestAnimationFrame` timing or
 * canvas. Stubs live here so component tests exercise real code paths instead
 * of guarding every call site with a feature check.
 */
import { afterEach, beforeEach, vi } from 'vitest';

beforeEach(() => {
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  }
  // jsdom implements no layout, so scrollIntoView is simply absent.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }

  localStorage.clear();
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});
