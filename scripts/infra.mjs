#!/usr/bin/env node
/**
 * `npm run infra:up` / `infra:down` — start or stop Meilisearch.
 *
 * This wraps `docker compose` for one reason: when Docker is not installed, the
 * bare command fails with the shell's own message ("'docker' is not recognized")
 * which tells the reader nothing about Zwep, nothing about whether Docker is
 * required, and nothing about what to do instead. Docker is *optional* here —
 * Meilisearch also ships a standalone binary — and the reader deserves to learn
 * that at the moment it matters.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const DOCKER = isWindows ? 'docker.exe' : 'docker';

import { c } from './tty.mjs';

const action = process.argv[2] === 'down' ? 'down' : 'up';

function dockerAvailable() {
  const r = spawnSync(DOCKER, ['--version'], { stdio: 'ignore', timeout: 8000, windowsHide: true });
  return !r.error && r.status === 0;
}

function dockerRunning() {
  const r = spawnSync(DOCKER, ['info'], { stdio: 'ignore', timeout: 15_000, windowsHide: true });
  return r.status === 0;
}

function explainNoDocker() {
  console.error(
    [
      '',
      `${c.yellow('!')} Docker is not installed on this machine.`,
      '',
      `  ${c.bold('This is not a problem you have to solve with Docker.')}`,
      '  Zwep needs Meilisearch reachable — how you run it is up to you.',
      '',
      `  ${c.bold('Option A — run Meilisearch directly')} ${c.dim('(no Docker, one binary)')}`,
      '',
      isWindows
        ? [
            '    1. Download meilisearch-windows-amd64.exe from',
            '       https://github.com/meilisearch/meilisearch/releases/latest',
            '    2. Rename it to meilisearch.exe and run:',
            `       ${c.cyan('.\\meilisearch.exe --master-key=zwep_dev_master_key_change_me')}`,
          ].join('\n')
        : [
            `    ${c.cyan('curl -L https://install.meilisearch.com | sh')}`,
            `    ${c.cyan('./meilisearch --master-key=zwep_dev_master_key_change_me')}`,
          ].join('\n'),
      '',
      '    Leave it running in its own terminal, then in this one:',
      `       ${c.cyan('npm run dev')}`,
      '',
      `  ${c.bold('Option B — install Docker Desktop')}`,
      '',
      '    https://docs.docker.com/get-docker/',
      `    Then run ${c.cyan('npm run infra:up')} again.`,
      '',
      `  ${c.dim('Check your whole setup any time with')} ${c.cyan('npx zwep doctor')}`,
      '',
    ].join('\n'),
  );
}

function explainDockerStopped() {
  console.error(
    [
      '',
      `${c.yellow('!')} Docker is installed, but its engine is not running.`,
      '',
      isWindows
        ? '  Start Docker Desktop and wait until it reports "Engine running".'
        : '  Start the Docker daemon, e.g. `sudo systemctl start docker`.',
      '',
      `  Then run ${c.cyan(`npm run infra:${action}`)} again.`,
      '',
    ].join('\n'),
  );
}

// ---------------------------------------------------------------------------

if (!dockerAvailable()) {
  if (action === 'down') {
    console.log(`${c.dim('Docker is not installed — nothing to stop.')}`);
    process.exit(0);
  }
  explainNoDocker();
  process.exit(1);
}

if (!dockerRunning()) {
  explainDockerStopped();
  process.exit(1);
}

const args =
  action === 'up' ? ['compose', 'up', '-d', 'meilisearch', 'redis'] : ['compose', 'down'];

console.log(c.dim(`→ docker ${args.join(' ')}`));
const r = spawnSync(DOCKER, args, { cwd: ROOT, stdio: 'inherit', windowsHide: true });

if (r.status !== 0) {
  console.error(
    [
      '',
      `${c.red('✗')} docker compose ${action} failed.`,
      '',
      '  Common causes:',
      '    • Port 7700 is already taken by another Meilisearch',
      '    • Not enough disk space for the image',
      '    • The Docker engine stopped mid-command',
      '',
      `  ${c.cyan('docker compose logs meilisearch')}   ${c.dim('shows what the container said')}`,
      `  ${c.cyan('npx zwep doctor')}                   ${c.dim('checks the rest of your setup')}`,
      '',
    ].join('\n'),
  );
  process.exit(r.status ?? 1);
}

if (action === 'up') {
  console.log(
    [
      '',
      `${c.green('✓')} Meilisearch is starting on ${c.cyan('http://127.0.0.1:7700')}`,
      `  Next: ${c.cyan('npm run dev')}`,
      '',
    ].join('\n'),
  );
} else {
  console.log(`\n${c.green('✓')} Stopped.\n`);
}
