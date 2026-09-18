import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KnowledgeGraph, MAX_ENTITIES_PER_DOC } from '@zwep/graph';

const open = () => {
  const dir = mkdtempSync(join(tmpdir(), 'zwep-graph-'));
  const g = new KnowledgeGraph(join(dir, 'graph.db'));
  cleanups.push(() => {
    g.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return g;
};

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

describe('extractEntities', () => {
  it('finds capitalised proper nouns', () => {
    const ents = KnowledgeGraph.extractEntities('Angela Merkel met Olaf Scholz in Berlin.');
    const labels = ents.map((e) => e.label);
    expect(labels).toContain('Angela Merkel');
    expect(labels).toContain('Berlin');
  });

  it('skips stopwords that happen to start a sentence', () => {
    const labels = KnowledgeGraph.extractEntities('Der Bericht. Die Analyse.').map((e) => e.label);
    expect(labels).not.toContain('Der');
    expect(labels).not.toContain('Die');
  });

  it('caps how many entities one document contributes', () => {
    // Regression guard: a glossary page produced thousands of entities and a
    // quadratic number of co-mention edges, ballooning the database.
    const text = Array.from(
      { length: 400 },
      (_, i) => `Entityname${String.fromCharCode(97 + (i % 26))}${i}x`,
    )
      .map((w) => `${w.charAt(0).toUpperCase()}${w.slice(1)}`)
      .join(' und ');
    expect(KnowledgeGraph.extractEntities(text).length).toBeLessThanOrEqual(MAX_ENTITIES_PER_DOC);
  });

  it('classifies organisations', () => {
    const ents = KnowledgeGraph.extractEntities('Acme GmbH announced results.');
    expect(ents.find((e) => e.label.includes('Acme'))?.type).toBe('org');
  });
});

describe('indexDoc', () => {
  it('stores entities and finds them again by substring', () => {
    const g = open();
    g.indexDoc('d1', KnowledgeGraph.extractEntities('Angela Merkel visited Berlin today.'));
    const n = g.neighborhood('berlin');
    expect(n.nodes.some((x) => x.label.includes('berlin'))).toBe(true);
  });

  it('merges name variants through the alias map', () => {
    const g = open();
    g.indexDoc('d1', [{ label: 'Angela Merkel', type: 'concept' }]);
    g.indexDoc('d2', [{ label: 'Mutti Merkel', type: 'concept' }]);
    expect(g.stats().entities).toBe(1);
  });

  it('strengthens one edge rather than creating a mirrored pair', () => {
    // Regression guard: edges were stored in whatever order the entities
    // happened to appear, so (a,b) and (b,a) accumulated as two rows.
    const g = open();
    g.indexDoc('d1', [
      { label: 'Alpha', type: 'concept' },
      { label: 'Beta', type: 'concept' },
    ]);
    g.indexDoc('d2', [
      { label: 'Beta', type: 'concept' },
      { label: 'Alpha', type: 'concept' },
    ]);
    const all = g.all();
    expect(all.edges).toHaveLength(1);
    expect(all.edges[0].weight).toBe(2);
  });

  it('counts a repeated mention once per document', () => {
    const g = open();
    g.indexDoc('d1', [
      { label: 'Alpha', type: 'concept' },
      { label: 'Alpha', type: 'concept' },
    ]);
    expect(g.all().nodes[0].doc_count).toBe(1);
  });

  it('is a no-op for an empty entity list', () => {
    const g = open();
    g.indexDoc('d1', []);
    expect(g.stats()).toEqual({ entities: 0, edges: 0 });
  });
});

describe('neighborhood', () => {
  it('returns nothing for an unknown term instead of throwing', () => {
    const g = open();
    expect(g.neighborhood('nothing-here')).toEqual({ nodes: [], edges: [] });
  });

  it('includes one-hop neighbours of a seed entity', () => {
    const g = open();
    g.indexDoc('d1', [
      { label: 'Solarpark', type: 'concept' },
      { label: 'Netzausbau', type: 'concept' },
    ]);
    const n = g.neighborhood('solarpark');
    expect(n.nodes.map((x) => x.label)).toContain('netzausbau');
    expect(n.edges).toHaveLength(1);
  });
});

describe('all', () => {
  it('exports nodes, edges and stats together', () => {
    const g = open();
    g.indexDoc('d1', [
      { label: 'Alpha', type: 'concept' },
      { label: 'Beta', type: 'org' },
    ]);
    const dump = g.all();
    expect(dump.stats).toEqual({ entities: 2, edges: 1 });
    expect(dump.nodes).toHaveLength(2);
  });
});
