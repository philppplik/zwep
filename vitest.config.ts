import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Aliases mirror the npm-workspace links so tests resolve the same specifiers
 * the runtime uses (`@zwep/shared`, `@zwep/config`, …) without a build step.
 */
const alias = {
  '@zwep/shared': r('./packages/shared/src/index.ts'),
  '@zwep/config': r('./packages/config/src/index.ts'),
  '@zwep/quality': r('./packages/quality/src/index.ts'),
  '@zwep/crawler': r('./services/crawler/src/index.ts'),
  '@zwep/extractor': r('./services/extractor/src/index.ts'),
  '@zwep/indexer': r('./services/indexer/src/index.ts'),
  '@zwep/embed': r('./services/embed/src/index.ts'),
  '@zwep/graph': r('./services/graph/src/index.ts'),
  '@zwep/llm': r('./services/llm/src/index.ts'),
};

/**
 * Two projects share one config:
 *   - `node` — services, packages and the CLI (plain Node environment)
 *   - `web`  — UI/UX component behaviour (jsdom environment)
 *
 * They are separate projects rather than one suite because the web tests need
 * a DOM and the node tests must not have one: a `document` global leaking into
 * the crawler tests would hide real environment assumptions.
 */
export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: [
        'packages/*/src/**/*.ts',
        'services/*/src/**/*.ts',
        'web/src/**/*.ts',
        'cli/**/*.mjs',
      ],
      exclude: ['**/*.d.ts'],
    },
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          globals: true,
          environment: 'node',
          include: ['tests/node/**/*.test.ts', 'tests/cli/**/*.test.ts'],
          setupFiles: ['tests/setup.node.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'web',
          globals: true,
          environment: 'jsdom',
          include: ['tests/web/**/*.test.ts'],
          setupFiles: ['tests/setup.web.ts'],
        },
      },
    ],
  },
});
