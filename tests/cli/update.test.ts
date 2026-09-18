import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkForUpdate,
  isNewer,
  isValidVersion,
  updateCheckDisabled,
  updateCommand,
} from '../../cli/update.mjs';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zwep-upd-'));
  process.env.ZWEP_STATE_DIR = dir;
  delete process.env.ZWEP_NO_UPDATE_CHECK;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('isNewer', () => {
  it.each([
    ['0.3.0', '0.2.0', true],
    ['0.2.1', '0.2.0', true],
    ['1.0.0', '0.9.9', true],
    ['0.2.0', '0.2.0', false],
    ['0.1.9', '0.2.0', false],
  ])('%s vs %s → %s', (candidate, current, expected) => {
    expect(isNewer(candidate as string, current as string)).toBe(expected);
  });

  it('compares numerically, not lexically', () => {
    // "10" sorts before "9" as a string; this is the classic version-compare bug.
    expect(isNewer('0.10.0', '0.9.0')).toBe(true);
    expect(isNewer('0.9.0', '0.10.0')).toBe(false);
  });

  it('treats a pre-release as older than its final release', () => {
    expect(isNewer('1.0.0', '1.0.0-rc.1')).toBe(true);
    expect(isNewer('1.0.0-rc.1', '1.0.0')).toBe(false);
  });

  it('tolerates a leading v and missing segments', () => {
    expect(isNewer('v1.1', '1.0.0')).toBe(true);
    expect(isNewer('1', '1.0.0')).toBe(false);
  });
});

describe('updateCommand', () => {
  it('detects a global install', () => {
    expect(updateCommand('/usr/local/lib/node_modules/zwep/bin/zwep.mjs')).toMatchObject({
      how: 'global',
      command: 'npm install -g zwep@latest',
    });
  });

  it('detects npx, which needs no install at all', () => {
    expect(updateCommand('/home/u/.npm/_npx/abc123/node_modules/zwep/bin/zwep.mjs')).toMatchObject({
      how: 'npx',
    });
  });

  it('detects a project-local install', () => {
    expect(updateCommand('/srv/app/node_modules/zwep/bin/zwep.mjs')).toMatchObject({
      how: 'local',
      command: 'npm install zwep@latest',
    });
  });

  it('recognises the Windows global prefix despite the separators', () => {
    // AppData\Roaming\npm\node_modules is a *global* install, not a local one —
    // checking for node_modules alone misclassified every global install.
    expect(
      updateCommand('C:\\Users\\x\\AppData\\Roaming\\npm\\node_modules\\zwep\\bin\\zwep.mjs'),
    ).toMatchObject({ how: 'global' });
  });

  it('reports a git checkout as source, where npm cannot help', () => {
    expect(updateCommand('/home/u/code/zwep/bin/zwep.mjs')).toMatchObject({
      how: 'source',
      command: 'git pull && npm install',
    });
  });
});

describe('updateCheckDisabled', () => {
  it('honours the opt-out', () => {
    process.env.ZWEP_NO_UPDATE_CHECK = '1';
    expect(updateCheckDisabled()).toBe(true);
  });

  it('is off by default', () => {
    expect(updateCheckDisabled()).toBe(false);
  });
});

describe('checkForUpdate', () => {
  const mockRegistry = (version: string) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ name: 'zwep', version }))),
    );

  it('reports an available update', async () => {
    mockRegistry('0.9.0');
    const r = await checkForUpdate({ current: '0.2.0' });
    expect(r).toMatchObject({ checked: true, latest: '0.9.0', updateAvailable: true });
  });

  it('reports no update when current', async () => {
    mockRegistry('0.2.0');
    expect(await checkForUpdate({ current: '0.2.0' })).toMatchObject({ updateAvailable: false });
  });

  it('caches, so a second call makes no request', async () => {
    mockRegistry('0.9.0');
    await checkForUpdate({ current: '0.2.0' });
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    const second = await checkForUpdate({ current: '0.2.0' });
    expect(second.cached).toBe(true);
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(
      calls,
    );
  });

  it('--force bypasses the cache', async () => {
    mockRegistry('0.9.0');
    await checkForUpdate({ current: '0.2.0' });
    const r = await checkForUpdate({ current: '0.2.0', force: true });
    expect(r.cached).toBe(false);
  });

  it('skips the network entirely when opted out', async () => {
    process.env.ZWEP_NO_UPDATE_CHECK = '1';
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const r = await checkForUpdate({ current: '0.2.0' });
    expect(r).toMatchObject({ checked: false, reason: 'disabled' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('degrades quietly when the registry is unreachable', async () => {
    // An update check must never turn into a failed command.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ENOTFOUND');
      }),
    );
    const r = await checkForUpdate({ current: '0.2.0' });
    expect(r.checked).toBe(false);
    expect(r.current).toBe('0.2.0');
  });

  it('degrades quietly on a malformed registry response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}')),
    );
    expect((await checkForUpdate({ current: '0.2.0' })).checked).toBe(false);
  });
});

describe('isValidVersion — guards what reaches disk and the terminal', () => {
  it.each(['1.0.0', '0.2.0', '10.20.30', '1.0.0-rc.1', '1.0.0+build.5', '1.2'])(
    'accepts %s',
    (v) => {
      expect(isValidVersion(v)).toBe(true);
    },
  );

  it.each([
    '',
    'latest',
    '1.0.0; rm -rf /',
    '../../../etc/passwd',
    '1.0.0\n[llm] forged log line',
    '9'.repeat(100),
    null,
    undefined,
    { version: '1.0.0' },
  ])('rejects %s', (v) => {
    expect(isValidVersion(v as string)).toBe(false);
  });

  it('rejects a version carrying ANSI escapes', () => {
    // The version is printed to a terminal; escapes could rewrite the notice.
    expect(isValidVersion(`1.0.0${String.fromCharCode(27)}[31m`)).toBe(false);
  });
});

describe('checkForUpdate rejects a malformed registry version', () => {
  it('does not persist or report a version that fails validation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ version: 'not-a-version' }))),
    );
    const r = await checkForUpdate({ current: '0.2.0' });
    expect(r.checked).toBe(false);
    expect(r).not.toHaveProperty('latest');
  });
});
