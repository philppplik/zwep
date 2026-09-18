#!/usr/bin/env node
/**
 * Cross-platform dev runner: starts the Zwep API (:8080) and the Vite UI
 * (:5173) together, waits for the API to answer, and forwards Ctrl-C to both.
 *
 * Two Windows traps this file exists to avoid:
 *
 *   1. `new URL('..', import.meta.url).pathname` yields `/C:/Users/...`, which
 *      is not a valid cwd. Everything goes through `fileURLToPath`.
 *
 *   2. `spawn(cmd, args, { shell: true })` concatenates the command and its
 *      arguments into one string *without quoting them*. Node's default
 *      install path is `C:\Program Files\nodejs\node.exe`, so cmd.exe split it
 *      at the space and reported `'C:\Program' is not recognized`. Nothing here
 *      uses a shell: both children are launched as `node <script>`, which needs
 *      none and cannot be mis-split.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { c } from './tty.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = resolve(ROOT, 'web');
const API_PORT = Number(process.env.API_PORT ?? 8080);
const WEB_PORT = Number(process.env.WEB_PORT ?? 5173);
const isWindows = process.platform === 'win32';

const children = [];
let shuttingDown = false;

/**
 * Resolve Vite's own entry script.
 *
 * Running `npm run dev` in web/ would mean spawning `npm.cmd`, which needs a
 * shell on Windows and brings back the quoting problem above. Vite is plain
 * JavaScript, so `node <vite.js>` skips npm entirely.
 */
function resolveVite() {
  const candidates = [
    resolve(WEB, 'node_modules', 'vite', 'bin', 'vite.js'),
    resolve(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
  ];
  return candidates.find(existsSync) ?? null;
}

function run(label, args, cwd) {
  // No `shell` anywhere: `node` is an executable, not a shell builtin, so the
  // arguments arrive exactly as written even when a path contains a space.
  const child = spawn(process.execPath, args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });

  child.on('error', (e) => {
    console.error(`\n${c.red('✗')} [${label}] failed to start: ${e.message}`);
    shutdown(1);
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(
      `\n${c.red('✗')} [${label}] exited with ${signal ?? `code ${code}`} — stopping the other process too.`,
    );
    if (label === 'api') explainApiFailure();
    shutdown(code ?? 1);
  });

  children.push({ label, child });
  return child;
}

/**
 * When the API dies immediately, the reason is almost always one of a handful
 * of things. Naming them beats making the reader scroll back through a stack
 * trace they did not ask for.
 */
function explainApiFailure() {
  console.error(
    [
      '',
      c.bold('  Most likely causes:'),
      '',
      `  ${c.bold('1.')} Meilisearch is not running.`,
      `     The API starts without it, but every search returns 503.`,
      `     ${c.cyan('npm run infra:up')}   ${c.dim('(needs Docker)')}`,
      `     ${c.cyan('npx zwep doctor')}    ${c.dim('— checks this and tells you what to do')}`,
      '',
      `  ${c.bold('2.')} Port ${API_PORT} is already in use.`,
      `     ${c.cyan(`API_PORT=8081 npm run dev`)}`,
      '',
      `  ${c.bold('3.')} Dependencies are missing or half-installed.`,
      `     ${c.cyan('npm install')}`,
      '',
      `  Run ${c.cyan('npx zwep doctor')} for a full check of this machine.`,
      '',
    ].join('\n'),
  );
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${c.dim('→ shutting down Zwep dev…')}`);
  for (const { child } of children) {
    if (child.exitCode !== null) continue;
    if (isWindows && child.pid) {
      // Windows has no POSIX signals, and Vite spawns children of its own.
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

/** Is Meilisearch answering? Worth knowing before the user searches. */
async function isIndexUp() {
  const host = process.env.MEILI_HOST ?? 'http://127.0.0.1:7700';
  try {
    const res = await fetch(`${host.replace(/\/+$/, '')}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------

const vite = resolveVite();
if (!vite) {
  console.error(
    [
      `${c.red('✗')} Could not find Vite.`,
      '',
      '  Dependencies are probably not installed yet:',
      `    ${c.cyan('npm install')}`,
      '',
    ].join('\n'),
  );
  process.exit(1);
}

console.log(`${c.bold('→ Zwep dev')}`);
console.log(`  API  ${c.cyan(`http://127.0.0.1:${API_PORT}`)}`);
console.log(`  Web  ${c.cyan(`http://127.0.0.1:${WEB_PORT}`)}`);
console.log(c.dim('  Ctrl-C to stop both.\n'));

run('api', ['--experimental-strip-types', resolve(ROOT, 'services/api/src/server.ts')], ROOT);
run('web', [vite], WEB);

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

if (await waitForApi()) {
  console.log(`\n${c.green('✓')} API ready — open ${c.cyan(`http://127.0.0.1:${WEB_PORT}`)}`);
  if (!(await isIndexUp())) {
    console.log(
      [
        '',
        `${c.yellow('!')} Meilisearch is not reachable, so searches will return 503.`,
        `  ${c.cyan('npm run infra:up')}   ${c.dim('(needs Docker)')}`,
        `  ${c.cyan('npx zwep doctor')}    ${c.dim('— no Docker? this explains the alternatives')}`,
        '',
      ].join('\n'),
    );
  }
} else if (!shuttingDown) {
  console.warn(`\n${c.yellow('!')} The API did not answer on :${API_PORT} within 45s.`);
  explainApiFailure();
}
