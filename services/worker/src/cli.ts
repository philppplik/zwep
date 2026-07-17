/**
 * Zwep crawl worker CLI.
 *   node --experimental-strip-types services/worker/src/cli.ts crawl <source>
 * Crawls a configured source, extracts clean documents, and indexes them.
 */
import { getSource, loadSources } from '@zwep/config';
import { Crawler, type CrawlPage } from '@zwep/crawler';
import { extract } from '@zwep/extractor';
import { Indexer } from '@zwep/indexer';
import type { Document } from '@zwep/shared';

async function crawl(sourceName: string, maxPages?: number) {
  const source = getSource(sourceName) ?? loadSources().find((s) => s.name === sourceName);
  if (!source) {
    console.error(`Source "${sourceName}" not found in config/sources.yaml`);
    process.exit(1);
  }

  const indexer = new Indexer();
  await indexer.ensureIndex();

  const batch: Document[] = [];
  let indexed = 0;
  const BATCH = 50;

  const flush = async () => {
    if (!batch.length) return;
    await indexer.index(batch);
    indexed += batch.length;
    console.log(`  indexed ${indexed} docs so far…`);
    batch.length = 0;
  };

  const onPage = async (page: CrawlPage) => {
    const doc = extract(page, source.name);
    if (doc) {
      batch.push(doc);
      if (batch.length >= BATCH) await flush();
    }
  };

  console.log(`Crawling source "${source.name}" (max ${maxPages ?? source.maxPages ?? 1000} pages)…`);
  const crawler = new Crawler(source, onPage);
  const stats = await crawler.run(maxPages ?? source.maxPages ?? 1000);
  await flush();

  console.log('Done.', {
    pages: stats.pages,
    skipped: stats.skipped,
    failed: stats.failed,
    indexed,
    seconds: (stats.durationMs / 1000).toFixed(1),
  });
  process.exit(0);
}

const cmd = process.argv[2];
if (cmd === 'crawl') {
  crawl(process.argv[3], process.argv[4] ? Number(process.argv[4]) : undefined);
} else if (cmd === 'list') {
  console.log(loadSources().map((s) => `- ${s.name} (${s.allowedDomains.join(', ')})`).join('\n'));
} else {
  console.log('Usage:');
  console.log('  zwep crawl <source> [maxPages]');
  console.log('  zwep list');
  process.exit(cmd ? 1 : 0);
}
