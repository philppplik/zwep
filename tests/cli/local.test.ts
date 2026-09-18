import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  findZwepHome,
  isApiUp,
  isZwepCheckout,
  rememberHome,
  stateDir,
  waitForApi,
} from '../../cli/local.mjs';

let dir: string;

/** Build a directory that looks like a real Zwep checkout. */
function makeCheckout(root: string, name = 'zwep') {
  mkdirSync(join(root, 'services', 'api', 'src'), { recursive: true });
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name }));
  writeFileSync(join(root, 'services', 'api', 'src', 'server.ts'), '');
  writeFileSync(join(root, 'scripts', 'dev-runner.mjs'), '');
  return root;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zwep-local-'));
  process.env.ZWEP_STATE_DIR = join(dir, 'state');
  delete process.env.ZWEP_HOME;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.ZWEP_HOME;
  vi.unstubAllGlobals();
});

describe('isZwepCheckout', () => {
  it('recognises a real checkout', () => {
    expect(isZwepCheckout(makeCheckout(join(dir, 'repo')))).toBe(true);
  });

  it('rejects a directory that merely has a package.json', () => {
    mkdirSync(join(dir, 'other'), { recursive: true });
    writeFileSync(join(dir, 'other', 'package.json'), JSON.stringify({ name: 'zwep' }));
    expect(isZwepCheckout(join(dir, 'other'))).toBe(false);
  });

  it('rejects a different package that happens to have the right layout', () => {
    expect(isZwepCheckout(makeCheckout(join(dir, 'imposter'), 'not-zwep'))).toBe(false);
  });

  it('rejects a path that does not exist', () => {
    expect(isZwepCheckout(join(dir, 'nope'))).toBe(false);
  });
});

describe('findZwepHome', () => {
  it('finds a checkout in the current directory', () => {
    const home = makeCheckout(join(dir, 'repo'));
    expect(findZwepHome(home)).toBe(home);
  });

  it('walks up to find an ancestor checkout', () => {
    const home = makeCheckout(join(dir, 'repo'));
    const deep = join(home, 'services', 'api', 'src');
    expect(findZwepHome(deep)).toBe(home);
  });

  it('prefers ZWEP_HOME over the walk', () => {
    const explicit = makeCheckout(join(dir, 'explicit'));
    const nearby = makeCheckout(join(dir, 'nearby'));
    process.env.ZWEP_HOME = explicit;
    expect(findZwepHome(nearby)).toBe(explicit);
  });

  it('returns null when ZWEP_HOME points somewhere invalid', () => {
    // Better to say "not found" than to silently start something else.
    process.env.ZWEP_HOME = join(dir, 'does-not-exist');
    expect(findZwepHome(makeCheckout(join(dir, 'nearby')))).toBeNull();
  });

  it('falls back to the remembered checkout', () => {
    const home = makeCheckout(join(dir, 'repo'));
    rememberHome(home);
    const unrelated = join(dir, 'unrelated');
    mkdirSync(unrelated, { recursive: true });
    expect(findZwepHome(unrelated)).toBe(home);
  });

  it('ignores a remembered checkout that has since been deleted', () => {
    const home = makeCheckout(join(dir, 'gone'));
    rememberHome(home);
    rmSync(home, { recursive: true, force: true });
    const unrelated = join(dir, 'unrelated2');
    mkdirSync(unrelated, { recursive: true });
    expect(findZwepHome(unrelated)).toBeNull();
  });

  it('returns null when only the npm client is installed', () => {
    const bare = join(dir, 'bare');
    mkdirSync(bare, { recursive: true });
    expect(findZwepHome(bare)).toBeNull();
  });
});

describe('stateDir', () => {
  it('honours ZWEP_STATE_DIR and creates it', () => {
    expect(stateDir()).toBe(join(dir, 'state'));
  });
});

describe('isApiUp', () => {
  it('is true for a healthy API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"ok":true}')),
    );
    expect(await isApiUp('http://127.0.0.1:8080')).toBe(true);
  });

  it('is false when the API answers with an error status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    );
    expect(await isApiUp('http://127.0.0.1:8080')).toBe(false);
  });

  it('is false — not a throw — when nothing is listening', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    expect(await isApiUp('http://127.0.0.1:8080')).toBe(false);
  });

  it('tolerates a trailing slash on the base URL', async () => {
    const spy = vi.fn(async (_url: string) => new Response('{}'));
    vi.stubGlobal('fetch', spy);
    await isApiUp('http://127.0.0.1:8080/');
    expect(spy.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8080/healthz');
  });
});

describe('waitForApi', () => {
  it('returns true as soon as the API answers', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (++calls < 3) throw new Error('not yet');
        return new Response('{}');
      }),
    );
    expect(await waitForApi('http://127.0.0.1:8080', { timeoutMs: 5000 })).toBe(true);
  });

  it('gives up after the timeout instead of hanging', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('never');
      }),
    );
    expect(await waitForApi('http://127.0.0.1:8080', { timeoutMs: 1200 })).toBe(false);
  });
});
