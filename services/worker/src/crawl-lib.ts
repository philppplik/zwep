/**
 * Shared crawl routine — used by both the CLI and the Admin API.
 * Returns a summary instead of calling process.exit, so it is embeddable.
 */
import { getSource, loadSources } from '@zwep/config';
import { Crawler, type CrawlPage } from '@zwep/crawler';
import { extract } from '@zwep/extractor';
import { Indexer } from '@zwep/indexer';
import type { Document } from '@zwep/shared';

export interface CrawlSummary {
  source: string;
  pages: number;
  skipped: number;
  failed: number;
  indexed: number;
  seconds: number;
}

export async function crawlSource(sourceName: string, maxPages?: number): Promise<CrawlSummary> {
  const source = getSource(sourceName) ?? loadSources().find((s) => s.name === sourceName);
  if (!source) throw new Error(`Source "${sourceName}" not found`);

  const indexer = new Indexer();
  await indexer.ensureIndex();

  const batch: Document[] = [];
  let indexed = 0;
  const BATCH = 50;

  const flush = async () => {
    if (!batch.length) return;
    await indexer.index(batch);
    indexed += batch.length;
    batch.length = 0;
  };

  const onPage = async (page: CrawlPage) => {
    const doc = extract(page, source.name);
    if (doc) {
      batch.push(doc);
      if (batch.length >= BATCH) await flush();
    }
  };

  const crawler = new Crawler(source, onPage);
  const stats = await crawler.run(maxPages ?? source.maxPages ?? 1000);
  await flush();

  return {
    source: source.name,
    pages: stats.pages,
    skipped: stats.skipped,
    failed: stats.failed,
    indexed,
    seconds: stats.durationMs / 1000,
  };
}
