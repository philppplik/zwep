import { loadEnv, dataDir, oneLine } from '@zwep/config';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

/**
 * LLM provider abstraction for the AI Overview feature.
 *
 * Providers, selectable via `LLM_PROVIDER` or a runtime override:
 *   - `ollama`     — local, free, no API key (`OLLAMA_LLM_MODEL`)
 *   - `openrouter` — cloud, requires `OPENROUTER_LLM_KEY`
 *   - `none`       — AI Overview disabled
 *
 * Failures degrade gracefully: `getLlmProvider()` returns null and the caller
 * falls back to "no overview" rather than failing the search.
 */

/** Requests to a provider are abandoned after this long. */
const LLM_TIMEOUT_MS = 60_000;
/** After a provider fails, wait this long before probing it again. */
const RETRY_AFTER_MS = 60_000;

let cacheDb: Database.Database | null = null;

function cache(): Database.Database {
  if (cacheDb) return cacheDb;
  const env = loadEnv();
  const p = env.GRAPH_DB
    ? resolve(dirname(env.GRAPH_DB), 'overview_cache.db')
    : resolve(dataDir(), 'overview_cache.db');
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

function ttlMs(): number {
  return loadEnv().OVERVIEW_TTL_HOURS * 60 * 60 * 1000;
}

/**
 * Cache key. Hashed rather than concatenated: a query containing the `|`
 * separator could otherwise collide with a different provider/model pair, and
 * a very long query would make an unbounded primary key.
 */
function cacheKey(provider: string, model: string, query: string): string {
  return createHash('sha256')
    .update(`${provider}|${model}|${query.toLowerCase().trim()}`)
    .digest('hex');
}

export function getCachedOverview(provider: string, model: string, query: string): string | null {
  const ttl = ttlMs();
  if (ttl <= 0) return null;
  try {
    const row = cache()
      .prepare('SELECT text, created FROM overview_cache WHERE key = ?')
      .get(cacheKey(provider, model, query)) as { text: string; created: number } | undefined;
    if (!row) return null;
    if (Date.now() - row.created > ttl) return null;
    return row.text;
  } catch {
    return null;
  }
}

export function setCachedOverview(
  provider: string,
  model: string,
  query: string,
  text: string,
): void {
  if (ttlMs() <= 0) return;
  try {
    cache()
      .prepare(
        'INSERT INTO overview_cache (key, text, created) VALUES (?,?,?) ' +
          'ON CONFLICT(key) DO UPDATE SET text = excluded.text, created = excluded.created',
      )
      .run(cacheKey(provider, model, query), text, Date.now());
  } catch {
    /* the cache is an optimization; never fail a request over it */
  }
}

/** Drop every cached overview. Exposed through the admin API. */
export function clearOverviewCache(): number {
  try {
    const info = cache().prepare('DELETE FROM overview_cache').run();
    return info.changes;
  } catch {
    return 0;
  }
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
  readonly name = 'ollama';
  readonly model: string;
  private host: string;

  constructor(model?: string) {
    const env = loadEnv();
    this.host = env.OLLAMA_HOST.replace(/\/$/, '');
    this.model = model || env.OLLAMA_LLM_MODEL;
  }

  async complete(prompt: string): Promise<string> {
    const res = await fetch(`${this.host}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt, stream: false }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new LlmError(`Ollama generate failed: ${res.status} ${await safeText(res)}`);
    }
    const data = (await res.json()) as { response?: string };
    if (typeof data.response !== 'string') throw new LlmError('Ollama returned no response text');
    return data.response.trim();
  }
}

class OpenRouterLlm implements LlmProvider {
  readonly name = 'openrouter';
  readonly model: string;
  private key: string;

  constructor(model?: string, key?: string) {
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
        'HTTP-Referer': 'https://github.com/philppplik/zwep',
        'X-Title': 'Zwep',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 600,
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new LlmError(`OpenRouter chat failed: ${res.status} ${await safeText(res)}`);
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new LlmError('OpenRouter returned no message content');
    return text.trim();
  }
}

async function safeText(res: Response): Promise<string> {
  return oneLine(await res.text().catch(() => ''), 400);
}

let provider: LlmProvider | null = null;
let disabledUntil = 0;
/** The only provider names this module will ever hold. */
export const LLM_PROVIDERS = ['none', 'ollama', 'openrouter'] as const;
export type LlmProviderName = (typeof LLM_PROVIDERS)[number];

export function isLlmProviderName(v: unknown): v is LlmProviderName {
  return typeof v === 'string' && (LLM_PROVIDERS as readonly string[]).includes(v);
}

let runtimeOverride: { provider?: LlmProviderName; model?: string; key?: string } | null = null;

export function resetLlmProvider(): void {
  provider = null;
  disabledUntil = 0;
}

/**
 * Apply runtime LLM settings pushed from the admin UI (no restart needed).
 *
 * The provider name is validated here rather than trusted from the caller. The
 * API route validates too, but this module logs the name, so it must not
 * depend on a check that lives in a different file to know the value is one of
 * three literals.
 */
export function applyRuntimeLlmSettings(opts: {
  llmProvider?: string;
  model?: string;
  key?: string;
}): void {
  runtimeOverride = {
    provider: isLlmProviderName(opts.llmProvider) ? opts.llmProvider : undefined,
    model: opts.model,
    key: opts.key,
  };
  resetLlmProvider();
}

/** The provider name currently in effect (env default or runtime override). */
export function activeProviderName(): LlmProviderName {
  const fromEnv = loadEnv().LLM_PROVIDER;
  return runtimeOverride?.provider ?? (isLlmProviderName(fromEnv) ? fromEnv : 'none');
}

/**
 * Resolve the active provider, probing it once for reachability.
 *
 * A failed probe disables the provider for `RETRY_AFTER_MS` rather than
 * permanently: a momentarily busy Ollama used to switch AI Overview off for
 * the entire lifetime of the process.
 */
export async function getLlmProvider(): Promise<LlmProvider | null> {
  if (provider) return provider;
  if (Date.now() < disabledUntil) return null;

  const env = loadEnv();
  const providerName = activeProviderName();
  if (providerName === 'none') return null;

  const model =
    runtimeOverride?.model ??
    (providerName === 'ollama' ? env.OLLAMA_LLM_MODEL : env.OPENROUTER_LLM_MODEL);
  const key = runtimeOverride?.key ?? env.OPENROUTER_LLM_KEY;

  try {
    const candidate =
      providerName === 'ollama' ? new OllamaLlm(model) : new OpenRouterLlm(model, key);
    await candidate.complete('ping');
    provider = candidate;
    return provider;
  } catch (e) {
    disabledUntil = Date.now() + RETRY_AFTER_MS;
    console.warn(
      `[llm] provider '${providerName}' unavailable: ${oneLine((e as Error).message)}. ` +
        `AI Overview paused for ${RETRY_AFTER_MS / 1000}s.`,
    );
    return null;
  }
}

/**
 * Build the AI Overview prompt.
 *
 * Kept as a pure function so its wording is testable and so the answer
 * language follows the user's query instead of being pinned to one locale.
 */
export function overviewPrompt(
  query: string,
  sources: { title: string; excerpt: string }[],
): string {
  const context = sources.map((s, i) => `[${i + 1}] ${s.title}\n${s.excerpt}`).join('\n\n');
  return [
    'You are the summarization engine of a private search index.',
    `Summarize the curated results below for the query "${query}".`,
    'Rules:',
    '- Use ONLY information contained in the sources. Never add outside knowledge.',
    '- Reply in the same language as the query.',
    '- Start with one short paragraph, then a numbered list of the key points.',
    '- Cite the source number in brackets, e.g. [2], after each key point.',
    '- No preamble such as "Here is a summary".',
    '',
    'Sources:',
    context,
  ].join('\n');
}
