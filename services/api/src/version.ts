import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT, oneLine } from '@zwep/config';

/**
 * Version reporting and update checking.
 *
 * The check runs here rather than in the browser on purpose. Zwep's promise is
 * that using it does not tell anyone what you are doing, and a request from the
 * page would carry the referrer — and be attributable to the person searching
 * rather than to the server. One server-side request, cached, keeps that
 * promise while still telling you when a release is out.
 */

const REGISTRY = process.env.ZWEP_REGISTRY ?? 'https://registry.npmjs.org';
/** How long a registry answer stays good enough to reuse. */
const CACHE_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 5000;

let cached: { latest: string; at: number } | null = null;

/** The running version, read once from the repository's package.json. */
export const VERSION: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

/** Compare two semver-ish strings; true when `candidate` is newer. */
export function isNewer(candidate: string, current: string): boolean {
  const parse = (v: string) =>
    v
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
  return current.includes('-') && !candidate.includes('-');
}

export interface UpdateStatus {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  checkedAt: string | null;
  cached: boolean;
  error?: string;
}

/**
 * Ask npm whether a newer release exists.
 *
 * Failure is a normal outcome — an air-gapped Zwep is a supported way to run
 * this — so it is reported in the payload rather than thrown.
 */
export async function checkForUpdate(force = false): Promise<UpdateStatus> {
  if (!force && cached && Date.now() - cached.at < CACHE_MS) {
    return {
      current: VERSION,
      latest: cached.latest,
      updateAvailable: isNewer(cached.latest, VERSION),
      checkedAt: new Date(cached.at).toISOString(),
      cached: true,
    };
  }

  try {
    const res = await fetch(`${REGISTRY}/zwep/latest`, {
      headers: { accept: 'application/vnd.npm.install-v1+json, application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`registry returned ${res.status}`);
    const data = (await res.json()) as { version?: string };
    if (!data.version) throw new Error('registry returned no version');

    cached = { latest: data.version, at: Date.now() };
    return {
      current: VERSION,
      latest: data.version,
      updateAvailable: isNewer(data.version, VERSION),
      checkedAt: new Date(cached.at).toISOString(),
      cached: false,
    };
  } catch (e) {
    return {
      current: VERSION,
      latest: null,
      updateAvailable: false,
      checkedAt: null,
      cached: false,
      error: oneLine((e as Error).message, 200),
    };
  }
}

/** Test seam: forget the cached registry answer. */
export function resetUpdateCache(): void {
  cached = null;
}
