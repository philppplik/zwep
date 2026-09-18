import { ollamaModels, openrouterModels, pushSettings, type ModelInfo } from '../client.ts';
import { escapeHtml } from '../dom.ts';
import {
  applyTheme,
  loadSettings,
  saveSettings,
  type LlmProvider,
  type Theme,
  type ZwepSettings,
} from '../settings.ts';

/**
 * Settings screen.
 *
 * Everything is stored in `localStorage` and applied immediately — there is no
 * Save button, because a self-hosted single-user tool has no reason to make
 * you confirm your own preferences. LLM settings are additionally pushed to
 * the server so AI Overview works without editing `.env` and restarting.
 */

const OLLAMA_PRESETS = ['llama3.1', 'llama3.1:70b', 'qwen2.5', 'mistral', 'phi3'];
const OPENROUTER_PRESETS = [
  'openai/gpt-4o-mini',
  'openai/gpt-4o',
  'anthropic/claude-3.5-sonnet',
  'meta-llama/llama-3.1-70b-instruct',
  'google/gemini-flash-1.5',
];

export function renderSettings(mount: HTMLElement): () => void {
  const s = loadSettings();

  const wrap = document.createElement('div');
  wrap.className = 'z-settings';
  wrap.innerHTML = `
    <h1 class="z-page__title">Settings</h1>
    <p class="z-page__lead">
      Stored in this browser only. For server-wide defaults, set them in <code>.env</code>.
    </p>

    <section class="z-settings__card" aria-labelledby="s-appearance">
      <h2 class="z-settings__h" id="s-appearance">Appearance</h2>

      <div class="z-field z-field--row">
        <label for="set-theme">
          <span>Theme</span>
          <small>“System” follows your operating system.</small>
        </label>
        <select id="set-theme">
          ${(['system', 'light', 'dark'] as Theme[])
            .map((t) => `<option value="${t}" ${s.theme === t ? 'selected' : ''}>${t}</option>`)
            .join('')}
        </select>
      </div>

      <div class="z-field z-field--row">
        <label for="set-per-page">
          <span>Results per page</span>
          <small>Between 10 and 100.</small>
        </label>
        <input id="set-per-page" type="number" min="10" max="100" step="10" value="${s.resultsPerPage}" />
      </div>
    </section>

    <section class="z-settings__card" aria-labelledby="s-search">
      <h2 class="z-settings__h" id="s-search">Search</h2>
      <div class="z-field z-field--row">
        <label for="set-semantic">
          <span>Semantic search</span>
          <small>Hybrid vector search. Needs an embedding provider (<code>EMBED_PROVIDER</code>).</small>
        </label>
        <label class="z-switch"><input type="checkbox" id="set-semantic" ${s.semantic ? 'checked' : ''}><span></span></label>
      </div>
    </section>

    <section class="z-settings__card" aria-labelledby="s-ai">
      <h2 class="z-settings__h" id="s-ai">AI overview</h2>

      <div class="z-field z-field--row">
        <label for="set-overview">
          <span>Show AI overview</span>
          <small>Summarizes the top curated results above the list.</small>
        </label>
        <label class="z-switch"><input type="checkbox" id="set-overview" ${s.overview ? 'checked' : ''}><span></span></label>
      </div>

      <div class="z-field">
        <label for="set-llm"><span>Provider</span></label>
        <select id="set-llm">
          <option value="none" ${s.llmProvider === 'none' ? 'selected' : ''}>None (disabled)</option>
          <option value="ollama" ${s.llmProvider === 'ollama' ? 'selected' : ''}>Ollama (local)</option>
          <option value="openrouter" ${s.llmProvider === 'openrouter' ? 'selected' : ''}>OpenRouter (cloud)</option>
        </select>
      </div>

      <div class="z-field" data-provider="ollama" ${s.llmProvider === 'ollama' ? '' : 'hidden'}>
        <label for="set-ollama-model"><span>Model</span> <small id="ollama-status">loading…</small></label>
        <select id="set-ollama-model"></select>
        <input id="set-ollama-custom" placeholder="Custom model name…"
               value="${escapeHtml(OLLAMA_PRESETS.includes(s.ollamaModel) ? '' : s.ollamaModel)}" />
      </div>

      <div class="z-field" data-provider="openrouter" ${s.llmProvider === 'openrouter' ? '' : 'hidden'}>
        <label for="set-or-model"><span>Model</span> <small id="or-status">loading…</small></label>
        <select id="set-or-model"></select>
        <input id="set-or-custom" placeholder="Custom model name…"
               value="${escapeHtml(OPENROUTER_PRESETS.includes(s.openrouterModel) ? '' : s.openrouterModel)}" />
        <label for="set-or-key"><span>API key</span></label>
        <input type="password" id="set-or-key" placeholder="sk-or-…" autocomplete="off"
               value="${escapeHtml(s.openrouterKey)}" />
      </div>
    </section>

    <section class="z-settings__card" aria-labelledby="s-admin">
      <h2 class="z-settings__h" id="s-admin">Admin access</h2>
      <div class="z-field">
        <label for="set-admin-key">
          <span>Admin key</span>
          <small>
            Required to manage sources and start crawls. Must match
            <code>ZWEP_ADMIN_KEY</code> on the server. Sent as a header, never in a URL.
          </small>
        </label>
        <input type="password" id="set-admin-key" placeholder="zwep_admin_dev_key" autocomplete="off"
               value="${escapeHtml(s.adminKey)}" />
      </div>
      <p class="z-settings__status" id="admin-status" role="status"></p>
    </section>
  `;
  mount.appendChild(wrap);

  const $ = <T extends HTMLElement>(sel: string) => wrap.querySelector<T>(sel)!;
  const status = $('#admin-status');

  /** Read the form into a settings patch and persist it. */
  const persist = (): ZwepSettings => {
    const next = saveSettings({
      theme: $<HTMLSelectElement>('#set-theme').value as Theme,
      resultsPerPage: clamp(Number($<HTMLInputElement>('#set-per-page').value), 10, 100),
      semantic: $<HTMLInputElement>('#set-semantic').checked,
      overview: $<HTMLInputElement>('#set-overview').checked,
      llmProvider: $<HTMLSelectElement>('#set-llm').value as LlmProvider,
      ollamaModel: pick('#set-ollama-model', '#set-ollama-custom', s.ollamaModel),
      openrouterModel: pick('#set-or-model', '#set-or-custom', s.openrouterModel),
      openrouterKey: $<HTMLInputElement>('#set-or-key').value.trim(),
      adminKey: $<HTMLInputElement>('#set-admin-key').value.trim(),
    });
    applyTheme(next.theme);
    return next;
  };

  const pick = (selectSel: string, customSel: string, fallback: string): string => {
    const custom = wrap.querySelector<HTMLInputElement>(customSel)?.value.trim();
    if (custom) return custom;
    const chosen = wrap.querySelector<HTMLSelectElement>(selectSel)?.value;
    return chosen && chosen !== '__custom' ? chosen : fallback;
  };

  /**
   * Push LLM settings to the server.
   *
   * The endpoint is admin-gated, so without a key we say so plainly instead of
   * failing silently — the old UI looked like it had saved when it had not.
   */
  const sync = async (next: ZwepSettings) => {
    if (next.llmProvider === 'none') {
      status.textContent = '';
      return;
    }
    if (!next.adminKey) {
      status.textContent = 'Enter the admin key to apply AI settings on the server.';
      status.className = 'z-settings__status is-warn';
      return;
    }
    try {
      await pushSettings(next.adminKey, {
        llmProvider: next.llmProvider,
        ollamaLlmModel: next.ollamaModel,
        openrouterLlmModel: next.openrouterModel,
        openrouterLlmKey: next.openrouterKey,
      });
      status.textContent = `Server is using ${next.llmProvider}.`;
      status.className = 'z-settings__status is-ok';
    } catch (e) {
      status.textContent = `Could not apply on the server: ${(e as Error).message}`;
      status.className = 'z-settings__status is-error';
    }
  };

  const onChange = () => void sync(persist());

  for (const sel of [
    '#set-theme',
    '#set-per-page',
    '#set-semantic',
    '#set-overview',
    '#set-ollama-model',
    '#set-ollama-custom',
    '#set-or-model',
    '#set-or-custom',
    '#set-or-key',
    '#set-admin-key',
  ]) {
    const node = wrap.querySelector(sel)!;
    node.addEventListener('change', onChange);
    node.addEventListener('input', onChange);
  }

  $('#set-llm').addEventListener('change', () => {
    const value = $<HTMLSelectElement>('#set-llm').value;
    wrap.querySelectorAll<HTMLElement>('[data-provider]').forEach((node) => {
      node.hidden = node.dataset.provider !== value;
    });
  });

  void fillModelDropdowns(wrap, s);

  return () => wrap.remove();
}

function clamp(n: number, min: number, max: number): number {
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : min;
}

function optionsHtml(
  models: ModelInfo[],
  presets: string[],
  selected: string,
  label: (m: ModelInfo) => string,
) {
  const known = new Set(models.map((m) => m.id));
  const fromApi = models.map(
    (m) =>
      `<option value="${escapeHtml(m.id)}" ${m.id === selected ? 'selected' : ''}>${escapeHtml(label(m))}</option>`,
  );
  const extra = presets
    .filter((p) => !known.has(p))
    .map(
      (p) =>
        `<option value="${escapeHtml(p)}" ${p === selected ? 'selected' : ''}>${escapeHtml(p)}</option>`,
    );
  const custom = !known.has(selected) && !presets.includes(selected);
  return [
    ...fromApi,
    ...extra,
    `<option value="__custom" ${custom ? 'selected' : ''}>Custom…</option>`,
  ].join('');
}

/** Fill the provider dropdowns from the live model lists, with a preset fallback. */
async function fillModelDropdowns(wrap: HTMLElement, s: ZwepSettings): Promise<void> {
  const ollamaSel = wrap.querySelector<HTMLSelectElement>('#set-ollama-model');
  const ollamaStatus = wrap.querySelector<HTMLElement>('#ollama-status');
  if (ollamaSel) {
    const models = await ollamaModels();
    ollamaSel.innerHTML = optionsHtml(models, OLLAMA_PRESETS, s.ollamaModel, (m) =>
      m.size ? `${m.name} (${(m.size / 1e9).toFixed(1)} GB)` : m.name,
    );
    if (ollamaStatus) {
      ollamaStatus.textContent = models.length
        ? `${models.length} installed locally`
        : 'Ollama not reachable — showing presets';
    }
  }

  const orSel = wrap.querySelector<HTMLSelectElement>('#set-or-model');
  const orStatus = wrap.querySelector<HTMLElement>('#or-status');
  if (orSel) {
    const models = await openrouterModels();
    orSel.innerHTML = optionsHtml(models, OPENROUTER_PRESETS, s.openrouterModel, (m) =>
      m.context_length ? `${m.name} (${m.context_length.toLocaleString()} ctx)` : m.name,
    );
    if (orStatus) {
      orStatus.textContent = models.length
        ? `${models.length} available`
        : 'OpenRouter not reachable — showing presets';
    }
  }
}
