import { build } from './app.ts';
import { loadEnv } from '@zwep/config';

/**
 * Process entry point. The server itself lives in `app.ts` so that tests can
 * build an instance with `app.inject()` without ever binding a port.
 */
const env = loadEnv();

const app = await build();

try {
  await app.listen({ port: env.API_PORT, host: env.API_HOST });
  app.log.info(`Zwep API listening on http://${env.API_HOST}:${env.API_PORT}`);
} catch (e) {
  console.error(e);
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
