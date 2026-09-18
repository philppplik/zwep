import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  deleteSource,
  enabledSourceNames,
  envSchema,
  getSource,
  loadSources,
  reloadEnv,
  saveSources,
  sourceSchema,
  sourcesStorePath,
  upsertSource,
} from '@zwep/config';
import type { SourceConfig } from '@zwep/shared';

function isolate(): void {
  process.env.ZWEP_DATA_DIR = mkdtempSync(join(tmpdir(), 'zwep-cfg-'));
  reloadEnv();
}

const WEB_SOURCE: SourceConfig = {
  name: 'example',
  type: 'web',
  seeds: ['https://example.com/'],
  allowedDomains: ['example.com'],
  maxPages: 10,
};

describe('envSchema', () => {
  it('coerces string booleans from the environment', () => {
    // Regression guard: `GOOGLE_PROXY_ENABLED` was a `z.boolean()`, so setting
    // it to "true" — exactly what the API's error message told you to do —
    // threw a ZodError and killed the process at boot.
    for (const truthy of ['true', '1', 'yes', 'on', 'TRUE']) {
      expect(envSchema.parse({ GOOGLE_PROXY_ENABLED: truthy }).GOOGLE_PROXY_ENABLED).toBe(true);
    }
    for (const falsy of ['false', '0', 'no', '', 'off']) {
      expect(envSchema.parse({ GOOGLE_PROXY_ENABLED: falsy }).GOOGLE_PROXY_ENABLED).toBe(false);
    }
  });

  it('defaults to a loopback bind address rather than every interface', () => {
    expect(envSchema.parse({}).API_HOST).toBe('127.0.0.1');
  });

  it('coerces numeric settings', () => {
    const env = envSchema.parse({ API_PORT: '9000', CRAWLER_CONCURRENCY: '8' });
    expect(env.API_PORT).toBe(9000);
    expect(env.CRAWLER_CONCURRENCY).toBe(8);
  });

  it('rejects an out-of-range port instead of silently binding the wrong one', () => {
    expect(() => envSchema.parse({ API_PORT: '99999' })).toThrow();
  });
});

describe('sourceSchema', () => {
  it('keeps the enabled flag', () => {
    // Regression guard: `enabled` was missing from the schema, and Zod strips
    // unknown keys — every activate/deactivate toggle was silently discarded.
    expect(sourceSchema.parse({ ...WEB_SOURCE, enabled: false }).enabled).toBe(false);
    expect(sourceSchema.parse({ ...WEB_SOURCE, enabled: true }).enabled).toBe(true);
  });

  it('defaults the type to web', () => {
    expect(sourceSchema.parse({ name: 'x', seeds: [], allowedDomains: [] }).type).toBe('web');
  });

  it('rejects a name that would break the document id', () => {
    expect(() =>
      sourceSchema.parse({ name: 'has spaces', seeds: [], allowedDomains: [] }),
    ).toThrow();
    expect(() => sourceSchema.parse({ name: '', seeds: [], allowedDomains: [] })).toThrow();
  });

  it('rejects a malformed seed URL', () => {
    expect(() =>
      sourceSchema.parse({ name: 'x', seeds: ['not-a-url'], allowedDomains: [] }),
    ).toThrow();
  });
});

describe('source store', () => {
  beforeEach(isolate);

  it('round-trips a source through disk', () => {
    upsertSource(WEB_SOURCE);
    expect(getSource('example')).toMatchObject({ name: 'example', maxPages: 10 });
  });

  it('merges an update instead of replacing the record wholesale', () => {
    upsertSource({ ...WEB_SOURCE, enabled: true, label: 'Example site' });
    upsertSource({ ...WEB_SOURCE, enabled: false });
    const s = getSource('example')!;
    expect(s.enabled).toBe(false);
    expect(s.label).toBe('Example site');
  });

  it('reports only enabled sources as searchable', () => {
    saveSources([
      { ...WEB_SOURCE, name: 'on' },
      { ...WEB_SOURCE, name: 'off', enabled: false },
      { ...WEB_SOURCE, name: 'implicit' },
    ]);
    expect(enabledSourceNames().sort()).toEqual(['implicit', 'on']);
  });

  it('deletes a source and reports whether anything was removed', () => {
    upsertSource(WEB_SOURCE);
    expect(deleteSource('example')).toBe(true);
    expect(deleteSource('example')).toBe(false);
    expect(getSource('example')).toBeUndefined();
  });

  it('falls back to the YAML seed when the store is corrupt', () => {
    saveSources([WEB_SOURCE]);
    // Simulate a half-written file.
    writeFileSync(sourcesStorePath(), '{ broken', 'utf8');
    expect(() => loadSources()).not.toThrow();
    expect(Array.isArray(loadSources())).toBe(true);
  });
});
