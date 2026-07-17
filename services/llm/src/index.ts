import { loadEnv } from '@zwep/config';

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
 */

export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmError';
  }
}

export interface LlmProvider {
  readonly name: string;
  complete(prompt: string): Promise<string>;
}

class OllamaLlm implements LlmProvider {
  name = 'ollama';
  private host: string;
  model: string;
  constructor() {
    const env = loadEnv();
    this.host = env.OLLAMA_HOST.replace(/\/$/, '');
    this.model = env.OLLAMA_LLM_MODEL;
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
  key: string;
  model: string;
  constructor() {
    const env = loadEnv();
    this.key = env.OPENROUTER_LLM_KEY;
    this.model = env.OPENROUTER_LLM_MODEL;
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
    let p: LlmProvider;
    if (providerName === 'ollama') {
      const m = new OllamaLlm();
      if (runtimeOverride?.model) m.model = runtimeOverride.model;
      p = m;
    } else {
      const m = new OpenRouterLlm();
      if (runtimeOverride?.model) m.model = runtimeOverride.model;
      if (runtimeOverride?.key) m.key = runtimeOverride.key;
      p = m;
    }
    await p.complete('ping');
    provider = p;
    return provider;
  } catch (e) {
    disabled = true;
    console.warn(`[llm] provider '${providerName}' unavailable: ${(e as Error).message}. AI Overview disabled.`);
    return null;
  }
}
