/**
 * Update checking.
 *
 * Zwep's whole premise is that your searches stay on your machine, so an update
 * check — the one outbound request the CLI makes on its own — is deliberately
 * constrained:
 *
 *   - it asks only registry.npmjs.org, and only for a version number;
 *   - it runs at most once a day, cached on disk;
 *   - `ZWEP_NO_UPDATE_CHECK=1` turns it off entirely;
 *   - it never blocks a command — a slow or failed check is silently ignored.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { stateDir } from './local.mjs';

const REGISTRY = process.env.ZWEP_REGISTRY ?? 'https://registry.npmjs.org';
const CACHE_FILE = () => join(stateDir(), 'update-check.json');
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;

/** Compare two semver-ish strings. Returns true when `candidate` is newer. */
export function isNewer(candidate, current) {
  const parse = (v) =>
    String(v)
      .replace(/^v/, '')
      .split('-')[0]
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0);
  const a = parse(candidate);
  const b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  // Equal releases: a pre-release is older than the final it precedes.
  const preA = String(candidate).includes('-');
  const preB = String(current).includes('-');
  return preB && !preA;
}

/** Ask the registry for the latest published version. */
export async function fetchLatest(pkg = 'zwep', timeoutMs = 5000) {
  const res = await fetch(`${REGISTRY}/${pkg}/latest`, {
    headers: { accept: 'application/vnd.npm.install-v1+json, application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`registry returned ${res.status}`);
  const data = await res.json();
  if (!data?.version) throw new Error('registry returned no version');
  return { version: data.version, name: data.name ?? pkg };
}

function readCache() {
  try {
    return JSON.parse(readFileSync(CACHE_FILE(), 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(value) {
  try {
    writeFileSync(CACHE_FILE(), JSON.stringify(value, null, 2));
  } catch {
    /* the cache is an optimisation, never a requirement */
  }
}

export function updateCheckDisabled() {
  const v = process.env.ZWEP_NO_UPDATE_CHECK;
  return v === '1' || v === 'true' || process.env.NO_UPDATE_NOTIFIER === '1';
}

/**
 * Check for a newer release.
 *
 * @param {object} opts
 * @param {string} opts.current   The running version.
 * @param {boolean} [opts.force]  Ignore the cache and the daily interval.
 */
export async function checkForUpdate({ current, force = false }) {
  if (updateCheckDisabled() && !force) {
    return { checked: false, reason: 'disabled', current };
  }

  const cache = readCache();
  const fresh = cache && Date.now() - cache.checkedAt < CHECK_EVERY_MS;
  if (fresh && !force) {
    return {
      checked: true,
      cached: true,
      current,
      latest: cache.latest,
      updateAvailable: isNewer(cache.latest, current),
    };
  }

  try {
    const { version } = await fetchLatest();
    writeCache({ latest: version, checkedAt: Date.now() });
    return {
      checked: true,
      cached: false,
      current,
      latest: version,
      updateAvailable: isNewer(version, current),
    };
  } catch (e) {
    return { checked: false, reason: e.message, current };
  }
}

/**
 * The command that installs the update.
 *
 * How zwep was installed decides how it is updated, and guessing wrong sends
 * people down a path that cannot work — so this reports what it can actually
 * tell from the running binary's path.
 */
export function updateCommand(execPath = process.argv[1] ?? '') {
  const p = execPath.replace(/\\/g, '/');

  // npx runs from a throwaway cache, so there is nothing to update — asking for
  // @latest next time is the whole fix.
  if (p.includes('/_npx/')) return { how: 'npx', command: 'npx zwep@latest' };

  // A global install also lives under node_modules, so it has to be recognised
  // first: `/lib/node_modules/` is the Unix global prefix, `/npm/node_modules/`
  // the Windows one (AppData\Roaming\npm). Checking for node_modules alone
  // would classify every global install as project-local.
  if (/\/(lib|npm)\/node_modules\//.test(p)) {
    return { how: 'global', command: 'npm install -g zwep@latest' };
  }
  if (p.includes('/node_modules/')) {
    return { how: 'local', command: 'npm install zwep@latest' };
  }

  // Running from a git checkout — npm is not how this copy got here.
  return { how: 'source', command: 'git pull && npm install' };
}
