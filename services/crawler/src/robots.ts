import { loadEnv } from '@zwep/config';
import { hostnameOf, resolveUrl } from './url.ts';
import { robotsParser, type RobotsRules } from './robots-parser.ts';

type Robots = RobotsRules;

const ROBOTS_TIMEOUT_MS = 10_000;
/** How many sitemap URLs a single source may contribute. */
const SITEMAP_URL_CAP = 50_000;
/** How deep a sitemap-index chain may nest. */
const SITEMAP_MAX_DEPTH = 3;

function ua(): string {
  return loadEnv().CRAWLER_USER_AGENT;
}

/**
 * Per-origin robots cache.
 *
 * Keyed by `scheme://host[:port]`, not by bare hostname: an http origin and an
 * https origin are different servers as far as the robots protocol is
 * concerned, and fetching `https://` for an `http://` seed silently produced
 * the wrong rules before.
 */
const robotsCache = new Map<string, Promise<Robots>>();

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function getRobots(url: string): Promise<Robots> {
  const origin = originOf(url);
  if (!origin) return Promise.resolve(robotsParser('http://invalid/robots.txt', ''));
  const cached = robotsCache.get(origin);
  if (cached) return cached;

  const robotsUrl = `${origin}/robots.txt`;
  const p = (async () => {
    try {
      const res = await fetch(robotsUrl, {
        headers: { 'User-Agent': ua() },
        signal: AbortSignal.timeout(ROBOTS_TIMEOUT_MS),
      });
      // 4xx means "no restrictions"; 5xx conventionally means "stay away", but
      // treating it as fully disallowed would make one flaky server look like a
      // dead source, so we fall back to permissive-with-delay like most crawlers.
      const txt = res.ok ? await res.text() : '';
      return robotsParser(robotsUrl, txt);
    } catch {
      return robotsParser(robotsUrl, '');
    }
  })();
  robotsCache.set(origin, p);
  return p;
}

/** Test/maintenance helper — drops every cached robots.txt. */
export function clearRobotsCache(): void {
  robotsCache.clear();
}

export async function isAllowed(url: string): Promise<boolean> {
  if (!hostnameOf(url)) return false;
  const parser = await getRobots(url);
  return parser.isAllowed(url, ua()) !== false;
}

/** Crawl-delay (seconds) declared for our UA, if any. */
export async function crawlDelaySec(url: string): Promise<number> {
  if (!hostnameOf(url)) return 0;
  const parser = await getRobots(url);
  const d = parser.getCrawlDelay(ua());
  return typeof d === 'number' && Number.isFinite(d) && d > 0 ? d : 0;
}

/**
 * Parse a sitemap.xml into a list of URLs.
 *
 * Handles sitemap-index files recursively, bounded by `SITEMAP_MAX_DEPTH` and
 * `SITEMAP_URL_CAP` so a pathological (or malicious) sitemap cannot exhaust
 * memory or loop forever.
 */
export async function parseSitemap(
  sitemapUrl: string,
  seen = new Set<string>(),
  depth = 0,
): Promise<string[]> {
  if (depth > SITEMAP_MAX_DEPTH || seen.has(sitemapUrl)) return [];
  seen.add(sitemapUrl);
  try {
    const res = await fetch(sitemapUrl, {
      headers: { 'User-Agent': ua() },
      signal: AbortSignal.timeout(ROBOTS_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const isIndex = /<sitemapindex[\s>]/i.test(xml);
    const locs = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => decodeXml(m[1]));

    const out: string[] = [];
    for (const raw of locs) {
      if (out.length >= SITEMAP_URL_CAP) break;
      const u = resolveUrl(raw, sitemapUrl);
      if (!u) continue;
      if (isIndex || /\.xml(\.gz)?(\?|$)/i.test(u)) {
        out.push(...(await parseSitemap(u, seen, depth + 1)));
      } else {
        out.push(u);
      }
    }
    return out.slice(0, SITEMAP_URL_CAP);
  } catch {
    return [];
  }
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export { resolveUrl };
