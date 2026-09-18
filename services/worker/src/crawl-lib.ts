/**
 * Shared crawl routine — used by the CLI, the agent CLI and the Admin API.
 * Returns a summary instead of calling `process.exit`, so it stays embeddable.
 */
import { getSource } from '@zwep/config';
import { Crawler, GoogleSourceCrawler, type CrawlPage } from '@zwep/crawler';
import { extract } from '@zwep/extractor';
import { Indexer } from '@zwep/indexer';
import { KnowledgeGraph } from '@zwep/graph';
import type { CrawlSummary, Document } from '@zwep/shared';

export type { CrawlSummary } from '@zwep/shared';

/** Documents are flushed to the index in batches of this size. */
const BATCH = 50;

let graph: KnowledgeGraph | null = null;

function getGraph(): KnowledgeGraph {
  if (!graph) graph = new KnowledgeGraph();
  return graph;
}

export interface CrawlOptions {
  maxPages?: number;
  signal?: AbortSignal;
  /** Called after every flush, for progress reporting. */
  onProgress?: (progress: { pages: number; indexed: number }) => void;
}

export async function crawlSource(
  sourceName: string,
  maxPagesOrOptions?: number | CrawlOptions,
): Promise<CrawlSummary> {
  const opts: CrawlOptions =
    typeof maxPagesOrOptions === 'number'
      ? { maxPages: maxPagesOrOptions }
      : (maxPagesOrOptions ?? {});

  const source = getSource(sourceName);
  if (!source) throw new Error(`Source "${sourceName}" not found`);

  const indexer = new Indexer();
  await indexer.ensureIndex();

  const batch: Document[] = [];
  let indexed = 0;
  let seen = 0;

  const flush = async () => {
    if (!batch.length) return;
    const chunk = batch.splice(0, batch.length);
    await indexer.index(chunk);
    indexed += chunk.length;
    opts.onProgress?.({ pages: seen, indexed });
  };

  const onPage = async (page: CrawlPage) => {
    seen++;
    const doc = extract(page, source.name);
    if (!doc) return;
    try {
      const ents = KnowledgeGraph.extractEntities(doc.content, doc.title);
      if (ents.length) getGraph().indexDoc(doc.id, ents);
    } catch {
      /* the knowledge graph is best-effort and must never fail a crawl */
    }
    batch.push(doc);
    if (batch.length >= BATCH) await flush();
  };

  const limit = opts.maxPages ?? source.maxPages ?? 1000;
  const crawler =
    source.type === 'google'
      ? new GoogleSourceCrawler(source, onPage, { signal: opts.signal })
      : new Crawler(source, onPage, { signal: opts.signal });

  const stats = await crawler.run(limit);
  await flush();

  return {
    source: source.name,
    pages: stats.pages,
    skipped: stats.skipped,
    failed: stats.failed,
    indexed,
    seconds: Math.round((stats.durationMs / 1000) * 10) / 10,
  };
}
