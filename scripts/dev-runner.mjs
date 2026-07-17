// Cross-platform dev runner: starts the API (8080) and Vite (5173) together,
// forwarding signals so Ctrl-C cleans both up. Equivalent to start-dev.sh / .bat.
import { spawn } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;

const api = spawn('node', ['--experimental-strip-types', 'services/api/src/server.ts'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});

const web = spawn('npm', ['run', 'dev'], {
  cwd: root + '/web',
  stdio: 'inherit',
  shell: true,
});

const shutdown = () => {
  console.log('\n→ shutting down Zwep dev...');
  api.kill();
  web.kill();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
