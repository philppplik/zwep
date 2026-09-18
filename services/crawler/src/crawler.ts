import { loadEnv } from '@zwep/config';
import type { SourceConfig } from '@zwep/shared';
import { chromium, type Browser } from 'playwright';
import pLimit from 'p-limit';
import {
  canonicalizeUrl,
  docId,
  hostnameOf,
  isHttpUrl,
  resolveUrl,
  filterAllowed,
  looksLikeAsset,
} from './url.ts';
import { isAllowed, crawlDelaySec, parseSitemap } from './robots.ts';

export interface CrawlPage {
  id: string;
  url: string;
  canonical_url: string;
  content: string; // raw html (or rendered)
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

export interface CrawlerOptions {
  concurrency?: number;
  delayMs?: number;
  timeoutMs?: number;
  maxBytes?: number;
  /** Abort an in-flight crawl (used by the CLI's Ctrl-C handler). */
  signal?: AbortSignal;
}

/** Content types we are willing to parse as a document. */
const HTML_TYPES = /^(text\/html|application\/xhtml\+xml|text\/plain)/i;

/**
 * Breadth-first crawler for one source. Honours robots.txt and crawl-delay,
 * stays inside `allowedDomains`, dedups by canonical URL, and re-fetches with
 * Playwright when the raw HTML yields too little text.
 *
 * Safety properties this class guarantees:
 *   - every network fetch has a timeout and a response-size cap;
 *   - a URL is enqueued at most once (not "processed at most once"), so the
 *     same page is never fetched twice inside a run;
 *   - per-host politeness is serialized through a promise chain, so N parallel
 *     workers cannot burst a single host;
 *   - the Playwright browser is always closed, including on error.
 */
export class Crawler {
  private browser: Browser | null = null;
  private readonly limit: ReturnType<typeof pLimit>;
  private readonly delayMs: number;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly source: SourceConfig;
  private readonly onPage: PageHandler;
  private readonly signal?: AbortSignal;
  /** Canonical URLs already enqueued — prevents duplicate fetches. */
  private readonly seen = new Set<string>();
  private queue: { url: string; depth: number }[] = [];
  private stats: CrawlStats = { pages: 0, skipped: 0, failed: 0, durationMs: 0 };
  /** Per-host serialization chain for the politeness delay. */
  private hostGate = new Map<string, Promise<void>>();
  private readonly allowedHosts: Set<string>;

  constructor(source: SourceConfig, onPage: PageHandler, opts: CrawlerOptions = {}) {
    const env = loadEnv();
    this.source = source;
    this.onPage = onPage;
    this.signal = opts.signal;
    this.limit = pLimit(Math.max(1, opts.concurrency ?? env.CRAWLER_CONCURRENCY));
    this.delayMs = opts.delayMs ?? env.CRAWLER_DELAY_MS;
    this.timeoutMs = opts.timeoutMs ?? env.CRAWLER_TIMEOUT_MS;
    this.maxBytes = opts.maxBytes ?? env.CRAWLER_MAX_BYTES;
    this.allowedHosts = new Set(
      source.allowedDomains
        .map((d) =>
          d
            .trim()
            .toLowerCase()
            .replace(/^www\./, ''),
        )
        .filter(Boolean),
    );
    // A `web` source with no allow-list would otherwise crawl the open internet.
    // Fall back to the hosts of its own seeds.
    if (!this.allowedHosts.size) {
      for (const s of source.seeds) {
        const h = hostnameOf(s);
        if (h) this.allowedHosts.add(h);
      }
    }
  }

  private async getBrowser(): Promise<Browser> {
    if (!this.browser) this.browser = await chromium.launch({ args: ['--no-sandbox'] });
    return this.browser;
  }

  /** Seed the queue from `seeds` plus the sitemap, if one is configured. */
  async init(): Promise<void> {
    for (const s of this.source.seeds) this.enqueue(s, 0);
    if (this.source.sitemap) {
      const urls = await parseSitemap(this.source.sitemap);
      for (const u of urls) this.enqueue(u, 0);
    }
  }

  private enqueue(url: string, depth: number): void {
    const canon = canonicalizeUrl(url);
    if (this.seen.has(canon)) return;
    if (looksLikeAsset(canon)) return;
    if (this.allowedHosts.size && !this.allowedHosts.has(hostnameOf(canon) ?? '')) return;
    this.seen.add(canon);
    this.queue.push({ url: canon, depth });
  }

  async run(maxPages = this.source.maxPages ?? 1000): Promise<CrawlStats> {
    const t0 = Date.now();
    try {
      await this.init();
      while (this.queue.length && this.stats.pages < maxPages && !this.signal?.aborted) {
        // Never take more jobs than we still have page budget for.
        const room = maxPages - this.stats.pages;
        const size = Math.min(this.limit.concurrency * 2, 25, room);
        const batch = this.queue.splice(0, Math.max(1, size));
        await Promise.all(
          batch.map((job) => this.limit(() => this.process(job.url, job.depth, maxPages))),
        );
      }
    } finally {
      if (this.browser) {
        await this.browser.close().catch(() => {});
        this.browser = null;
      }
      this.stats.durationMs = Date.now() - t0;
    }
    return this.stats;
  }

  private async process(url: string, depth: number, maxPages: number): Promise<void> {
    if (this.stats.pages >= maxPages || this.signal?.aborted) return;
    const canon = canonicalizeUrl(url);

    if (!(await isAllowed(url))) {
      this.stats.skipped++;
      return;
    }
    await this.politeWait(url);

    let html: string;
    let rendered = false;
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': loadEnv().CRAWLER_USER_AGENT,
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) {
        this.stats.failed++;
        return;
      }
      const ctype = res.headers.get('content-type') ?? '';
      if (ctype && !HTML_TYPES.test(ctype)) {
        this.stats.skipped++;
        return;
      }
      html = await readCapped(res, this.maxBytes);
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

    this.stats.pages++;
    await this.onPage({
      id: docId(this.source.name, canon),
      url,
      canonical_url: canon,
      content: html,
      rendered,
      fetchedAt: new Date().toISOString(),
    });

    const maxDepth = this.source.maxDepth ?? 4;
    if (depth < maxDepth) {
      const links = this.extractLinks(html, url);
      for (const l of filterAllowed(links, this.allowedHosts)) this.enqueue(l, depth + 1);
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
      const page = await browser.newPage({ userAgent: loadEnv().CRAWLER_USER_AGENT });
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: this.timeoutMs });
        return await page.content();
      } finally {
        await page.close().catch(() => {});
      }
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
      if (!raw || raw.startsWith('#')) continue;
      if (/^(mailto|javascript|tel|data|ftp):/i.test(raw)) continue;
      if (!isHttpUrl(raw) && !raw.startsWith('/') && !raw.startsWith('.')) continue;
      const resolved = resolveUrl(raw, base);
      if (resolved) out.push(resolved);
    }
    return out;
  }

  /**
   * Wait out the politeness delay for this URL's host.
   *
   * Each host owns a promise chain; a new request links itself onto the tail,
   * so requests to the same host are spaced by at least `delay` even when many
   * workers run in parallel. Different hosts never block each other.
   */
  private politeWait(url: string): Promise<void> {
    const host = hostnameOf(url) ?? '?';
    const prev = this.hostGate.get(host) ?? Promise.resolve();
    const next = prev.then(async () => {
      const declared = await crawlDelaySec(url).catch(() => 0);
      const wait = Math.max(this.delayMs, declared * 1000);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    });
    // Swallow rejections so one failure cannot poison the chain.
    this.hostGate.set(
      host,
      next.catch(() => {}),
    );
    return next;
  }
}

/**
 * Read a response body as text, refusing to buffer more than `maxBytes`.
 * Protects the crawler from a hostile or accidental multi-gigabyte response.
 */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new Error(`Response too large: ${declared} bytes`);
  if (!res.body) return res.text();

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let kept = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (kept + value.byteLength > maxBytes) {
      // Keep the prefix that still fits, then stop — a truncated document is
      // more useful than none, and the connection is released immediately.
      const room = maxBytes - kept;
      if (room > 0) {
        chunks.push(value.subarray(0, room));
        kept += room;
      }
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
    kept += value.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(concat(chunks, kept));
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}
