import { loadEnv } from '@zwep/config';
import Database from 'better-sqlite3';
import { resolve, dirname } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';

/**
 * Lightweight knowledge graph over indexed documents (Phase B).
 *
 * Stored in SQLite (no extra container). Two tables:
 *   - entities(id, label, type, doc_count)   : unique concepts mentioned across docs
 *   - edges(src, dst, weight, kind)          : relationships (co-mention / link)
 *
 * Entities are extracted by a simple but effective heuristic (capitalized
 * noun phrases + known proper nouns from titles/headings) — no heavy NLP dep.
 * This gives a real, queryable graph without Neo4j. A future LLM-based
 * extractor can replace `extractEntities` transparently.
 */

export interface Entity {
  label: string;
  type: string;
}

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  doc_count: number;
}

export interface GraphEdge {
  src: string;
  dst: string;
  weight: number;
  kind: string;
}

function dbPath(): string {
  const env = loadEnv();
  if (env.GRAPH_DB) return env.GRAPH_DB;
  return resolve(process.cwd(), 'data/graph.db');
}

export class KnowledgeGraph {
  private db: Database.Database;

  constructor(path = dbPath()) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'concept',
        doc_count INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS edges (
        src TEXT NOT NULL,
        dst TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1,
        kind TEXT NOT NULL DEFAULT 'co-mention',
        PRIMARY KEY (src, dst, kind)
      );
      CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst);
    `);
  }

  /** Extract candidate entities from a document's text. Heuristic, fast, no deps. */
  static extractEntities(text: string, title = ''): Entity[] {
    const blob = `${title}. ${text}`;
    const found = new Map<string, string>();
    // proper nouns: sequences of Capitalized words (2-4 tokens), len >= 3
    const re = /\b([A-Z][a-zäöüß]{2,}(?:\s+[A-Z][a-zäöüß]{2,}){0,3})\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(blob)) !== null) {
      const label = m[1].trim();
      if (label.length < 3 || STOPWORDS.has(label.toLowerCase())) continue;
      const id = slug(label);
      if (!found.has(id)) found.set(id, label);
    }
    return [...found].map(([id, label]) => ({ label, type: guessType(label) }));
  }

  /** Upsert entities + co-mention edges for one document. */
  indexDoc(docId: string, entities: Entity[]) {
    if (!entities.length) return;
    const ids = entities.map((e) => e.label);
    const tx = this.db.transaction((ents: Entity[]) => {
      for (const e of ents) {
        const id = slug(e.label);
        this.db
          .prepare('INSERT INTO entities (id, label, type, doc_count) VALUES (?,?,?,1) ON CONFLICT(id) DO UPDATE SET doc_count = doc_count + 1')
          .run(id, e.label, e.type);
      }
      // co-mention edges between all pairs in this doc
      for (let i = 0; i < ents.length; i++) {
        for (let j = i + 1; j < ents.length; j++) {
          const a = slug(ents[i].label);
          const b = slug(ents[j].label);
          this.db
            .prepare('INSERT INTO edges (src, dst, weight, kind) VALUES (?,?,1,\'co-mention\') ON CONFLICT(src,dst,kind) DO UPDATE SET weight = weight + 1')
            .run(a, b);
        }
      }
    });
    tx(entities);
  }

  /** Get the graph neighborhood (nodes + edges) around a query term. */
  neighborhood(query: string, depth = 1, limit = 40): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const q = query.toLowerCase();
    // seed nodes: entities whose label contains the query
    const seeds = this.db
      .prepare('SELECT * FROM entities WHERE lower(label) LIKE ? ORDER BY doc_count DESC LIMIT ?')
      .all(`%${q}%`, limit) as GraphNode[];
    if (!seeds.length) return { nodes: [], edges: [] };
    const nodeIds = new Set(seeds.map((s) => s.id));
    const edges: GraphEdge[] = [];
    // expand one hop
    const seenEdge = new Set<string>();
    for (const s of seeds) {
      const out = this.db.prepare('SELECT * FROM edges WHERE src = ? OR dst = ? ORDER BY weight DESC LIMIT ?').all(s.id, s.id, depth * 10) as GraphEdge[];
      for (const e of out) {
        const key = `${e.src}|${e.dst}|${e.kind}`;
        if (seenEdge.has(key)) continue;
        seenEdge.add(key);
        edges.push(e);
        nodeIds.add(e.src);
        nodeIds.add(e.dst);
      }
    }
    const nodes = this.db
      .prepare(`SELECT * FROM entities WHERE id IN (${[...nodeIds].map(() => '?').join(',')})`)
      .all(...nodeIds) as GraphNode[];
    return { nodes, edges };
  }

  stats(): { entities: number; edges: number } {
    const e = (this.db.prepare('SELECT COUNT(*) c FROM entities').get() as { c: number }).c;
    const ed = (this.db.prepare('SELECT COUNT(*) c FROM edges').get() as { c: number }).c;
    return { entities: e, edges: ed };
  }

  close() {
    this.db.close();
  }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);
}

function guessType(label: string): string {
  if (/^[A-Z]\w+\s+\d{4}$/.test(label)) return 'event';
  if (/\b(GmbH|Inc|LLC|AG|Corp|Ltd)\b/i.test(label)) return 'org';
  if (/\b(University|Institute|Lab)\b/i.test(label)) return 'org';
  return 'concept';
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'your', 'are', 'was', 'were',
  'have', 'has', 'will', 'can', 'not', 'but', 'they', 'their', 'our', 'all', 'more',
  'what', 'when', 'where', 'which', 'who', 'how', 'why', 'der', 'die', 'das', 'und',
  'für', 'mit', 'nicht', 'ein', 'eine', 'ist', 'sind', 'werden', 'wird', 'auf', 'von',
  'im', 'am', 'an', 'als', 'wie', 'nach', 'über', 'zum', 'zur', 'des', 'dem', 'den',
  'about', 'into', 'than', 'then', 'them', 'there', 'here', 'also', 'been', 'being',
  'search', 'results', 'result', 'page', 'website', 'home', 'menu', 'privacy', 'imprint',
]);
