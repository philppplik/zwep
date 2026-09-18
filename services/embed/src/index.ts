import { loadEnv } from '@zwep/config';

/**
 * Embedding provider abstraction for semantic search (Phase B).
 *
 * Two optional providers, selectable via EMBED_PROVIDER:
 *   - 'ollama'     : local, free, no API key (nomic-embed-text)
 *   - 'openrouter' : cloud, requires OPENROUTER_API_KEY
 *   - 'none'       : semantic search disabled (BM25 only)
 *
 * All methods degrade gracefully: if the provider is unreachable we throw a
 * typed error the caller can catch and fall back to lexical search.
 */

/** Embedding requests are abandoned after this long. */
const EMBED_TIMEOUT_MS = 60_000;

export class EmbedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbedError';
  }
}

export interface EmbedProvider {
  readonly name: string;
  embed(texts: string[]): Promise<number[][]>;
  dimensions(): Promise<number>;
}

class OllamaEmbed implements EmbedProvider {
  name = 'ollama';
  private host: string;
  private model: string;
  private dim: number | null = null;

  constructor() {
    const env = loadEnv();
    this.host = env.OLLAMA_HOST.replace(/\/$/, '');
    this.model = env.OLLAMA_EMBED_MODEL;
  }

  async dimensions(): Promise<number> {
    if (this.dim) return this.dim;
    // probe with a tiny string
    const v = (await this.embed(['probe']))[0];
    this.dim = v.length;
    return this.dim;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (const t of texts) {
      const res = await fetch(`${this.host}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt: t.slice(0, 8000) }),
        signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new EmbedError(`Ollama embed failed: ${res.status} ${await res.text().catch(() => '')}`);
      }
      const data = (await res.json()) as { embedding: number[] };
      out.push(data.embedding);
    }
    return out;
  }
}

class OpenRouterEmbed implements EmbedProvider {
  name = 'openrouter';
  private key: string;
  private model: string;
  private dim: number | null = null;

  constructor() {
    const env = loadEnv();
    this.key = env.OPENROUTER_API_KEY;
    this.model = env.OPENROUTER_EMBED_MODEL;
  }

  async dimensions(): Promise<number> {
    if (this.dim) return this.dim;
    const v = (await this.embed(['probe']))[0];
    this.dim = v.length;
    return this.dim;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.key) throw new EmbedError('OPENROUTER_API_KEY not set');
    const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.key}`,
      },
      body: JSON.stringify({ model: this.model, input: texts.map((t) => t.slice(0, 8000)) }),
      signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new EmbedError(`OpenRouter embed failed: ${res.status} ${await res.text().catch(() => '')}`);
    }
    const data = (await res.json()) as { data: { embedding: number[] }[] };
    return data.data.map((d) => d.embedding);
  }
}

let provider: EmbedProvider | null = null;
let disabledUntil = 0;

/** After a failed probe, wait this long before trying the provider again. */
const RETRY_AFTER_MS = 60_000;

/**
 * Returns the active embedding provider, or null if semantic search is off or
 * the provider is unreachable.
 *
 * An unreachable provider is disabled for `RETRY_AFTER_MS`, not forever: a
 * transient blip during boot used to kill semantic search until restart.
 */
export async function getEmbedProvider(): Promise<EmbedProvider | null> {
  if (provider) return provider;
  if (Date.now() < disabledUntil) return null;
  const env = loadEnv();
  if (env.EMBED_PROVIDER === 'none' || !env.EMBED_PROVIDER) return null;
  try {
    const p = env.EMBED_PROVIDER === 'ollama' ? new OllamaEmbed() : new OpenRouterEmbed();
    // probe connectivity
    await p.dimensions();
    provider = p;
    return provider;
  } catch (e) {
    disabledUntil = Date.now() + RETRY_AFTER_MS;
    console.warn(
      `[embed] provider '${env.EMBED_PROVIDER}' unavailable: ${(e as Error).message}. ` +
        `Semantic search paused for ${RETRY_AFTER_MS / 1000}s.`,
    );
    return null;
  }
}

export function resetEmbedProvider() {
  provider = null;
  disabledUntil = 0;
}
