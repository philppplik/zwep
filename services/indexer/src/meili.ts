import { MeiliSearch, type Index, type Settings, type SearchParams } from 'meilisearch';
import type { Document } from '@zwep/shared';
import { loadEnv } from '@zwep/config';
import { getEmbedProvider, resetEmbedProvider } from '@zwep/embed';

/** Engine-agnostic contract so we can swap Meilisearch → Elastic later. */
export interface IndexAdapter {
  ensureIndex(): Promise<void>;
  upsert(docs: Document[]): Promise<void>;
  delete(id: string): Promise<void>;
  deleteBySource(source: string): Promise<void>;
  deleteAll(): Promise<void>;
  get(id: string): Promise<Document | null>;
  count(): Promise<number>;
  rawSearch(q: string, params: SearchParams): Promise<Record<string, unknown>>;
  /** Name of the configured vector embedder, or null when semantic search is off. */
  embedderName(): string | null;
}

/** Name of the Meilisearch embedder used for hybrid (vector) search. */
export const EMBEDDER = 'zwep_default';

const SEARCHABLE = ['title', 'headings', 'excerpt', 'content', 'tags', 'structured'];
const FILTERABLE = ['source', 'type', 'lang', 'tags', 'published_at', 'favicon'];
const SORTABLE = ['published_at', 'crawled_at'];
const RANKING = ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness'];

export class MeiliAdapter implements IndexAdapter {
  private client: MeiliSearch;
  private index: Index<Document>;
  private embedder: string | null = null;

  constructor() {
    const env = loadEnv();
    this.client = new MeiliSearch({ host: env.MEILI_HOST, apiKey: env.MEILI_MASTER_KEY });
    this.index = this.client.index<Document>(env.MEILI_INDEX);
  }

  embedderName(): string | null {
    return this.embedder;
  }

  async ensureIndex(): Promise<void> {
    const uid = loadEnv().MEILI_INDEX;
    const exists = await this.client
      .index(uid)
      .fetchInfo()
      .then(
        () => true,
        () => false,
      );
    if (!exists) {
      const created = await this.client.createIndex(uid, { primaryKey: 'id' });
      await this.client.waitForTask(created.taskUid);
    }

    const settings: Settings = {
      searchableAttributes: SEARCHABLE,
      filterableAttributes: FILTERABLE,
      sortableAttributes: SORTABLE,
      rankingRules: RANKING,
      typoTolerance: { enabled: true, minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 } },
    };

    // Vector search is only configured when an embedding provider answers.
    const provider = await getEmbedProvider();
    if (provider) {
      try {
        const dim = await provider.dimensions();
        (settings as Settings & { embedders?: Record<string, unknown> }).embedders = {
          [EMBEDDER]: { source: 'userProvided', dimensions: dim },
        };
        this.embedder = EMBEDDER;
        console.log(`[meili] vector search enabled (${provider.name}, dim=${dim})`);
      } catch {
        this.embedder = null;
        resetEmbedProvider();
      }
    } else {
      this.embedder = null;
    }

    const task = await this.index.updateSettings(settings);
    await this.index.waitForTask(task.taskUid);
  }

  async upsert(docs: Document[]): Promise<void> {
    if (!docs.length) return;
    const provider = await getEmbedProvider();
    if (provider) {
      const texts = docs.map((d) => `${d.title} ${d.excerpt} ${d.content}`.slice(0, 8000));
      try {
        const vectors = await provider.embed(texts);
        docs.forEach((d, i) => {
          if (vectors[i]) (d as Document & { _vectors?: unknown })._vectors = { [EMBEDDER]: vectors[i] };
        });
      } catch {
        resetEmbedProvider();
      }
    }
    const task = await this.index.addDocuments(docs as never[], { primaryKey: 'id' });
    await this.index.waitForTask(task.taskUid);
  }

  async delete(id: string): Promise<void> {
    const task = await this.index.deleteDocument(id);
    await this.index.waitForTask(task.taskUid);
  }

  async deleteBySource(source: string): Promise<void> {
    const task = await this.index.deleteDocuments({ filter: `source = ${quote(source)}` });
    await this.index.waitForTask(task.taskUid);
  }

  async deleteAll(): Promise<void> {
    const task = await this.index.deleteAllDocuments();
    await this.index.waitForTask(task.taskUid);
  }

  async get(id: string): Promise<Document | null> {
    try {
      return (await this.index.getDocument(id)) as unknown as Document;
    } catch {
      return null;
    }
  }

  async count(): Promise<number> {
    const stats = await this.index.getStats();
    return stats.numberOfDocuments ?? 0;
  }

  async rawSearch(q: string, params: SearchParams): Promise<Record<string, unknown>> {
    return (await this.index.search(q, params)) as unknown as Record<string, unknown>;
  }
}

/**
 * Quote a value for a Meilisearch filter expression.
 *
 * Source names and tags come from user input, so an unescaped `"` would let a
 * caller break out of the string and rewrite the whole filter.
 */
export function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

let adapter: IndexAdapter | null = null;

export function getAdapter(): IndexAdapter {
  if (!adapter) adapter = new MeiliAdapter();
  return adapter;
}

/** Test seam: swap in a fake adapter. */
export function setAdapter(next: IndexAdapter | null): void {
  adapter = next;
}
