import { loadEnv } from '@zwep/config';
import type { SourceConfig } from '@zwep/shared';
import { googleSeedUrls } from './google.ts';
import { hostnameOf } from './url.ts';
import {
  Crawler,
  type CrawlerOptions,
  type CrawlPage,
  type CrawlStats,
  type PageHandler,
} from './crawler.ts';

/**
 * Google-type source: runs configured queries against Google, collects the
 * result URLs, then crawls those URLs with the standard web Crawler.
 *
 * Fragile by design (Google may block / serve interstitials). Best-effort:
 * if a query yields nothing we move on. The resulting documents are indexed
 * exactly like normal web sources.
 */
export class GoogleSourceCrawler {
  private source: SourceConfig;
  private onPage: PageHandler;
  private opts: CrawlerOptions;

  constructor(source: SourceConfig, onPage: PageHandler, opts: CrawlerOptions = {}) {
    this.source = source;
    this.onPage = onPage;
    this.opts = opts;
  }

  async run(maxPages = this.source.maxPages ?? 1000): Promise<CrawlStats> {
    const empty: CrawlStats = { pages: 0, skipped: 0, failed: 0, durationMs: 0 };
    const queries = this.source.queries ?? [];
    if (!queries.length) return empty;

    // Gather candidate URLs from Google (best-effort; may legitimately be empty).
    const seeds = await googleSeedUrls(queries, 8);
    if (!seeds.length) return empty;

    // Crawl the discovered URLs with the standard web crawler. The allow-list
    // is derived from the results themselves, since Google decides the hosts.
    const hosts = [...new Set(seeds.map((s) => hostnameOf(s)).filter((h): h is string => !!h))];
    const web: SourceConfig = {
      ...this.source,
      type: 'web',
      seeds,
      allowedDomains: this.source.allowedDomains.length ? this.source.allowedDomains : hosts,
      maxDepth: 0, // do not follow further links out of Google results
    };
    const env = loadEnv();
    return new Crawler(web, this.onPage, {
      concurrency: env.CRAWLER_CONCURRENCY,
      delayMs: env.CRAWLER_DELAY_MS,
      ...this.opts,
    }).run(maxPages);
  }
}

export type { CrawlPage, CrawlStats, PageHandler };
