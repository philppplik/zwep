import { loadEnv, dataDir } from '@zwep/config';
import Database from 'better-sqlite3';
import { resolve, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

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

/**
 * Upper bound on entities harvested from one document. Without it, a glossary
 * page produced thousands of entities and O(n^2) co-mention edges, which is
 * how a single crawl could balloon the graph database.
 */
export const MAX_ENTITIES_PER_DOC = 60;

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
  // Anchored to the repo's data directory rather than `process.cwd()`, so the
  // API, the CLI and the worker all open the same database no matter where
  // they were started from.
  return resolve(dataDir(), 'graph.db');
}

/** Canonical alias map — merges spelling/name variants into one entity. */
const ALIASES: Record<string, string> = {
  'angela merkel': 'merkel',
  'mutti merkel': 'merkel',
  'olaf scholz': 'scholz',
  'robert habeck': 'habeck',
  'christian lindner': 'lindner',
  'friedrich merz': 'merz',
  'donald trump': 'trump',
  'joe biden': 'biden',
  'wladimir putin': 'putin',
  'vladimir putin': 'putin',
  'ursula von der leyen': 'von_der_leyen',
};

/** Levenshtein distance (for fuzzy entity merging). */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

/**
 * Cap on how many known entities a fuzzy lookup may compare against.
 *
 * The fuzzy merge is O(entities) per candidate, so on a graph with 100k
 * entities a single document triggered millions of Levenshtein runs and the
 * crawl stalled. Comparing against a bounded, length-bucketed slice keeps the
 * useful typo merges ("Märkel" → "merkel") at a fixed cost.
 */
const FUZZY_SCAN_LIMIT = 2000;

/**
 * Normalize a raw entity label to its canonical form.
 * Applies: lowercase trim, alias merge, then a bounded fuzzy match against
 * known entities (Levenshtein <= 1) to merge typos like "Märkel" → "merkel".
 */
function normalizeEntity(label: string, existing: Set<string>): string {
  const low = label.toLowerCase().trim();
  if (ALIASES[low]) return ALIASES[low];
  if (existing.has(low)) return low;
  // Exact hits are handled above; only short labels benefit from fuzzy merging
  // and only a bounded slice of the entity set is scanned.
  if (low.length < 4 || low.length > 40) return low;
  let scanned = 0;
  for (const e of existing) {
    if (scanned++ > FUZZY_SCAN_LIMIT) break;
    if (Math.abs(e.length - low.length) > 1) continue;
    if (levenshtein(e, low) <= 1) return e;
  }
  return low;
}

export class KnowledgeGraph {
  private db: Database.Database;
  private entityCache: Set<string> | null = null;

  constructor(path = dbPath()) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private loadEntityCache() {
    if (this.entityCache) return;
    const rows = this.db.prepare('SELECT id FROM entities').all() as { id: string }[];
    this.entityCache = new Set(rows.map((r) => r.id));
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

  /**
   * Extract candidate entities from a document's text. Heuristic, fast, no deps.
   *
   * Matches runs of capitalised words, optionally followed by a legal-form
   * suffix. The suffix clause matters: `GmbH`, `AG` and `LLC` are not
   * `[A-Z][a-z]+`, so without it "Acme GmbH" was only ever captured as "Acme"
   * and `guessType`'s organisation branch could never fire on real text.
   */
  static extractEntities(text: string, title = ''): Entity[] {
    const blob = `${title}. ${text}`;
    const found = new Map<string, string>();
    const word = '[A-Z][a-zäöüßéèêáàâ]{2,}';
    const re = new RegExp(
      `\\b(${word}(?:\\s+${word}){0,3}(?:\\s+(?:${LEGAL_FORMS.join('|')}))?)\\b`,
      'g',
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(blob)) !== null) {
      const label = m[1].trim();
      if (label.length < 3 || STOPWORDS.has(label.toLowerCase())) continue;
      const id = slug(label);
      if (!found.has(id)) found.set(id, label);
    }
    return [...found]
      .slice(0, MAX_ENTITIES_PER_DOC)
      .map(([, label]) => ({ label, type: guessType(label) }));
  }

  /**
   * Upsert entities and co-mention edges for one document.
   *
   * Each distinct entity counts once per document (the label may appear many
   * times in the text), and edges are stored with `src < dst` so that a pair
   * co-mentioned in two documents strengthens one edge instead of creating two
   * mirrored ones.
   */
  indexDoc(_docId: string, entities: Entity[]) {
    if (!entities.length) return;
    this.loadEntityCache();

    const insertEntity = this.db.prepare(
      'INSERT INTO entities (id, label, type, doc_count) VALUES (?,?,?,1) ' +
        'ON CONFLICT(id) DO UPDATE SET doc_count = doc_count + 1',
    );
    const insertEdge = this.db.prepare(
      "INSERT INTO edges (src, dst, weight, kind) VALUES (?,?,1,'co-mention') " +
        'ON CONFLICT(src,dst,kind) DO UPDATE SET weight = weight + 1',
    );

    const tx = this.db.transaction((ents: Entity[]) => {
      const ids = new Map<string, { label: string; type: string }>();
      for (const e of ents) {
        const canon = normalizeEntity(e.label, this.entityCache!);
        const id = slug(canon);
        if (id && !ids.has(id)) ids.set(id, { label: canon, type: e.type });
      }
      for (const [id, { label, type }] of ids) {
        insertEntity.run(id, label, type);
        this.entityCache!.add(id);
      }
      const list = [...ids.keys()];
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const [a, b] = list[i] < list[j] ? [list[i], list[j]] : [list[j], list[i]];
          insertEdge.run(a, b);
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
      const out = this.db
        .prepare('SELECT * FROM edges WHERE src = ? OR dst = ? ORDER BY weight DESC LIMIT ?')
        .all(s.id, s.id, depth * 10) as GraphEdge[];
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

  /** Export the full graph (all entities + edges) as a shareable object. */
  all(): { nodes: GraphNode[]; edges: GraphEdge[]; stats: { entities: number; edges: number } } {
    const nodes = this.db
      .prepare('SELECT * FROM entities ORDER BY doc_count DESC')
      .all() as GraphNode[];
    const edges = this.db.prepare('SELECT * FROM edges ORDER BY weight DESC').all() as GraphEdge[];
    return { nodes, edges, stats: this.stats() };
  }

  close() {
    this.db.close();
  }
}

/**
 * Turn an entity label into a stable id.
 *
 * The input is crawled page text, so it is attacker-influenced. `/^_+|_+$/`
 * over a long run of separators backtracks polynomially, which makes a page of
 * punctuation a cheap way to stall a crawl. Trimming the separator with
 * explicit index arithmetic is linear and does the same job.
 */
function slug(s: string): string {
  const collapsed = s.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '_');
  let start = 0;
  let end = collapsed.length;
  while (start < end && collapsed[start] === '_') start++;
  while (end > start && collapsed[end - 1] === '_') end--;
  return collapsed.slice(start, end).slice(0, 64);
}

/**
 * Legal-form suffixes that mark an entity as an organisation.
 *
 * Also spliced into the entity regex above, so "Acme GmbH" is captured as one
 * entity instead of the bare "Acme" — which is why this branch used to be
 * unreachable on real text.
 */
const LEGAL_FORMS = [
  'GmbH',
  'mbH',
  'AG',
  'SE',
  'KG',
  'Inc',
  'LLC',
  'Ltd',
  'Corp',
  'PLC',
  'BV',
  'NV',
  'SA',
  'SAS',
  'SRL',
  'Oy',
  'AB',
];

const ORG_RE = new RegExp(`\\b(?:${LEGAL_FORMS.join('|')})\\b`, 'i');
const INSTITUTION_RE =
  /\b(University|Universit[äa]t|Hochschule|Institute?|Institut|Foundation|Stiftung|Laboratory|Lab)\b/i;

function guessType(label: string): string {
  if (/^[A-Z]\w+\s+\d{4}$/.test(label)) return 'event';
  if (ORG_RE.test(label)) return 'org';
  if (INSTITUTION_RE.test(label)) return 'org';
  return 'concept';
}

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'this',
  'that',
  'from',
  'your',
  'are',
  'was',
  'were',
  'have',
  'has',
  'will',
  'can',
  'not',
  'but',
  'they',
  'their',
  'our',
  'all',
  'more',
  'what',
  'when',
  'where',
  'which',
  'who',
  'how',
  'why',
  'der',
  'die',
  'das',
  'und',
  'für',
  'mit',
  'nicht',
  'ein',
  'eine',
  'ist',
  'sind',
  'werden',
  'wird',
  'auf',
  'von',
  'im',
  'am',
  'an',
  'als',
  'wie',
  'nach',
  'über',
  'zum',
  'zur',
  'des',
  'dem',
  'den',
  'about',
  'into',
  'than',
  'then',
  'them',
  'there',
  'here',
  'also',
  'been',
  'being',
  'search',
  'results',
  'result',
  'page',
  'website',
  'home',
  'menu',
  'privacy',
  'imprint',
]);
