import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { franc } from 'franc';
import { createHash } from 'node:crypto';
import type { Document, DocType } from '@zwep/shared';
import type { CrawlPage } from '@zwep/crawler';
import { scoreDocument } from '@zwep/quality';
import { normalizeLang, UNKNOWN_LANG } from './lang.ts';

export { normalizeLang, UNKNOWN_LANG } from './lang.ts';

/** A page with less usable text than this is treated as navigation chrome. */
export const MIN_CONTENT_CHARS = 120;
/** Hard cap on stored content, so one huge page cannot dominate the index. */
const MAX_CONTENT_CHARS = 120_000;

type Dom = ReturnType<typeof createDom>;

function createDom(html: string, url: string) {
  return new JSDOM(html, { url }).window.document;
}

function meta(doc: Dom, name: string): string | undefined {
  const el = doc.querySelector(
    `meta[name="${name}" i], meta[property="${name}" i], meta[itemprop="${name}" i]`,
  );
  return el?.getAttribute('content')?.trim() || undefined;
}

function jsonLdBlocks(doc: Dom): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const s of [...doc.querySelectorAll('script[type="application/ld+json"]')]) {
    try {
      const data = JSON.parse((s.textContent || '').trim());
      for (const item of Array.isArray(data) ? data : [data]) {
        if (item && typeof item === 'object') out.push(item as Record<string, unknown>);
        // Some CMSes nest everything under @graph.
        const graph = (item as { '@graph'?: unknown })?.['@graph'];
        if (Array.isArray(graph)) {
          for (const g of graph) if (g && typeof g === 'object') out.push(g);
        }
      }
    } catch {
      /* a malformed JSON-LD block is ignored, not fatal */
    }
  }
  return out;
}

function findLd(blocks: Record<string, unknown>[], type: string): Record<string, unknown> | null {
  for (const item of blocks) {
    const t = item['@type'];
    if (
      Array.isArray(t) ? t.some((x) => String(x).includes(type)) : String(t ?? '').includes(type)
    ) {
      return item;
    }
  }
  return null;
}

function typeOf(item: Record<string, unknown> | null): string {
  if (!item) return '';
  const t = item['@type'];
  return Array.isArray(t) ? t.join(' ') : String(t ?? '');
}

function detectType(doc: Dom, blocks: Record<string, unknown>[], url: string): DocType {
  const u = url.toLowerCase();
  if (/\.(jpg|jpeg|png|gif|webp|svg|avif)(\?|$)/.test(u)) return 'image';
  if (/\.(mp4|webm|ogg|mov|mkv)(\?|$)/.test(u)) return 'video';
  const all = blocks.map(typeOf).join(' ');
  if (/(Product|Offer)/.test(all)) return 'product';
  if (/(VideoObject|Movie)/.test(all)) return 'video';
  if (/ImageObject/.test(all)) return 'image';
  if (/Article|BlogPosting|NewsArticle/.test(all)) return 'article';
  if (doc.querySelector('[itemtype*="schema.org/Product"]')) return 'product';
  if (doc.querySelector('article')) return 'article';
  return 'page';
}

function faviconUrl(doc: Dom, base: string): string | undefined {
  for (const l of [...doc.querySelectorAll('link[rel~="icon" i]')]) {
    const href = l.getAttribute('href');
    if (!href) continue;
    try {
      return new URL(href, base).toString();
    } catch {
      /* try the next candidate */
    }
  }
  try {
    return new URL('/favicon.ico', base).toString();
  } catch {
    return undefined;
  }
}

/** Pick the richest JSON-LD entity for the knowledge card. */
function structuredData(blocks: Record<string, unknown>[]): Record<string, unknown> | null {
  if (!blocks.length) return null;
  const priority = [
    'Product',
    'VideoObject',
    'NewsArticle',
    'Article',
    'Organization',
    'Person',
    'WebSite',
  ];
  const rank = (b: Record<string, unknown>) => {
    const t = typeOf(b);
    const i = priority.findIndex((p) => t.includes(p));
    return i === -1 ? priority.length : i;
  };
  return [...blocks].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

function cleanText(s?: string | null): string {
  return (s || '').replace(/\s+/g, ' ').trim();
}

/**
 * Normalize a date to an ISO 8601 string.
 * Returns undefined for values Meilisearch could not sort on anyway.
 */
export function normalizeDate(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return undefined;
  // Reject obviously bogus dates (clock-skewed CMS exports, year 0001, …).
  const year = new Date(t).getUTCFullYear();
  if (year < 1990 || year > new Date().getUTCFullYear() + 1) return undefined;
  return new Date(t).toISOString();
}

function personName(raw: unknown): string | undefined {
  if (!raw) return undefined;
  if (typeof raw === 'string') return cleanText(raw) || undefined;
  if (Array.isArray(raw)) return personName(raw[0]);
  if (typeof raw === 'object' && 'name' in (raw as object)) {
    return personName((raw as { name: unknown }).name);
  }
  return undefined;
}

/**
 * Extract a Document from a crawled page.
 *
 * Returns null when the page carries no usable content — a nav-only shell, a
 * redirect stub, an error page. Indexing those pollutes results, so the filter
 * is deliberately based on *content length*, not on whether a title exists
 * (the title always falls back to the URL, so it is never empty).
 */
export function extract(page: CrawlPage, source: string): Document | null {
  let doc: Dom;
  try {
    doc = createDom(page.content, page.canonical_url);
  } catch {
    return null;
  }

  let parsed: ReturnType<Readability['parse']> = null;
  try {
    // Readability mutates the DOM, so it gets its own copy.
    parsed = new Readability(createDom(page.content, page.canonical_url)).parse();
  } catch {
    parsed = null;
  }

  const bodyText = cleanText(parsed?.textContent || doc.body?.textContent || '');
  const content = bodyText.slice(0, MAX_CONTENT_CHARS);

  const blocks = jsonLdBlocks(doc);
  const article = findLd(blocks, 'Article');

  const title = cleanText(
    meta(doc, 'og:title') || doc.querySelector('title')?.textContent || parsed?.title || '',
  );

  if (content.length < MIN_CONTENT_CHARS && !title) return null;
  if (content.length < MIN_CONTENT_CHARS && !meta(doc, 'description')) return null;

  const description = cleanText(
    meta(doc, 'description') || meta(doc, 'og:description') || parsed?.excerpt || '',
  );

  const declaredLang = doc.documentElement.getAttribute('lang');
  const lang =
    normalizeLang(declaredLang) !== UNKNOWN_LANG
      ? normalizeLang(declaredLang)
      : normalizeLang(franc(content || title));

  const author = personName(meta(doc, 'author') ?? meta(doc, 'article:author') ?? article?.author);
  const published =
    normalizeDate(meta(doc, 'article:published_time')) ??
    normalizeDate(meta(doc, 'datePublished')) ??
    normalizeDate(article?.datePublished);

  const headings = [...doc.querySelectorAll('h1,h2,h3')]
    .map((h) => cleanText(h.textContent))
    .filter((t) => t.length > 2)
    .slice(0, 12);

  const rawTags = meta(doc, 'keywords') ?? article?.keywords ?? '';
  const tags = [
    ...new Set(
      (Array.isArray(rawTags) ? rawTags.join(',') : String(rawTags))
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 1 && t.length <= 40),
    ),
  ].slice(0, 20);

  const excerpt = (description || content).slice(0, 220).trim();

  const out: Document = {
    id: page.id,
    url: page.url,
    canonical_url: page.canonical_url,
    title: title || page.canonical_url,
    excerpt,
    content,
    headings,
    source,
    type: detectType(doc, blocks, page.url),
    lang,
    author,
    published_at: published,
    crawled_at: page.fetchedAt,
    // Hashing the *content* (not the raw HTML) means a page whose ads or CSRF
    // token changed still hashes identically — that is what makes change
    // detection useful.
    content_hash: createHash('sha256')
      .update(content || title)
      .digest('hex'),
    tags,
    favicon: faviconUrl(doc, page.canonical_url),
    structured: structuredData(blocks),
  };
  out.quality = scoreDocument(out);
  return out;
}
