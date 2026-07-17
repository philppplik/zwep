import { loadEnv } from '@zwep/config';
import Database from 'better-sqlite3';
import { resolve, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

/**
 * LLM provider abstraction for the AI Overview feature (Phase B3).
 *
 * Two optional providers, selectable via LLM_PROVIDER (or runtime override):
 *   - 'ollama'     : local, free, no API key (OLLAMA_LLM_MODEL, e.g. llama3.1)
 *   - 'openrouter' : cloud, requires OPENROUTER_LLM_KEY
 *   - 'none'       : AI Overview disabled
 *
 * All methods degrade gracefully: if the provider is unreachable we throw a
 * typed error the caller can catch and fall back to no-overview.
 *
 * Overview caching: completed summaries are stored in SQLite keyed by a hash
 * of (provider+model+query). On cache hit we return the stored text instead
 * of calling the LLM again (saves tokens + latency). TTL configurable.
 */

const OVERVIEW_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

let cacheDb: Database.Database | null = null;
function cache(): Database.Database {
  if (cacheDb) return cacheDb;
  const env = loadEnv();
  const p = env.GRAPH_DB
    ? resolve(dirname(env.GRAPH_DB), 'overview_cache.db')
    : resolve(process.cwd(), 'data/overview_cache.db');
  mkdirSync(dirname(p), { recursive: true });
  cacheDb = new Database(p);
  cacheDb.pragma('journal_mode = WAL');
  cacheDb.exec(`CREATE TABLE IF NOT EXISTS overview_cache (
    key TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    created INTEGER NOT NULL
  )`);
  return cacheDb;
}

function cacheKey(provider: string, model: string, query: string): string {
  return `${provider}|${model}|${query.toLowerCase().trim()}`;
}

export function getCachedOverview(provider: string, model: string, query: string): string | null {
  try {
    const row = cache().prepare('SELECT text, created FROM overview_cache WHERE key = ?').get(cacheKey(provider, model, query)) as
      | { text: string; created: number }
      | undefined;
    if (!row) return null;
    if (Date.now() - row.created > OVERVIEW_TTL_MS) return null;
    return row.text;
  } catch {
    return null;
  }
}

export function setCachedOverview(provider: string, model: string, query: string, text: string) {
  try {
    cache()
      .prepare('INSERT INTO overview_cache (key, text, created) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET text = excluded.text, created = excluded.created')
      .run(cacheKey(provider, model, query), text, Date.now());
  } catch {}
}

export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmError';
  }
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  complete(prompt: string): Promise<string>;
}

class OllamaLlm implements LlmProvider {
  name = 'ollama';
  model: string;
  private host: string;
  constructor(model: string) {
    const env = loadEnv();
    this.host = env.OLLAMA_HOST.replace(/\/$/, '');
    this.model = model || env.OLLAMA_LLM_MODEL;
  }
  async complete(prompt: string): Promise<string> {
    const res = await fetch(`${this.host}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt, stream: false }),
    });
    if (!res.ok) throw new LlmError(`Ollama generate failed: ${res.status} ${await res.text().catch(() => '')}`);
    const data = (await res.json()) as { response: string };
    return data.response.trim();
  }
}

class OpenRouterLlm implements LlmProvider {
  name = 'openrouter';
  model: string;
  private key: string;
  constructor(model: string, key: string) {
    const env = loadEnv();
    this.model = model || env.OPENROUTER_LLM_MODEL;
    this.key = key || env.OPENROUTER_LLM_KEY;
  }
  async complete(prompt: string): Promise<string> {
    if (!this.key) throw new LlmError('OPENROUTER_LLM_KEY not set');
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.key}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 400,
      }),
    });
    if (!res.ok) throw new LlmError(`OpenRouter chat failed: ${res.status} ${await res.text().catch(() => '')}`);
    const data = (await res.json()) as { choices: { message: { content: string } }[] };
    return data.choices[0].message.content.trim();
  }
}

let provider: LlmProvider | null = null;
let disabled = false;
let runtimeOverride: { provider?: string; model?: string; key?: string } | null = null;

export function resetLlmProvider() {
  provider = null;
  disabled = false;
}

/** Apply runtime LLM settings pushed from the frontend (no .env restart). */
export function applyRuntimeLlmSettings(opts: { llmProvider?: string; model?: string; key?: string }) {
  runtimeOverride = {
    provider: opts.llmProvider,
    model: opts.model,
    key: opts.key,
  };
  provider = null;
  disabled = false;
}

export async function getLlmProvider(): Promise<LlmProvider | null> {
  if (disabled) return null;
  if (provider) return provider;
  const env = loadEnv();
  const providerName = (runtimeOverride?.provider ?? env.LLM_PROVIDER) as string;
  if (providerName === 'none' || !providerName) return null;
  try {
    const model = runtimeOverride?.model ?? (providerName === 'ollama' ? env.OLLAMA_LLM_MODEL : env.OPENROUTER_LLM_MODEL);
    const key = runtimeOverride?.key ?? env.OPENROUTER_LLM_KEY;
    provider =
      providerName === 'ollama'
        ? new OllamaLlm(model)
        : new OpenRouterLlm(model, key);
    // probe with a tiny completion
    await provider.complete('ping');
    return provider;
  } catch (e) {
    disabled = true;
    console.warn(`[llm] provider '${providerName}' unavailable: ${(e as Error).message}. AI Overview disabled.`);
    return null;
  }
}
