import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';
import type { SourceConfig } from '@zwep/shared';
import { loadDotEnv, REPO_ROOT } from './env.ts';

export { loadDotEnv, resetDotEnv, REPO_ROOT } from './env.ts';

loadDotEnv();

/**
 * Coerce the many ways a boolean is spelled in a shell environment
 * (`true`, `1`, `yes`, `on`) into a real boolean. Env vars are always strings,
 * so a bare `z.boolean()` here would throw and take the whole process down.
 */
const envBool = (fallback = false) =>
  z
    .union([z.boolean(), z.string()])
    .default(fallback)
    .transform((v) => {
      if (typeof v === 'boolean') return v;
      return /^(1|true|yes|on)$/i.test(v.trim());
    });

export const envSchema = z.object({
  MEILI_HOST: z.string().default('http://127.0.0.1:7700'),
  MEILI_MASTER_KEY: z.string().default('zwep_dev_master_key_change_me'),
  MEILI_INDEX: z.string().default('zwep_documents'),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  API_HOST: z.string().default('127.0.0.1'),
  API_CORS_ORIGINS: z.string().default('*'),
  API_RATE_LIMIT: z.coerce.number().int().min(0).default(120),
  ZWEP_ADMIN_KEY: z.string().default('zwep_admin_dev_key'),
  CRAWLER_USER_AGENT: z.string().default('ZwepBot/1.0 (+https://github.com/philppplik/zwep)'),
  CRAWLER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  CRAWLER_DELAY_MS: z.coerce.number().int().min(0).default(500),
  CRAWLER_TIMEOUT_MS: z.coerce.number().int().min(1000).default(20000),
  CRAWLER_MAX_BYTES: z.coerce.number().int().min(1024).default(5_000_000),
  /** Google proxy is opt-in (privacy default: off). Accepts true/1/yes/on. */
  GOOGLE_PROXY_ENABLED: envBool(false),
  // Embeddings (semantic search) — both providers optional.
  EMBED_PROVIDER: z.enum(['ollama', 'openrouter', 'none']).default('none'),
  OLLAMA_HOST: z.string().default('http://127.0.0.1:11434'),
  OLLAMA_EMBED_MODEL: z.string().default('nomic-embed-text'),
  OPENROUTER_API_KEY: z.string().default(''),
  OPENROUTER_EMBED_MODEL: z.string().default('openai/text-embedding-3-small'),
  // LLM for AI Overview — optional, separate from embeddings.
  LLM_PROVIDER: z.enum(['ollama', 'openrouter', 'none']).default('none'),
  OLLAMA_LLM_MODEL: z.string().default('llama3.1'),
  OPENROUTER_LLM_MODEL: z.string().default('openai/gpt-4o-mini'),
  OPENROUTER_LLM_KEY: z.string().default(''),
  /** Overview cache lifetime in hours. */
  OVERVIEW_TTL_HOURS: z.coerce.number().int().min(0).default(168),
  GRAPH_DB: z.string().default(''),
  /** Directory for the writable runtime state (sources.json, *.db). */
  ZWEP_DATA_DIR: z.string().default(''),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  cached = envSchema.parse(process.env);
  return cached;
}

/** Re-parse env (e.g. after tests mutate `process.env`). */
export function reloadEnv(): Env {
  cached = envSchema.parse(process.env);
  return cached;
}

/** Google proxy opt-in flag (privacy default: off). */
export function isGoogleProxyEnabled(): boolean {
  return loadEnv().GOOGLE_PROXY_ENABLED;
}

/** Absolute path of the writable data directory, created on demand. */
export function dataDir(): string {
  const dir = loadEnv().ZWEP_DATA_DIR || resolve(REPO_ROOT, 'data');
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/**
 * Validation contract for a crawl source.
 *
 * Every field the UI and API round-trip MUST be listed here — Zod strips
 * unknown keys, so a missing field is silently discarded on save (this is
 * exactly how the `enabled` toggle used to lose its value).
 */
export const sourceSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, 'Use letters, digits, dot, dash or underscore'),
  type: z.enum(['web', 'google']).default('web'),
  seeds: z.array(z.string().url()).default([]),
  queries: z.array(z.string().min(1)).optional(),
  allowedDomains: z.array(z.string().min(1)).default([]),
  sitemap: z.string().url().optional(),
  schedule: z.string().optional(),
  maxDepth: z.number().int().min(0).max(10).optional(),
  maxPages: z.number().int().min(1).max(1_000_000).optional(),
  enabled: z.boolean().optional(),
  label: z.string().max(120).optional(),
  description: z.string().max(500).optional(),
});

export type ValidatedSource = z.infer<typeof sourceSchema>;

/** Path to the writable runtime store (seeded from sources.yaml on first run). */
export function sourcesStorePath(): string {
  return resolve(dataDir(), 'sources.json');
}

export function sourcesYamlPath(): string {
  return resolve(REPO_ROOT, 'config/sources.yaml');
}

function seedFromYaml(): SourceConfig[] {
  const file = sourcesYamlPath();
  const raw = yaml.load(readFileSync(file, 'utf8')) as unknown;
  const arr = Array.isArray(raw) ? raw : (raw as { sources?: unknown })?.sources;
  if (!Array.isArray(arr)) throw new Error(`No sources array in ${file}`);
  return arr.map((s) => sourceSchema.parse(s) as SourceConfig);
}

/** Load all sources from the runtime store (seeded from sources.yaml if absent). */
export function loadSources(): SourceConfig[] {
  const store = sourcesStorePath();
  if (!existsSync(store)) {
    const seed = seedFromYaml();
    saveSources(seed);
    return seed;
  }
  try {
    const parsed = JSON.parse(readFileSync(store, 'utf8'));
    return Array.isArray(parsed) ? (parsed as SourceConfig[]) : [];
  } catch {
    // A corrupt store must not take the API down; fall back to the YAML seed.
    return seedFromYaml();
  }
}

/** Persist atomically: write to a temp file, then rename over the target. */
export function saveSources(sources: SourceConfig[]): void {
  const store = sourcesStorePath();
  mkdirSync(dirname(store), { recursive: true });
  const tmp = `${store}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(sources, null, 2), 'utf8');
  renameSync(tmp, store);
}

export function getSource(name: string): SourceConfig | undefined {
  return loadSources().find((s) => s.name === name);
}

export function upsertSource(src: SourceConfig): SourceConfig {
  const sources = loadSources();
  const i = sources.findIndex((s) => s.name === src.name);
  if (i >= 0) sources[i] = { ...sources[i], ...src };
  else sources.push(src);
  saveSources(sources);
  return sources[i >= 0 ? i : sources.length - 1];
}

export function deleteSource(name: string): boolean {
  const sources = loadSources();
  const next = sources.filter((s) => s.name !== name);
  if (next.length === sources.length) return false;
  saveSources(next);
  return true;
}

/** Names of all sources that are not explicitly disabled. */
export function enabledSourceNames(): string[] {
  return loadSources()
    .filter((s) => s.enabled !== false)
    .map((s) => s.name);
}
