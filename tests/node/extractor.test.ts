import { describe, expect, it } from 'vitest';
import { extract, normalizeDate, normalizeLang, UNKNOWN_LANG } from '@zwep/extractor';
import type { CrawlPage } from '@zwep/crawler';

function page(html: string, url = 'https://example.com/article'): CrawlPage {
  return {
    id: 'test_abc',
    url,
    canonical_url: url,
    content: html,
    rendered: false,
    fetchedAt: '2026-01-01T00:00:00.000Z',
  };
}

const BODY = `<p>${'This is a real sentence with enough substance to count as content. '.repeat(8)}</p>`;

describe('normalizeLang', () => {
  it('maps ISO 639-3 codes from franc to ISO 639-1', () => {
    // Regression guard: `franc` returns "deu" while HTML lang gives "de",
    // which split the language facet into two buckets for one language.
    expect(normalizeLang('deu')).toBe('de');
    expect(normalizeLang('eng')).toBe('en');
    expect(normalizeLang('cmn')).toBe('zh');
  });

  it('passes through two-letter codes and strips the region', () => {
    expect(normalizeLang('de-AT')).toBe('de');
    expect(normalizeLang('EN_us')).toBe('en');
  });

  it('reports undetermined rather than guessing English', () => {
    expect(normalizeLang('')).toBe(UNKNOWN_LANG);
    expect(normalizeLang('und')).toBe(UNKNOWN_LANG);
    expect(normalizeLang('xyzzy')).toBe(UNKNOWN_LANG);
  });
});

describe('normalizeDate', () => {
  it('normalizes a valid date to ISO 8601', () => {
    expect(normalizeDate('2025-03-04')).toBe('2025-03-04T00:00:00.000Z');
  });

  it('rejects unparseable and implausible dates', () => {
    expect(normalizeDate('not a date')).toBeUndefined();
    expect(normalizeDate('0001-01-01')).toBeUndefined();
    expect(normalizeDate('')).toBeUndefined();
    expect(normalizeDate(undefined)).toBeUndefined();
  });
});

describe('extract', () => {
  it('pulls title, excerpt, headings and language from a normal article', () => {
    const doc = extract(
      page(`<!doctype html><html lang="de"><head>
        <title>Klimapolitik im Bundestag</title>
        <meta name="description" content="Ein Überblick über die Debatte." />
      </head><body><article><h1>Klimapolitik</h1><h2>Hintergrund</h2>${BODY}</article></body></html>`),
      'news',
    );
    expect(doc).not.toBeNull();
    expect(doc!.title).toBe('Klimapolitik im Bundestag');
    expect(doc!.excerpt).toBe('Ein Überblick über die Debatte.');
    expect(doc!.lang).toBe('de');
    expect(doc!.headings).toContain('Klimapolitik');
    expect(doc!.source).toBe('news');
    expect(doc!.quality?.score).toBeGreaterThan(0);
  });

  it('prefers og:title over the <title> element', () => {
    const doc = extract(
      page(`<html><head><title>Site name — Page</title>
        <meta property="og:title" content="The real headline" /></head>
        <body>${BODY}</body></html>`),
      's',
    );
    expect(doc!.title).toBe('The real headline');
  });

  it('skips a navigation-only shell', () => {
    // Regression guard: the old condition `!title && content.length < 60`
    // could never fire, because the title falls back to the URL.
    const doc = extract(
      page(
        '<html><head><title>Menu</title></head><body><nav><a href="/a">A</a></nav></body></html>',
      ),
      's',
    );
    expect(doc).toBeNull();
  });

  it('keeps a short page that carries a real description', () => {
    const doc = extract(
      page(`<html><head><title>Contact</title>
        <meta name="description" content="How to reach the team." /></head>
        <body><p>Email us.</p></body></html>`),
      's',
    );
    expect(doc).not.toBeNull();
    expect(doc!.excerpt).toBe('How to reach the team.');
  });

  it('classifies a product from JSON-LD', () => {
    const doc = extract(
      page(`<html><head><title>Widget</title>
        <script type="application/ld+json">
          {"@type":"Product","name":"Widget","offers":{"@type":"Offer","price":"9.99"}}
        </script></head><body>${BODY}</body></html>`),
      's',
    );
    expect(doc!.type).toBe('product');
    expect(doc!.structured).toMatchObject({ '@type': 'Product' });
  });

  it('reads entities nested under @graph', () => {
    const doc = extract(
      page(`<html><head><title>Post</title>
        <script type="application/ld+json">
          {"@context":"https://schema.org","@graph":[{"@type":"NewsArticle","datePublished":"2025-05-05"}]}
        </script></head><body>${BODY}</body></html>`),
      's',
    );
    expect(doc!.type).toBe('article');
    expect(doc!.published_at).toBe('2025-05-05T00:00:00.000Z');
  });

  it('survives malformed JSON-LD without losing the document', () => {
    const doc = extract(
      page(`<html><head><title>Broken</title>
        <script type="application/ld+json">{ not json at all </script></head>
        <body>${BODY}</body></html>`),
      's',
    );
    expect(doc).not.toBeNull();
    expect(doc!.structured).toBeNull();
  });

  it('resolves a relative favicon against the page URL', () => {
    const doc = extract(
      page(`<html><head><title>T</title><link rel="icon" href="/icon.png"></head>
        <body>${BODY}</body></html>`),
      's',
    );
    expect(doc!.favicon).toBe('https://example.com/icon.png');
  });

  it('de-duplicates and bounds keyword tags', () => {
    const doc = extract(
      page(`<html><head><title>T</title>
        <meta name="keywords" content="Climate, climate, POLICY,  , x" /></head>
        <body>${BODY}</body></html>`),
      's',
    );
    expect(doc!.tags).toEqual(['climate', 'policy']);
  });

  it('hashes content, not raw HTML, so cosmetic markup churn is not a change', () => {
    const a = extract(
      page(`<html><head><title>T</title></head><body><div>${BODY}</div></body></html>`),
      's',
    );
    const b = extract(
      page(
        `<html><head><title>T</title></head><body><section class="new"><div>${BODY}</div></section></body></html>`,
      ),
      's',
    );
    expect(a!.content_hash).toBe(b!.content_hash);
  });

  it('returns null instead of throwing on empty input', () => {
    expect(extract(page(''), 's')).toBeNull();
  });
});
