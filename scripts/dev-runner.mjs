#!/usr/bin/env node
/**
 * Cross-platform dev runner: starts the Zwep API (:8080) and the Vite UI
 * (:5173) together, waits for the API to answer, and forwards Ctrl-C to both.
 *
 * Replaces the old shell/batch pair. `new URL('..', import.meta.url).pathname`
 * yielded `/C:/Users/...` on Windows — an invalid cwd — which is why the
 * runner only ever worked on POSIX. Everything here goes through
 * `fileURLToPath`, so Windows, Linux and macOS behave identically.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API_PORT = Number(process.env.API_PORT ?? 8080);
const WEB_PORT = Number(process.env.WEB_PORT ?? 5173);
const isWindows = process.platform === 'win32';

/** `npm` is `npm.cmd` on Windows; spawning the bare name fails with ENOENT. */
const npm = isWindows ? 'npm.cmd' : 'npm';

const children = [];

function run(label, command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
    // `shell: true` is only needed on Windows to resolve .cmd shims; avoiding
    // it elsewhere keeps signal handling (and therefore Ctrl-C) intact.
    shell: isWindows,
  });
  child.on('error', (e) => {
    console.error(`[${label}] failed to start: ${e.message}`);
    shutdown(1);
  });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(`[${label}] exited (${signal ?? code}) — stopping the other process too.`);
    shutdown(code ?? 1);
  });
  children.push({ label, child });
  return child;
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n→ shutting down Zwep dev…');
  for (const { child } of children) {
    if (child.exitCode !== null) continue;
    // On Windows there are no POSIX signals; taskkill takes down the whole tree.
    if (isWindows && child.pid) {
      spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  }
  setTimeout(() => process.exit(code), 400).unref();
}

async function waitForApi(timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !shuttingDown) {
    try {
      const res = await fetch(`http://127.0.0.1:${API_PORT}/healthz`, {
        signal: AbortSignal.timeout(1500),
      });
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

console.log('→ Zwep dev');
console.log(`  API  http://127.0.0.1:${API_PORT}`);
console.log(`  Web  http://127.0.0.1:${WEB_PORT}`);
console.log('  Ctrl-C to stop both.\n');

run('api', process.execPath, ['--experimental-strip-types', 'services/api/src/server.ts'], ROOT);
run('web', npm, ['run', 'dev'], resolve(ROOT, 'web'));

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

if (await waitForApi()) {
  console.log(`\n✓ API ready on http://127.0.0.1:${API_PORT} — open http://127.0.0.1:${WEB_PORT}\n`);
} else if (!shuttingDown) {
  console.warn(
    `\n! API did not answer on :${API_PORT} within 45s.\n` +
      '  The web UI proxies /v1/* to it, so search will return 500 until it is up.\n' +
      '  Check that Meilisearch is running: npm run infra:up\n',
  );
}
