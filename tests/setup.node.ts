/**
 * Node test setup.
 *
 * Every suite runs against an isolated data directory so that tests never read
 * or write the developer's real `data/sources.json` and `data/*.db`.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll } from 'vitest';

const dir = mkdtempSync(join(tmpdir(), 'zwep-test-'));

beforeAll(() => {
  process.env.ZWEP_DATA_DIR = dir;
  process.env.GRAPH_DB = join(dir, 'graph.db');
  process.env.LLM_PROVIDER = 'none';
  process.env.EMBED_PROVIDER = 'none';
  process.env.API_RATE_LIMIT = '0';
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});
