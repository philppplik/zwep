import { defineConfig } from 'vite';

/**
 * Dev proxy: the web UI calls `/v1/*`, which is forwarded to the Fastify API
 * on port 8080. In production the API sits behind the same origin (reverse
 * proxy, or a static server in front of it), so no host is ever hard-coded.
 */
const API_TARGET = process.env.ZWEP_API ?? 'http://127.0.0.1:8080';

export default defineConfig({
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    // `appType: 'spa'` (the default) serves index.html for unknown paths, which
    // is what makes /library and /settings survive a hard refresh.
    proxy: {
      '/v1': { target: API_TARGET, changeOrigin: true },
      '/healthz': { target: API_TARGET, changeOrigin: true },
    },
  },
  preview: {
    port: Number(process.env.WEB_PREVIEW_PORT ?? 4173),
    proxy: {
      '/v1': { target: API_TARGET, changeOrigin: true },
      '/healthz': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
  },
});
