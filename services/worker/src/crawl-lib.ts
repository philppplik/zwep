/** Shared crawl routine — used by both the CLI and the Admin API.
 * Returns a summary instead of calling process.exit, so it is embeddable. */
import { getSource, loadSources } from '@zwep/config';
import { Crawler, GoogleSourceCrawler, type CrawlPage } from '@zwep/crawler';
import { extract } from '@zwep/extractor';
import { Indexer } from '@zwep/indexer';
import { KnowledgeGraph } from '@zwep/graph';
import type { Document } from '@zwep/shared';

let graph: KnowledgeGraph | null = null;
function getGraph(): KnowledgeGraph {
  if (!graph) graph = new KnowledgeGraph();
  return graph;
}

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
      // Phase B: feed the knowledge graph
      try {
        const ents = KnowledgeGraph.extractEntities(doc.content, doc.title);
        if (ents.length) getGraph().indexDoc(doc.id, ents);
      } catch {
        /* graph is best-effort */
      }
      batch.push(doc);
      if (batch.length >= BATCH) await flush();
    }
  };

  const crawler =
    source.type === 'google'
      ? new GoogleSourceCrawler(source, onPage)
      : new Crawler(source, onPage);
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
