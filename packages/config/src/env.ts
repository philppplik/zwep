import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Load the repository `.env` file into `process.env` once, before any schema
 * parsing happens.
 *
 * Node >= 20.12 ships `process.loadEnvFile()`, so this needs no dependency and
 * behaves identically on Windows, Linux and macOS. Values already present in
 * the real environment win — `.env` only fills gaps, which is what CI and
 * container deployments expect.
 */

const here = dirname(fileURLToPath(import.meta.url));

/** Repository root, derived from this file's location (packages/config/src). */
export const REPO_ROOT = resolve(here, '../../..');

let loaded = false;

export function loadDotEnv(file = resolve(REPO_ROOT, '.env')): void {
  if (loaded) return;
  loaded = true;
  if (!existsSync(file)) return;
  const before = { ...process.env };
  try {
    // Available since Node 20.12 / 21.7.
    (process as unknown as { loadEnvFile?: (p: string) => void }).loadEnvFile?.(file);
  } catch {
    // A malformed .env should never stop the process from booting.
    return;
  }
  // `loadEnvFile` overwrites; restore anything that was explicitly set already.
  for (const [k, v] of Object.entries(before)) {
    if (v !== undefined) process.env[k] = v;
  }
}

/** Test helper: allow a second `loadDotEnv()` call to take effect. */
export function resetDotEnv(): void {
  loaded = false;
}
