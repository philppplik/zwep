import { defineConfig } from 'vite';

// Dev proxy: the web UI calls /v1/* which is proxied to the Fastify API (port 8080).
// In production the API sits behind the same origin (reverse proxy / static serve).
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/v1': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
      '/healthz': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
