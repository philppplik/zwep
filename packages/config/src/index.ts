import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { z } from 'zod';
import type { SourceConfig } from '@zwep/shared';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

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
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;
export function loadEnv(): Env {
  if (cached) return cached;
  cached = envSchema.parse(process.env);
  return cached;
}

const sourceSchema = z.object({
  name: z.string(),
  seeds: z.array(z.string().url()),
  allowedDomains: z.array(z.string()),
  sitemap: z.string().url().optional(),
  schedule: z.string().optional(),
  maxDepth: z.number().int().min(0).max(10).optional(),
  maxPages: z.number().int().min(1).optional(),
});

/** Load sources.yaml (array of SourceConfig). */
export function loadSources(path?: string): SourceConfig[] {
  const file = path ?? resolve(__dirname, '../../../config/sources.yaml');
  const raw = yaml.load(readFileSync(file, 'utf8')) as unknown;
  const arr = Array.isArray(raw) ? raw : (raw as any)?.sources;
  if (!Array.isArray(arr)) throw new Error(`No sources array in ${file}`);
  return arr.map((s) => sourceSchema.parse(s) as SourceConfig);
}

export function getSource(name: string): SourceConfig | undefined {
  return loadSources().find((s) => s.name === name);
}
