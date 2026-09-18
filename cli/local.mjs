/**
 * Finding and running a local Zwep installation.
 *
 * The npm package is only the client — the engine lives in a git checkout. This
 * module bridges the two: it locates a checkout, starts the stack in the
 * background, and waits until the API actually answers.
 *
 * The point is that `zwep search foo` should just work. Being told "cannot
 * reach the API, is it running?" when the answer is one command away is a
 * failure of the tool, not of the user.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';

const isWindows = process.platform === 'win32';

/** `npm` is `npm.cmd` on Windows; spawning the bare name fails with ENOENT. */
export const NPM = isWindows ? 'npm.cmd' : 'npm';

/** Where the CLI remembers state between runs (found checkout, pids, cache). */
export function stateDir() {
  const base =
    process.env.ZWEP_STATE_DIR ||
    (isWindows
      ? join(process.env.LOCALAPPDATA || homedir(), 'zwep')
      : join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'zwep'));
  mkdirSync(base, { recursive: true });
  return base;
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(value, null, 2));
  } catch {
    /* state is a convenience; never fail a command over it */
  }
}

// ---------------------------------------------------------------------------
// Locating a checkout
// ---------------------------------------------------------------------------

const HOME_FILE = () => join(stateDir(), 'home.json');

/** Does this directory look like a Zwep checkout we can start? */
export function isZwepCheckout(dir) {
  try {
    const pkg = readJson(join(dir, 'package.json'));
    return (
      pkg?.name === 'zwep' &&
      existsSync(join(dir, 'services', 'api', 'src', 'server.ts')) &&
      existsSync(join(dir, 'scripts', 'dev-runner.mjs'))
    );
  } catch {
    return false;
  }
}

/**
 * Find the Zwep engine on this machine, in order of explicitness:
 *   1. `ZWEP_HOME`
 *   2. the current directory or any ancestor
 *   3. the checkout we successfully started last time
 *
 * Returns null when only the npm client is installed, which is a normal state —
 * the CLI is then talking to a Zwep somewhere else.
 */
export function findZwepHome(startDir = process.cwd()) {
  if (process.env.ZWEP_HOME) {
    const dir = resolve(process.env.ZWEP_HOME);
    return isZwepCheckout(dir) ? dir : null;
  }

  let dir = resolve(startDir);
  for (;;) {
    if (isZwepCheckout(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const remembered = readJson(HOME_FILE())?.home;
  if (remembered && isZwepCheckout(remembered)) return remembered;

  return null;
}

export function rememberHome(home) {
  writeJson(HOME_FILE(), { home, savedAt: new Date().toISOString() });
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export async function isApiUp(base, timeoutMs = 1500) {
  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/healthz`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function waitForApi(base, { timeoutMs = 60_000, onTick } = {}) {
  const deadline = Date.now() + timeoutMs;
  let waited = 0;
  while (Date.now() < deadline) {
    if (await isApiUp(base)) return true;
    await new Promise((r) => setTimeout(r, 500));
    waited += 500;
    onTick?.(waited);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Starting and stopping
// ---------------------------------------------------------------------------

const PID_FILE = () => join(stateDir(), 'server.json');
export const LOG_FILE = () => join(stateDir(), 'server.log');

function hasDocker() {
  try {
    const r = spawnSync(isWindows ? 'docker.exe' : 'docker', ['--version'], {
      stdio: 'ignore',
      timeout: 5000,
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

/**
 * Bring up Meilisearch, which the API needs to answer anything.
 * Best-effort: a missing or stopped Docker is reported, not thrown, because the
 * user may be running Meilisearch some other way.
 */
export function startInfra(home) {
  if (!hasDocker()) return { ok: false, reason: 'docker-not-found' };
  const r = spawnSync(isWindows ? 'docker.exe' : 'docker', ['compose', 'up', '-d', 'meilisearch'], {
    cwd: home,
    stdio: 'ignore',
    timeout: 120_000,
  });
  return r.status === 0 ? { ok: true } : { ok: false, reason: 'compose-failed' };
}

/**
 * Start the API (and optionally the web UI) detached, so it outlives this CLI
 * process. Output goes to a log file — a background process writing to the
 * user's terminal would corrupt the output of whatever command started it.
 */
export function startServer(home, { web = false } = {}) {
  const out = openSync(LOG_FILE(), 'a');

  const [cmd, args] = web
    ? [process.execPath, [join(home, 'scripts', 'dev-runner.mjs')]]
    : [
        process.execPath,
        ['--experimental-strip-types', join(home, 'services', 'api', 'src', 'server.ts')],
      ];

  const child = spawn(cmd, args, {
    cwd: home,
    detached: true,
    stdio: ['ignore', out, out],
    env: { ...process.env },
    windowsHide: true,
  });
  child.unref();

  writeJson(PID_FILE(), {
    pid: child.pid,
    home,
    web,
    startedAt: new Date().toISOString(),
  });
  return child.pid;
}

/** The server this CLI started, if it is still running. */
export function trackedServer() {
  const state = readJson(PID_FILE());
  if (!state?.pid) return null;
  return isRunning(state.pid) ? state : null;
}

export function isRunning(pid) {
  try {
    // Signal 0 tests for existence without delivering anything.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Stop the server this CLI started. Returns what was stopped, or null. */
export function stopServer() {
  const state = readJson(PID_FILE());
  if (!state?.pid) return null;
  if (!isRunning(state.pid)) {
    rmSync(PID_FILE(), { force: true });
    return null;
  }
  try {
    if (isWindows) {
      // Windows has no POSIX signals; taskkill takes down the whole tree, which
      // matters because the dev runner spawns Vite as a child.
      spawnSync('taskkill', ['/pid', String(state.pid), '/f', '/t'], { stdio: 'ignore' });
    } else {
      process.kill(state.pid, 'SIGTERM');
    }
  } catch {
    /* already gone */
  }
  rmSync(PID_FILE(), { force: true });
  return state;
}

export function tailLog(lines = 20) {
  try {
    return readFileSync(LOG_FILE(), 'utf8').trimEnd().split('\n').slice(-lines).join('\n');
  } catch {
    return '';
  }
}

/** Where a temporary crawl or test can write without touching the real data. */
export function scratchDir() {
  return join(tmpdir(), 'zwep-scratch');
}
