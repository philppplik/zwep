import { loadEnv } from '@zwep/config';
import type { SourceConfig } from '@zwep/shared';
import { googleSeedUrls } from './google.ts';
import { Crawler, type CrawlPage, type CrawlStats, type PageHandler } from './crawler.ts';

const env = loadEnv();

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

  constructor(source: SourceConfig, onPage: PageHandler) {
    this.source = source;
    this.onPage = onPage;
  }

  async run(maxPages = this.source.maxPages ?? 1000): Promise<CrawlStats> {
    const queries = this.source.queries ?? [];
    if (!queries.length) {
      return { pages: 0, skipped: 0, failed: 0, durationMs: 0 };
    }
    // gather candidate URLs from Google
    const seeds = await googleSeedUrls(queries, 8);
    if (!seeds.length) {
      return { pages: 0, skipped: 0, failed: 0, durationMs: 0 };
    }
    // crawl the discovered URLs with the web crawler
    const web: SourceConfig = {
      ...this.source,
      type: 'web',
      seeds,
      maxDepth: 0, // do not follow further links from Google results
    };
    const crawler = new Crawler(web, this.onPage, {
      concurrency: env.CRAWLER_CONCURRENCY,
      delayMs: env.CRAWLER_DELAY_MS,
    });
    return crawler.run(maxPages);
  }
}

export type { CrawlPage, CrawlStats, PageHandler };
