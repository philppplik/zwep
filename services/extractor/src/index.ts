import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { franc } from 'franc';
import { createHash } from 'node:crypto';
import type { Document, DocType } from '@zwep/shared';
import type { CrawlPage } from '@zwep/crawler';
import { scoreDocument } from '@zwep/quality';

function meta(doc: Document, name: string): string | undefined {
  const el = doc.querySelector(
    `meta[name="${name}" i], meta[property="${name}" i], meta[itemprop="${name}" i]`
  );
  return el?.getAttribute('content')?.trim() || undefined;
}

function jsonLd(doc: Document, type: string): any | null {
  for (const s of [...doc.querySelectorAll('script[type="application/ld+json"]')]) {
    try {
      const data = JSON.parse((s.textContent || '').trim());
      const arr = Array.isArray(data) ? data : [data];
      for (const item of arr) {
        const t = item['@type'];
        if (Array.isArray(t) ? t.includes(type) : t === type) return item;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

function detectType(doc: Document, json: any | null, url: string): DocType {
  const u = url.toLowerCase();
  if (/\.(jpg|jpeg|png|gif|webp|svg|avif)(\?|$)/.test(u)) return 'image';
  if (/\.(mp4|webm|ogg|mov|mkv)(\?|$)/.test(u)) return 'video';
  if (json && /Article/.test(json['@type'] ?? '')) return 'article';
  if (json && /(Product|Offer)/.test(json['@type'] ?? '')) return 'product';
  if (json && /(VideoObject|Movie)/.test(json['@type'] ?? '')) return 'video';
  if (json && /ImageObject/.test(json['@type'] ?? '')) return 'image';
  const article = doc.querySelector('article');
  if (article) return 'article';
  if (doc.querySelector('[itemtype*="schema.org/Product"]')) return 'product';
  return 'page';
}

function faviconUrl(doc: Document, base: string): string | undefined {
  const links = [...doc.querySelectorAll('link[rel~="icon" i]')] as any[];
  for (const l of links) {
    const href = l.getAttribute('href');
    if (href) {
      try {
        return new URL(href, base).toString();
      } catch {
        /* ignore */
      }
    }
  }
  try {
    return new URL('/favicon.ico', base).toString();
  } catch {
    return undefined;
  }
}

function structuredData(doc: Document): Record<string, unknown> | null {
  const collected: Record<string, unknown>[] = [];
  for (const s of [...doc.querySelectorAll('script[type="application/ld+json"]')]) {
    try {
      const data = JSON.parse((s.textContent || '').trim());
      const arr = Array.isArray(data) ? data : [data];
      for (const item of arr) {
        if (item && typeof item === 'object') collected.push(item);
      }
    } catch {
      /* ignore */
    }
  }
  // pick the richest entity (Product / Article / Organisation / VideoObject ...)
  const priority = ['Product', 'VideoObject', 'Article', 'Organization', 'Person', 'WebSite'];
  collected.sort((a, b) => {
    const ta = String((a as any)['@type'] ?? '');
    const tb = String((b as any)['@type'] ?? '');
    return priority.findIndex((p) => tb.includes(p)) - priority.findIndex((p) => ta.includes(p));
  });
  return collected[0] ?? null;
}

function cleanText(s?: string): string {
  return (s || '').replace(/\s+/g, ' ').trim();
}

/** Extract a Document from a crawled page. Returns null if nothing usable. */
export function extract(page: CrawlPage, source: string): Document | null {
  const dom = new JSDOM(page.content, { url: page.canonical_url });
  const doc = dom.window.document as unknown as Document;

  // main content
  const reader = new Readability(doc).parse();
  const content = cleanText(reader?.textContent || '');

  const titleEl = doc.querySelector('title');
  const ogTitle = meta(doc, 'og:title');
  const title = cleanText(ogTitle || titleEl?.textContent || reader?.title || page.canonical_url);

  if (!title && content.length < 60) return null; // skip junk pages

  const description = cleanText(meta(doc, 'description') || reader?.excerpt || '');
  const lang = (doc.documentElement.lang || franc(content || title) || 'en')
    .split('-')[0]
    .toLowerCase();

  const author =
    meta(doc, 'author') ||
    meta(doc, 'article:author') ||
    jsonLd(doc, 'Article')?.author?.name;
  const published =
    meta(doc, 'article:published_time') || jsonLd(doc, 'Article')?.datePublished;

  const headings = [...doc.querySelectorAll('h1,h2,h3')]
    .map((h) => cleanText(h.textContent))
    .filter((t) => t.length > 2)
    .slice(0, 12);

  const tagsRaw =
    meta(doc, 'keywords') || jsonLd(doc, 'Article')?.keywords || '';
  const tags = (Array.isArray(tagsRaw) ? tagsRaw.join(',') : tagsRaw)
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 20);

  const excerpt =
    description || cleanText(reader?.excerpt || content).slice(0, 220);

  const contentHash = createHash('sha256')
    .update(content || title)
    .digest('hex');

  const out: Document = {
    id: page.id,
    url: page.url,
    canonical_url: page.canonical_url,
    title,
    excerpt,
    content,
    headings,
    source,
    type: detectType(doc, jsonLd(doc, 'Article'), page.url),
    lang,
    author: author || undefined,
    published_at: published || undefined,
    crawled_at: page.fetchedAt,
    content_hash: contentHash,
    tags,
    favicon: faviconUrl(doc, page.canonical_url),
    structured: structuredData(doc),
  };
  out.quality = scoreDocument(out);
  return out;
}
