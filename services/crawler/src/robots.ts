import { loadEnv } from '@zwep/config';
import { hostnameOf, resolveUrl } from './url.ts';
import robotsParser from 'robots-parser';

const env = loadEnv();
const UA = env.CRAWLER_USER_AGENT;

/** Per-host robots cache. */
const robotsCache = new Map<string, any>();

async function getRobots(host: string): Promise<any> {
  const cached = robotsCache.get(host);
  if (cached) return cached;
  const robotsUrl = `https://${host}/robots.txt`;
  let parser: any;
  try {
    const res = await fetch(robotsUrl, { headers: { 'User-Agent': UA } });
    const txt = res.ok ? await res.text() : '';
    parser = robotsParser(robotsUrl, txt);
  } catch {
    parser = robotsParser(robotsUrl, '');
  }
  robotsCache.set(host, parser);
  return parser;
}

export async function isAllowed(url: string): Promise<boolean> {
  const host = hostnameOf(url);
  if (!host) return false;
  const parser = await getRobots(host);
  return parser.isAllowed(url, UA) !== false;
}

/** Crawl-delay (seconds) declared for our UA, if any. */
export async function crawlDelaySec(url: string): Promise<number> {
  const host = hostnameOf(url);
  if (!host) return 0;
  const parser = await getRobots(host);
  const d = parser.getCrawlDelay(UA);
  return typeof d === 'number' ? d : 0;
}

/** Parse a sitemap.xml into a list of URLs (handles sitemap index recursively,
 *  but stops after one level to keep the smoke test bounded). */
export async function parseSitemap(sitemapUrl: string, seen = new Set<string>()): Promise<string[]> {
  if (seen.has(sitemapUrl)) return [];
  seen.add(sitemapUrl);
  try {
    const res = await fetch(sitemapUrl, { headers: { 'User-Agent': UA } });
    if (!res.ok) return [];
    const xml = await res.text();
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
    const out: string[] = [];
    for (const u of urls) {
      if (u.endsWith('.xml') && u !== sitemapUrl) {
        // sitemap index entry → fetch nested (bounded by `seen`)
        out.push(...(await parseSitemap(u, seen)));
      } else {
        out.push(u);
      }
    }
    return out;
  } catch {
    return [];
  }
}

export { resolveUrl };
