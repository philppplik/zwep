import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { z } from 'zod';
import type { SourceConfig } from '@zwep/shared';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const rawGoogle = process.env.ZWEP_GOOGLE_PROXY_ENABLED;
const googleEnabled = rawGoogle === 'true' || rawGoogle === true;

export const envSchema = z.object({
  MEILI_HOST: z.string().default('http://127.0.0.1:7700'),
  MEILI_MASTER_KEY: z.string().default('zwep_dev_master_key_change_me'),
  MEILI_INDEX: z.string().default('zwep_documents'),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  API_PORT: z.coerce.number().default(8080),
  API_HOST: z.string().default('0.0.0.0'),
  API_CORS_ORIGINS: z.string().default('*'),
  ZWEP_ADMIN_KEY: z.string().default('zwep_admin_dev_key'),
  CRAWLER_USER_AGENT: z.string().default('ZwepBot/1.0 (+https://zwep.example)'),
  CRAWLER_CONCURRENCY: z.coerce.number().default(4),
  CRAWLER_DELAY_MS: z.coerce.number().default(500),
  GOOGLE_PROXY_ENABLED: z.boolean().default(googleEnabled),
});

export type Env = z.infer<typeof envSchema>;

/** Google proxy opt-in flag (privacy default: off). */
export function isGoogleProxyEnabled(): boolean {
  return !!loadEnv().GOOGLE_PROXY_ENABLED;
}

let cached: Env | null = null;
export function loadEnv(): Env {
  if (cached) return cached;
  cached = envSchema.parse(process.env);
  return cached;
}

/** Re-parse env (e.g. after tests mutate process.env). */
export function reloadEnv(): Env {
  cached = envSchema.parse(process.env);
  return cached;
}

export const sourceSchema = z.object({
  name: z.string().min(1).max(64),
  type: z.enum(['web', 'google']).optional(),
  seeds: z.array(z.string().url()).default([]),
  queries: z.array(z.string().min(1)).optional(),
  allowedDomains: z.array(z.string().min(1)).default([]),
  sitemap: z.string().url().optional(),
  schedule: z.string().optional(),
  maxDepth: z.number().int().min(0).max(10).optional(),
  maxPages: z.number().int().min(1).optional(),
});

/** Path to the writable runtime store (created from sources.yaml on first run). */
const STORE = resolve(__dirname, '../../../data/sources.json');

function seedFromYaml(): SourceConfig[] {
  const file = resolve(__dirname, '../../../config/sources.yaml');
  const raw = yaml.load(readFileSync(file, 'utf8')) as unknown;
  const arr = Array.isArray(raw) ? raw : (raw as any)?.sources;
  if (!Array.isArray(arr)) throw new Error(`No sources array in ${file}`);
  return arr.map((s) => sourceSchema.parse(s) as SourceConfig);
}

/** Load all sources from the runtime store (seeded from sources.yaml if absent). */
export function loadSources(): SourceConfig[] {
  if (!existsSync(STORE)) {
    const seed = seedFromYaml();
    saveSources(seed);
    return seed;
  }
  return JSON.parse(readFileSync(STORE, 'utf8')) as SourceConfig[];
}

export function saveSources(sources: SourceConfig[]): void {
  mkdirSync(dirname(STORE), { recursive: true });
  writeFileSync(STORE, JSON.stringify(sources, null, 2), 'utf8');
}

export function getSource(name: string): SourceConfig | undefined {
  return loadSources().find((s) => s.name === name);
}

export function upsertSource(src: SourceConfig): SourceConfig {
  const sources = loadSources();
  const i = sources.findIndex((s) => s.name === src.name);
  if (i >= 0) sources[i] = src;
  else sources.push(src);
  saveSources(sources);
  return src;
}

export function deleteSource(name: string): boolean {
  const sources = loadSources();
  const next = sources.filter((s) => s.name !== name);
  if (next.length === sources.length) return false;
  saveSources(next);
  return true;
}
