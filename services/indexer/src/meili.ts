import { MeiliSearch, type Index, type Settings } from 'meilisearch';
import type { Document } from '@zwep/shared';
import { loadEnv } from '@zwep/config';

/** Engine-agnostic contract so we can swap Meilisearch → Elastic later. */
export interface IndexAdapter {
  ensureIndex(): Promise<void>;
  upsert(docs: Document[]): Promise<void>;
  delete(id: string): Promise<void>;
  deleteBySource(source: string): Promise<void>;
  get(id: string): Promise<Document | null>;
}

const SEARCHABLE = ['title', 'headings', 'excerpt', 'content', 'tags', 'structured'];
const FILTERABLE = ['source', 'type', 'lang', 'tags', 'published_at', 'favicon'];
const SORTABLE = ['published_at', 'crawled_at'];
const RANKING = ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness'];

export class MeiliAdapter implements IndexAdapter {
  private client: MeiliSearch;
  private index: Index<Document>;

  constructor() {
    const env = loadEnv();
    this.client = new MeiliSearch({ host: env.MEILI_HOST, apiKey: env.MEILI_MASTER_KEY });
    this.index = this.client.index<Document>(env.MEILI_INDEX);
  }

  async ensureIndex(): Promise<void> {
    const env = loadEnv();
    const uid = env.MEILI_INDEX;
    const exists = await this.client.index(uid).fetchInfo().then(
      () => true,
      () => false
    );
    if (!exists) {
      await this.client.createIndex(uid, { primaryKey: 'id' });
    }
    const settings: Settings = {
      searchableAttributes: SEARCHABLE,
      filterableAttributes: FILTERABLE,
      sortableAttributes: SORTABLE,
      rankingRules: RANKING,
      typoTolerance: { enabled: true, minWordSizeForTypos: { oneTypo: 5, twoTypos: 9 } },
    };
    await this.index.updateSettings(settings);
  }

  async upsert(docs: Document[]): Promise<void> {
    if (!docs.length) return;
    // strip heavy `content` field from index storage? keep it searchable but
    // it's fine for v1; Meili compresses well.
    const task = await this.index.addDocuments(docs, { primaryKey: 'id' });
    await this.index.waitForTask(task.taskUid);
  }

  async delete(id: string): Promise<void> {
    await this.index.deleteDocument(id);
  }

  async deleteBySource(source: string): Promise<void> {
    await this.index.deleteDocuments({ filter: `source = "${source}"` });
  }

  async get(id: string): Promise<Document | null> {
    try {
      return await this.index.getDocument(id);
    } catch {
      return null;
    }
  }
}

let adapter: IndexAdapter | null = null;
export function getAdapter(): IndexAdapter {
  if (!adapter) adapter = new MeiliAdapter();
  return adapter;
}
