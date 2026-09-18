import { build } from './app.ts';
import { loadEnv } from '@zwep/config';

/**
 * Process entry point. The server itself lives in `app.ts` so that tests can
 * build an instance with `app.inject()` without ever binding a port.
 */

const env = loadEnv();

/**
 * Turn a startup failure into an explanation.
 *
 * A Node stack trace for `EADDRINUSE` tells the reader which internal function
 * threw, which is the one thing they cannot act on. Every case here names what
 * happened and the command that fixes it.
 */
function explainStartupFailure(e: unknown): string[] {
  const err = e as NodeJS.ErrnoException;
  const where = `${env.API_HOST}:${env.API_PORT}`;

  switch (err?.code) {
    case 'EADDRINUSE':
      return [
        `Port ${env.API_PORT} is already in use.`,
        '',
        '  Either Zwep is already running — check with:',
        '    zwep status',
        '',
        '  Or something else has the port. Use a different one:',
        `    API_PORT=8081 npm run dev`,
      ];
    case 'EACCES':
      return [
        `Not allowed to bind ${where}.`,
        '',
        '  Ports below 1024 need elevated privileges on most systems.',
        '  Pick a higher one:',
        '    API_PORT=8080 npm run dev',
      ];
    case 'EADDRNOTAVAIL':
      return [
        `The address ${env.API_HOST} does not exist on this machine.`,
        '',
        '  API_HOST must be an address this host actually has.',
        '    API_HOST=127.0.0.1 npm run dev',
      ];
    default:
      return [
        `The API could not start: ${err?.message ?? String(e)}`,
        '',
        '  Check the rest of your setup with:',
        '    npx zwep doctor',
      ];
  }
}

const app = await build();

try {
  await app.listen({ port: env.API_PORT, host: env.API_HOST });
  app.log.info(`Zwep API listening on http://${env.API_HOST}:${env.API_PORT}`);
} catch (e) {
  console.error(`\n✗ ${explainStartupFailure(e).join('\n')}\n`);
  // The stack is still available when it is actually wanted.
  if (process.env.ZWEP_DEBUG) console.error(e);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info(`${signal} received — shutting down`);
    app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}
