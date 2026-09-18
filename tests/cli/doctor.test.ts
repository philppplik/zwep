import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hasBlockingProblem, runDoctor } from '../../cli/doctor.mjs';

interface Check {
  name: string;
  status: 'ok' | 'warn' | 'fail' | 'skip';
  detail: string;
  fix?: string[];
  blocking?: boolean;
}

let dir: string;

function makeCheckout(root: string, { deps = true, env = true } = {}) {
  mkdirSync(join(root, 'services', 'api', 'src'), { recursive: true });
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'zwep' }));
  writeFileSync(join(root, 'services', 'api', 'src', 'server.ts'), '');
  writeFileSync(join(root, 'scripts', 'dev-runner.mjs'), '');
  if (deps) mkdirSync(join(root, 'node_modules'), { recursive: true });
  if (env) writeFileSync(join(root, '.env'), 'ZWEP_ADMIN_KEY=zwep_admin_dev_key\n');
  return root;
}

const byName = (checks: Check[], name: string) => checks.find((c) => c.name === name)!;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zwep-doc-'));
  process.env.ZWEP_STATE_DIR = join(dir, 'state');
  delete process.env.ZWEP_HOME;
  // Nothing is reachable by default, which is the state a new user is in.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }),
  );
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.ZWEP_HOME;
  delete process.env.MEILI_HOST;
  vi.unstubAllGlobals();
});

describe('runDoctor', () => {
  it('reports on every prerequisite, not just the broken ones', async () => {
    const checks = (await runDoctor()) as Check[];
    const names = checks.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'Node.js',
        'Zwep engine',
        '.env',
        'Docker',
        'Meilisearch',
        'Zwep API',
      ]),
    );
  });

  it('gives every non-ok check something to actually do', async () => {
    // A diagnosis without a next step is only half a diagnosis.
    const checks = (await runDoctor()) as Check[];
    for (const check of checks) {
      if (check.status === 'ok' || check.status === 'skip') continue;
      expect(check.fix, `${check.name} reports a problem but suggests nothing`).toBeTruthy();
      expect(check.fix!.join(' ').length).toBeGreaterThan(20);
    }
  });

  it('passes the Node check on a supported runtime', async () => {
    const checks = (await runDoctor()) as Check[];
    expect(byName(checks, 'Node.js').status).toBe('ok');
  });

  it('marks an unreachable Meilisearch as blocking', async () => {
    const meili = byName((await runDoctor()) as Check[], 'Meilisearch');
    expect(meili.status).toBe('fail');
    expect(meili.blocking).toBe(true);
  });

  it('offers a Docker-free route when Docker is absent', async () => {
    // The user who hit this had no Docker; telling them only to install Docker
    // would be describing one option as though it were the only one.
    const meili = byName((await runDoctor()) as Check[], 'Meilisearch');
    const advice = meili.fix!.join('\n');
    expect(advice).toMatch(/meilisearch/i);
    expect(advice.toLowerCase()).toContain('docker');
  });

  it('recognises a healthy Meilisearch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes('7700')
          ? new Response('{"status":"available"}')
          : Promise.reject(new Error('ECONNREFUSED')),
      ),
    );
    expect(byName((await runDoctor()) as Check[], 'Meilisearch').status).toBe('ok');
  });

  it('honours MEILI_HOST when reporting where it looked', async () => {
    process.env.MEILI_HOST = 'http://example.test:9999';
    const meili = byName((await runDoctor()) as Check[], 'Meilisearch');
    expect(meili.detail).toContain('example.test:9999');
  });

  it('treats a missing engine as a warning, not a failure', async () => {
    // Using a Zwep that someone else runs is a supported setup.
    const bare = join(dir, 'bare');
    mkdirSync(bare, { recursive: true });
    process.env.ZWEP_HOME = bare;
    const engine = byName((await runDoctor()) as Check[], 'Zwep engine');
    expect(engine.status).toBe('warn');
    expect(engine.fix!.join('\n')).toMatch(/ZWEP_API|git clone/);
  });

  it('treats missing dependencies as a blocking failure', async () => {
    process.env.ZWEP_HOME = makeCheckout(join(dir, 'repo'), { deps: false });
    const engine = byName((await runDoctor()) as Check[], 'Zwep engine');
    expect(engine.status).toBe('fail');
    expect(engine.blocking).toBe(true);
    expect(engine.fix!.join('\n')).toContain('npm install');
  });

  it('flags the development secrets without calling the setup broken', async () => {
    process.env.ZWEP_HOME = makeCheckout(join(dir, 'repo2'));
    const env = byName((await runDoctor()) as Check[], '.env');
    expect(env.status).toBe('warn');
    expect(env.fix!.join('\n')).toMatch(/SECURITY\.md/);
  });

  it('suggests copying .env.example when the file is missing', async () => {
    process.env.ZWEP_HOME = makeCheckout(join(dir, 'repo3'), { env: false });
    const env = byName((await runDoctor()) as Check[], '.env');
    expect(env.status).toBe('warn');
    expect(env.fix!.join('\n')).toMatch(/\.env\.example/);
  });
});

describe('hasBlockingProblem', () => {
  it('is true only for a blocking failure', () => {
    expect(hasBlockingProblem([{ name: 'x', status: 'fail', detail: '', blocking: true }])).toBe(
      true,
    );
    expect(hasBlockingProblem([{ name: 'x', status: 'fail', detail: '' }])).toBe(false);
    expect(hasBlockingProblem([{ name: 'x', status: 'warn', detail: '', blocking: true }])).toBe(
      false,
    );
    expect(hasBlockingProblem([])).toBe(false);
  });
});
