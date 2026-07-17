import { loadEnv } from '@zwep/config';
import type { SourceConfig } from '@zwep/shared';
import { chromium, type Browser } from 'playwright';
import pLimit from 'p-limit';
import { createHash } from 'node:crypto';
import {
  canonicalizeUrl,
  docId,
  hostnameOf,
  isHttpUrl,
  resolveUrl,
  filterAllowed,
} from './url.ts';
import { isAllowed, crawlDelaySec, parseSitemap } from './robots.ts';

const env = loadEnv();

export interface CrawlPage {
  id: string;
  url: string;
  canonical_url: string;
  content: string;       // raw html (or rendered)
  rendered: boolean;
  fetchedAt: string;
}

export interface CrawlStats {
  pages: number;
  skipped: number;
  failed: number;
  durationMs: number;
}

export type PageHandler = (page: CrawlPage) => Promise<void> | void;

/**
 * Breadth-first crawler for one source. Honours robots.txt + crawl-delay,
 * stays within allowedDomains, dedups by canonical URL, and renders JS pages
 * with Playwright when raw HTML yields too little text.
 */
export class Crawler {
  private browser: Browser | null = null;
  private limit: ReturnType<typeof pLimit>;
  private delayMs: number;
  private source: SourceConfig;
  private onPage: PageHandler;
  private visited = new Set<string>();
  private queue: { url: string; depth: number }[] = [];
  private stats: CrawlStats = { pages: 0, skipped: 0, failed: 0, durationMs: 0 };
  private lastFetch = new Map<string, number>();
  private allowedHosts: Set<string>;

  constructor(
    source: SourceConfig,
    onPage: PageHandler,
    opts: { concurrency?: number; delayMs?: number } = {}
  ) {
    this.source = source;
    this.onPage = onPage;
    this.limit = pLimit(opts.concurrency ?? env.CRAWLER_CONCURRENCY);
    this.delayMs = opts.delayMs ?? env.CRAWLER_DELAY_MS;
    this.allowedHosts = new Set(source.allowedDomains.map((d) => d.replace(/^www\./, '')));
  }

  private async getBrowser(): Promise<Browser> {
    if (!this.browser) this.browser = await chromium.launch({ args: ['--no-sandbox'] });
    return this.browser;
  }

  /** Seed from seeds + sitemap. */
  async init(): Promise<void> {
    for (const s of this.source.seeds) this.enqueue(s, 0);
    if (this.source.sitemap) {
      const urls = await parseSitemap(this.source.sitemap);
      for (const u of urls) this.enqueue(u, 0);
    }
  }

  private enqueue(url: string, depth: number) {
    const canon = canonicalizeUrl(url);
    if (this.visited.has(canon)) return;
    if (this.allowedHosts.size && !this.allowedHosts.has(hostnameOf(canon) ?? '')) return;
    this.queue.push({ url: canon, depth });
  }

  async run(maxPages = this.source.maxPages ?? 1000): Promise<CrawlStats> {
    const t0 = Date.now();
    await this.init();
    while (this.queue.length && this.stats.pages < maxPages) {
      const batch = this.queue.splice(0, Math.min(this.limit.concurrency, 25));
      await Promise.all(
        batch.map((job) =>
          this.limit(async () => {
            await this.process(job.url, job.depth, maxPages);
          })
        )
      );
    }
    if (this.browser) await this.browser.close();
    this.stats.durationMs = Date.now() - t0;
    return this.stats;
  }

  private async process(url: string, depth: number, maxPages: number) {
    const canon = canonicalizeUrl(url);
    if (this.visited.has(canon)) return;
    this.visited.add(canon);

    // robots
    if (!(await isAllowed(url))) {
      this.stats.skipped++;
      return;
    }
    // politeness delay per host
    await this.politeWait(url);

    let html = '';
    let rendered = false;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': env.CRAWLER_USER_AGENT },
        redirect: 'follow',
      });
      if (!res.ok) {
        this.stats.failed++;
        return;
      }
      html = await res.text();
      // fast path: if little text, try rendering
      if (this.looksJsHeavy(html)) {
        const r = await this.render(url);
        if (r) {
          html = r;
          rendered = true;
        }
      }
    } catch {
      this.stats.failed++;
      return;
    }

    const sha = createHash('sha256').update(html).digest('hex');
    this.stats.pages++;
    await this.onPage({
      id: docId(this.source.name, canon, sha),
      url,
      canonical_url: canon,
      content: html,
      rendered,
      fetchedAt: new Date().toISOString(),
    });

    // discover links (bounded depth)
    const maxDepth = this.source.maxDepth ?? 4;
    if (depth < maxDepth) {
      const links = this.extractLinks(html, url);
      for (const l of filterAllowed(links, this.allowedHosts)) {
        this.enqueue(l, depth + 1);
      }
    }
  }

  private looksJsHeavy(html: string): boolean {
    const textLen = (html.match(/>([^<]{20,})</g) || []).join('').length;
    const hasAppRoot = /<div[^>]*id=["'](app|root|__next)["']/.test(html);
    return textLen < 400 || (hasAppRoot && textLen < 1200);
  }

  private async render(url: string): Promise<string | null> {
    try {
      const browser = await this.getBrowser();
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
      const content = await page.content();
      await page.close();
      return content;
    } catch {
      return null;
    }
  }

  private extractLinks(html: string, base: string): string[] {
    const out: string[] = [];
    const re = /href=["']([^"']+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      const raw = m[1].trim();
      if (!isHttpUrl(raw) && !raw.startsWith('/')) continue;
      if (raw.startsWith('#') || raw.startsWith('mailto:') || raw.startsWith('javascript:')) continue;
      const resolved = resolveUrl(raw, base);
      if (resolved) out.push(resolved);
    }
    return out;
  }

  private async politeWait(url: string) {
    const host = hostnameOf(url) ?? '?';
    const last = this.lastFetch.get(host) ?? 0;
    const declared = await crawlDelaySec(url);
    const wait = Math.max(this.delayMs, declared * 1000);
    const elapsed = Date.now() - last;
    if (elapsed < wait) {
      await new Promise((r) => setTimeout(r, wait - elapsed));
    }
    this.lastFetch.set(host, Date.now());
  }
}
