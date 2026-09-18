/** URL normalization + domain helpers used across crawl/extract. */

import { createHash } from 'node:crypto';

/** Tracking parameters that never change the content behind a URL. */
const TRACKING_PARAMS = [
  /^utm_/i,
  /^gclid$/i,
  /^fbclid$/i,
  /^mc_(cid|eid)$/i,
  /^igshid$/i,
  /^ref$/i,
  /^ref_src$/i,
  /^_ga$/i,
  /^msclkid$/i,
  /^yclid$/i,
];

export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Canonicalize for dedup: lowercase host, strip `www.` and the fragment, drop
 * tracking parameters, sort the remaining query keys, and remove a trailing
 * slash. Two URLs that serve the same page should produce the same string.
 */
export function canonicalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = '';
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    // Drop the default port so http://x:80/ === http://x/
    if (
      (u.protocol === 'http:' && u.port === '80') ||
      (u.protocol === 'https:' && u.port === '443')
    ) {
      u.port = '';
    }
    const params = [...u.searchParams.entries()]
      .filter(([k]) => !TRACKING_PARAMS.some((re) => re.test(k)))
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    u.search = params.length ? new URLSearchParams(params).toString() : '';
    let path = u.pathname;
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    u.pathname = path;
    return u.toString();
  } catch {
    return raw;
  }
}

/**
 * Stable document id: `{source}_{sha256(canonicalUrl)[0..15]}`.
 *
 * It must depend only on the source and the canonical URL — never on page
 * content. A content-derived id would mint a brand-new document every time a
 * page changes, leaving the previous revision orphaned in the index.
 *
 * Meilisearch ids accept `[a-zA-Z0-9_-]` only, so the source is slugified.
 */
export function docId(source: string, canonicalUrl: string): string {
  const hash = createHash('sha256').update(canonicalUrl).digest('hex').slice(0, 16);
  const slug = source.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
  return `${slug}_${hash}`;
}

export function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

/** Resolve a possibly-relative link against a base URL; return null on junk. */
export function resolveUrl(link: string, base: string): string | null {
  try {
    const u = new URL(link, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Keep only links on an allowed host. An empty allow-list means "no host
 * restriction" (used by google-type sources, where the host set is unknown
 * until the query runs).
 */
export function filterAllowed(links: string[], allowed: Set<string>): string[] {
  const out: string[] = [];
  for (const l of links) {
    const h = hostnameOf(l);
    if (!h) continue;
    if (allowed.size === 0 || allowed.has(h)) out.push(l);
  }
  return [...new Set(out)];
}

/** File extensions we never want to fetch as documents. */
const BINARY_EXT =
  /\.(pdf|zip|gz|tgz|bz2|7z|rar|exe|dmg|pkg|deb|rpm|iso|mp3|mp4|avi|mkv|mov|wav|flac|woff2?|ttf|eot|otf|css|js|mjs|json|xml|rss|atom|ico|png|jpe?g|gif|webp|avif|svg|bmp|tiff?)(\?|#|$)/i;

export function looksLikeAsset(url: string): boolean {
  try {
    return BINARY_EXT.test(new URL(url).pathname);
  } catch {
    return BINARY_EXT.test(url);
  }
}
