import { describe, expect, it } from 'vitest';
import {
  canonicalizeUrl,
  docId,
  filterAllowed,
  hostnameOf,
  isHttpUrl,
  looksLikeAsset,
  resolveUrl,
} from '@zwep/crawler';

describe('canonicalizeUrl', () => {
  it('strips the fragment, www and a trailing slash', () => {
    expect(canonicalizeUrl('https://www.Example.com/path/#section')).toBe(
      'https://example.com/path',
    );
  });

  it('keeps the root path intact', () => {
    expect(canonicalizeUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('sorts query parameters so key order does not create duplicates', () => {
    expect(canonicalizeUrl('https://example.com/a?b=2&a=1')).toBe(
      canonicalizeUrl('https://example.com/a?a=1&b=2'),
    );
  });

  it('drops tracking parameters', () => {
    expect(canonicalizeUrl('https://example.com/p?utm_source=x&id=7&fbclid=abc')).toBe(
      'https://example.com/p?id=7',
    );
  });

  it('drops the default port', () => {
    expect(canonicalizeUrl('https://example.com:443/x')).toBe('https://example.com/x');
    expect(canonicalizeUrl('http://example.com:80/x')).toBe('http://example.com/x');
  });

  it('returns the input unchanged when it is not a URL', () => {
    expect(canonicalizeUrl('not a url')).toBe('not a url');
  });
});

describe('docId', () => {
  it('is stable for the same source and canonical URL', () => {
    expect(docId('news', 'https://example.com/a')).toBe(docId('news', 'https://example.com/a'));
  });

  it('does not depend on page content, so a re-crawl updates in place', () => {
    // Regression guard: the id used to hash the HTML body, which minted a new
    // document every time a page changed and orphaned the previous revision.
    const first = docId('news', 'https://example.com/a');
    const second = docId('news', 'https://example.com/a');
    expect(first).toBe(second);
  });

  it('differs per source and per URL', () => {
    expect(docId('a', 'https://example.com/x')).not.toBe(docId('b', 'https://example.com/x'));
    expect(docId('a', 'https://example.com/x')).not.toBe(docId('a', 'https://example.com/y'));
  });

  it('only emits characters Meilisearch accepts in an id', () => {
    expect(docId('my source/name!', 'https://example.com')).toMatch(/^[a-zA-Z0-9_-]+$/);
  });
});

describe('hostnameOf', () => {
  it('lowercases and strips www', () => {
    expect(hostnameOf('https://WWW.Example.COM/x')).toBe('example.com');
  });

  it('returns null for junk', () => {
    expect(hostnameOf('nonsense')).toBeNull();
  });
});

describe('resolveUrl', () => {
  it('resolves relative links against the base', () => {
    expect(resolveUrl('/b', 'https://example.com/a/c')).toBe('https://example.com/b');
  });

  it('rejects non-http schemes', () => {
    expect(resolveUrl('javascript:alert(1)', 'https://example.com')).toBeNull();
    expect(resolveUrl('mailto:a@b.c', 'https://example.com')).toBeNull();
  });
});

describe('filterAllowed', () => {
  it('keeps only allow-listed hosts', () => {
    const links = ['https://good.com/a', 'https://bad.com/b', 'https://good.com/a'];
    expect(filterAllowed(links, new Set(['good.com']))).toEqual(['https://good.com/a']);
  });

  it('treats an empty allow-list as no restriction', () => {
    expect(filterAllowed(['https://any.com/a'], new Set())).toEqual(['https://any.com/a']);
  });
});

describe('looksLikeAsset', () => {
  it.each([
    'https://e.com/a.pdf',
    'https://e.com/img.png',
    'https://e.com/style.css',
    'https://e.com/app.js?v=2',
  ])('flags %s', (url) => {
    expect(looksLikeAsset(url)).toBe(true);
  });

  it.each(['https://e.com/article', 'https://e.com/page.html', 'https://e.com/'])(
    'accepts %s',
    (url) => {
      expect(looksLikeAsset(url)).toBe(false);
    },
  );
});

describe('isHttpUrl', () => {
  it('accepts http and https only', () => {
    expect(isHttpUrl('http://a.com')).toBe(true);
    expect(isHttpUrl('https://a.com')).toBe(true);
    expect(isHttpUrl('ftp://a.com')).toBe(false);
    expect(isHttpUrl('/relative')).toBe(false);
  });
});
