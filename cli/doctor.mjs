/**
 * `zwep doctor` — check this machine and say what to do about each problem.
 *
 * The design rule here: a check that reports a problem without a next step is
 * only half a diagnosis. Every failing check carries the exact command to run,
 * and where a prerequisite is genuinely optional the check says so rather than
 * implying the install is broken.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { findZwepHome, isApiUp } from './local.mjs';

const isWindows = process.platform === 'win32';

/** Minimum Node that can strip TypeScript types without a build step. */
const MIN_NODE_MAJOR = 22;
const MIN_NODE_MINOR = 6;

/**
 * @typedef {object} Check
 * @property {string} name
 * @property {'ok'|'warn'|'fail'|'skip'} status
 * @property {string} detail       What was found.
 * @property {string[]} [fix]      Lines telling the user what to do.
 * @property {boolean} [blocking]  Does Zwep fail to work without this?
 */

function commandVersion(cmd, args = ['--version']) {
  try {
    const r = spawnSync(isWindows ? `${cmd}.exe` : cmd, args, {
      encoding: 'utf8',
      timeout: 8000,
      windowsHide: true,
    });
    if (r.error || r.status !== 0) return null;
    return (r.stdout || r.stderr || '').trim().split('\n')[0];
  } catch {
    return null;
  }
}

function checkNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  const ok = major > MIN_NODE_MAJOR || (major === MIN_NODE_MAJOR && minor >= MIN_NODE_MINOR);
  return {
    name: 'Node.js',
    status: ok ? 'ok' : 'fail',
    blocking: true,
    detail: `${process.version} at ${process.execPath}`,
    fix: ok
      ? undefined
      : [
          `Zwep needs Node ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} or newer — it runs TypeScript without a build step.`,
          'Download: https://nodejs.org',
        ],
  };
}

function checkInstallation() {
  const home = findZwepHome();
  if (!home) {
    return {
      name: 'Zwep engine',
      status: 'warn',
      detail: 'not found on this machine — the npm package is the client only',
      fix: [
        'To run your own Zwep:',
        '  git clone https://github.com/philppplik/zwep',
        '  cd zwep && npm install',
        '',
        'Already have it elsewhere? Point at it:',
        '  ZWEP_HOME=/path/to/zwep',
        '',
        'Only using a Zwep someone else runs? Set ZWEP_API and ignore this.',
      ],
    };
  }

  const deps = existsSync(join(home, 'node_modules'));
  return {
    name: 'Zwep engine',
    status: deps ? 'ok' : 'fail',
    blocking: !deps,
    detail: deps ? home : `${home} — dependencies not installed`,
    fix: deps ? undefined : [`cd ${home}`, 'npm install'],
  };
}

function checkEnvFile() {
  const home = findZwepHome();
  if (!home) return { name: '.env', status: 'skip', detail: 'no engine installed' };

  const envPath = join(home, '.env');
  if (!existsSync(envPath)) {
    return {
      name: '.env',
      status: 'warn',
      detail: 'missing — built-in defaults will be used',
      fix: [
        `cd ${home}`,
        isWindows ? 'copy .env.example .env' : 'cp .env.example .env',
        '',
        'The defaults work for local development, so this is optional until you',
        'expose Zwep to a network — then see SECURITY.md.',
      ],
    };
  }

  // Flag the development secrets, but only as a warning: they are correct for
  // localhost and wrong only once something else can reach the API.
  let insecure = false;
  try {
    const body = readFileSync(envPath, 'utf8');
    insecure =
      /ZWEP_ADMIN_KEY\s*=\s*zwep_admin_dev_key/.test(body) ||
      /MEILI_MASTER_KEY\s*=\s*zwep_dev_master_key_change_me/.test(body);
  } catch {
    /* unreadable .env is not worth failing over */
  }

  return {
    name: '.env',
    status: insecure ? 'warn' : 'ok',
    detail: insecure ? 'present, using development secrets' : 'present',
    fix: insecure
      ? [
          'Fine for localhost. Before exposing Zwep to a network, change',
          'ZWEP_ADMIN_KEY and MEILI_MASTER_KEY — see SECURITY.md.',
        ]
      : undefined,
  };
}

/**
 * What to tell someone whose Meilisearch is not answering.
 *
 * Pure, and takes what it found rather than probing: the advice differs
 * depending on what is installed, and a test that cannot control that ends up
 * asserting whatever the CI runner happens to have. (It did — CI runners ship
 * Docker, so the Docker-free branch was never exercised.)
 */
export function meilisearchAdvice({ host, hasDocker, hasNativeBinary, windows = false }) {
  const fix = [`Nothing is answering at ${host}. Pick whichever suits you:`, ''];

  if (hasDocker) {
    fix.push('  Docker is installed — start it with:', '    npm run infra:up', '');
  } else {
    fix.push(
      '  Docker is NOT installed. Either:',
      '',
      '  a) Install Docker Desktop, then `npm run infra:up`',
      '     https://docs.docker.com/get-docker/',
      '',
      hasNativeBinary
        ? '  b) You already have the meilisearch binary — start it with:'
        : '  b) Run Meilisearch directly, no Docker needed:',
    );
    if (!hasNativeBinary) {
      fix.push(
        windows
          ? '     Download meilisearch.exe from https://github.com/meilisearch/meilisearch/releases'
          : '     curl -L https://install.meilisearch.com | sh',
      );
    }
    fix.push('     meilisearch --master-key=zwep_dev_master_key_change_me', '');
  }

  fix.push('  Zwep starts without it, but every search returns 503.');
  return fix;
}

async function checkMeilisearch(probes) {
  const host = (process.env.MEILI_HOST ?? 'http://127.0.0.1:7700').replace(/\/+$/, '');
  try {
    const res = await fetch(`${host}/health`, { signal: AbortSignal.timeout(2500) });
    if (res.ok) return { name: 'Meilisearch', status: 'ok', detail: `reachable at ${host}` };
  } catch {
    /* fall through to the diagnosis below */
  }

  return {
    name: 'Meilisearch',
    status: 'fail',
    blocking: true,
    detail: `not reachable at ${host}`,
    fix: meilisearchAdvice({
      host,
      hasDocker: Boolean(probes.dockerVersion()),
      hasNativeBinary: Boolean(probes.meilisearchVersion()),
      windows: probes.windows,
    }),
  };
}

function checkDocker(probes) {
  const version = probes.dockerVersion();
  if (!version) {
    return {
      name: 'Docker',
      status: 'warn',
      detail: 'not installed',
      fix: [
        'Optional. Docker is only one way to run Meilisearch — see the',
        'Meilisearch check above for the alternative.',
      ],
    };
  }

  // Installed but not running is its own, very common, state.
  return probes.dockerRunning()
    ? { name: 'Docker', status: 'ok', detail: version }
    : {
        name: 'Docker',
        status: 'warn',
        detail: `${version} — installed but the daemon is not running`,
        fix: [
          isWindows
            ? 'Start Docker Desktop and wait for it to say "Engine running".'
            : 'Start the Docker daemon (e.g. `sudo systemctl start docker`).',
        ],
      };
}

async function checkApi(base) {
  if (await isApiUp(base)) {
    return { name: 'Zwep API', status: 'ok', detail: `reachable at ${base}` };
  }
  const home = findZwepHome();
  return {
    name: 'Zwep API',
    status: 'warn',
    detail: `not running at ${base}`,
    fix: home
      ? [
          'zwep up            # start it in the background',
          'npm run dev       # or, with the web UI',
        ]
      : ['No engine installed here. Set ZWEP_API to point at one, or clone the repo.'],
  };
}

function checkPlaywright(probes) {
  if (!probes.probeSlowChecks) {
    return { name: 'Playwright', status: 'skip', detail: 'not checked' };
  }
  const home = findZwepHome();
  if (!home) return { name: 'Playwright', status: 'skip', detail: 'no engine installed' };

  const installed = existsSync(join(home, 'node_modules', 'playwright'));
  if (!installed) {
    return { name: 'Playwright', status: 'skip', detail: 'not installed (dependencies missing)' };
  }
  // Only the browser download is separate from the npm package.
  const r = spawnSync(
    process.execPath,
    [join(home, 'node_modules', 'playwright', 'cli.js'), 'install', '--dry-run', 'chromium'],
    { encoding: 'utf8', timeout: 15_000, cwd: home, windowsHide: true },
  );
  const missing = r.status !== 0 || /not installed|Download/i.test(r.stdout ?? '');
  return {
    name: 'Playwright',
    status: missing ? 'warn' : 'ok',
    detail: missing ? 'Chromium not downloaded' : 'Chromium available',
    fix: missing
      ? [
          'Optional. Only needed to crawl pages that require JavaScript;',
          'static pages index fine without it.',
          '  npx playwright install chromium',
        ]
      : undefined,
  };
}

function checkPort(port) {
  // A port already in use is the second most common reason the API will not
  // start, and the message Node gives for it is not obviously actionable.
  return new Promise((resolvePromise) => {
    import('node:net').then(({ createServer }) => {
      const server = createServer();
      server.once('error', (e) => {
        resolvePromise(
          e.code === 'EADDRINUSE'
            ? {
                name: `Port ${port}`,
                status: 'warn',
                detail: 'already in use',
                fix: [
                  'Something is already listening there. Either it is Zwep (fine),',
                  'or another program has the port:',
                  `  API_PORT=8081 npm run dev`,
                ],
              }
            : { name: `Port ${port}`, status: 'ok', detail: 'available' },
        );
      });
      server.once('listening', () => {
        server.close(() =>
          resolvePromise({ name: `Port ${port}`, status: 'ok', detail: 'available' }),
        );
      });
      server.listen(port, '127.0.0.1');
    });
  });
}

/**
 * Everything the doctor learns about the outside world, in one injectable
 * object.
 *
 * Shelling out from inside each check made the results depend on whatever the
 * host happened to have installed — CI runners ship Docker, so the "no Docker"
 * advice was never actually exercised by the test that claimed to cover it.
 */
export const realProbes = {
  windows: isWindows,
  /** Playwright's check spawns a process and is slow; tests opt out. */
  probeSlowChecks: true,
  dockerVersion: () => commandVersion('docker'),
  meilisearchVersion: () => commandVersion('meilisearch'),
  dockerRunning: () =>
    spawnSync(isWindows ? 'docker.exe' : 'docker', ['info'], {
      stdio: 'ignore',
      timeout: 10_000,
      windowsHide: true,
    }).status === 0,
};

/** Run every check. Returns the raw results so the caller can render them. */
export async function runDoctor({ base = 'http://127.0.0.1:8080', probes = realProbes } = {}) {
  const p = { ...realProbes, ...probes };
  const apiPort = Number(new URL(base).port || 8080);
  const [meili, api, port] = await Promise.all([
    checkMeilisearch(p),
    checkApi(base),
    checkPort(apiPort),
  ]);

  return [
    checkNode(),
    checkInstallation(),
    checkEnvFile(),
    checkDocker(p),
    meili,
    api,
    port,
    checkPlaywright(p),
  ];
}

/** Does anything here stop Zwep from working? */
export function hasBlockingProblem(checks) {
  return checks.some((c) => c.status === 'fail' && c.blocking);
}
