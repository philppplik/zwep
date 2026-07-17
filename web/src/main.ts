import './styles/tokens.css';
import './styles/app.css';
import { SearchBar, ResultList, renderGraph, renderOverview } from './components.ts';
import { search, suggest, graph, overview, ollamaModels, openrouterModels, type ModelInfo } from './client.ts';
import { AdminView } from './admin.ts';
import { stats } from './client.ts';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const root = document.getElementById('app')!;

// ---------- Theme ----------
const THEME_KEY = 'zwep-theme';
function applyTheme(theme: 'light' | 'dark') {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
}
const saved = (localStorage.getItem(THEME_KEY) as 'light' | 'dark' | null) ?? 'light';
applyTheme(saved);

function paintIcon(btn: HTMLButtonElement) {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  btn.textContent = dark ? '☀' : '☾';
}

// ---------- Top bar (shared across views) ----------
function renderTopBar(opts: { back?: boolean; title?: string } = {}) {
  const bar = document.createElement('div');
  bar.className = 'z-topbar';
  bar.innerHTML = `
    <a class="z-topbar__brand" href="/" data-back>
      <img class="z-topbar__logo" src="/zwep-logo.png" alt="Zwep" />
      <span>Zwep</span>
    </a>
    ${opts.back ? '<button class="z-topbar__back" data-back>← Search</button>' : ''}
    ${opts.title ? `<span class="z-topbar__title">${escapeHtml(opts.title)}</span>` : ''}
  `;
  bar.querySelector('[data-back]')!.addEventListener('click', (e) => {
    e.preventDefault();
    history.pushState({}, '', '/');
    route();
  });
  return bar;
}
const main = document.createElement('main');
main.className = 'z-main';
root.appendChild(main);

// ---------- Footer ----------
const footer = document.createElement('footer');
footer.className = 'z-footer';
footer.innerHTML = `
  <span class="z-footer__tag">A small, self-hosted search engine. Search what you curate.</span>
  <nav class="z-footer__nav">
    <a class="z-footer__link" id="nav-admin" href="/admin">Admin</a>
    <a class="z-footer__link" id="nav-settings" href="/settings">Settings</a>
  </nav>
`;
root.appendChild(footer);

// ---------- Result list (always present, below) ----------
const results = new ResultList();
root.appendChild(results.el);

// ---------- Search state ----------
const state = { q: '', offset: 0, loading: false, type: '' as string, semantic: false, fuzzy: true };

function renderHome() {
  main.className = 'z-main z-main--center';
  main.innerHTML = `
    <div class="z-hero">
      <img class="z-hero__logo" src="/zwep-logo.png" alt="Zwep" />
      <h1 class="z-hero__title">Zwep</h1>
    </div>
  `;
  main.appendChild(searchBar.el);
  results.el.style.display = 'none';
  searchBar.focus();
}
const TABS = [
  { id: '', label: 'All' },
  { id: 'article', label: 'Articles' },
  { id: 'image', label: 'Images' },
  { id: 'video', label: 'Videos' },
  { id: 'product', label: 'Products' },
  { id: 'graph', label: 'Graph' },
];

function renderResultsView() {
  main.className = 'z-main';
  main.innerHTML = '';
  // logo above the search input bar (Google-style: brand sits on top)
  const brand = document.createElement('div');
  brand.className = 'z-results__brand';
  brand.innerHTML = `
    <img class="z-results__logo" src="/zwep-logo.png" alt="Zwep" />
    <span>Zwep</span>
  `;
  main.appendChild(brand);
  main.appendChild(searchBar.el);
  // tabs (All / Articles / Images / Videos / Products)
  const tabs = document.createElement('div');
  tabs.className = 'z-tabs';
  tabs.innerHTML = TABS.map(
    (t) => `<button class="z-tab${state.type === t.id ? ' is-active' : ''}" type="button" data-type="${t.id}">${t.label}</button>`
  ).join('');
  tabs.querySelectorAll<HTMLButtonElement>('.z-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.type = btn.dataset.type || '';
      if (state.type === 'graph') {
        history.replaceState(null, '', `?q=${encodeURIComponent(state.q)}&view=graph`);
        showGraph();
        return;
      }
      history.replaceState(null, '', `?q=${encodeURIComponent(state.q)}${state.type ? `&type=${state.type}` : ''}`);
      doSearch();
    });
  });
  main.appendChild(tabs);

  // AI Overview container (filled by renderOverview if enabled)
  const overviewBox = document.createElement('div');
  overviewBox.id = 'z-overview';
  overviewBox.className = 'z-overview-wrap';
  main.appendChild(overviewBox);

  results.el.style.display = '';
}

async function showGraph() {
  renderResultsView();
  results.el.style.display = 'none';
  const graphEl = document.createElement('div');
  graphEl.className = 'z-graph-view';
  main.appendChild(graphEl);
  // export button
  const exportBtn = document.createElement('button');
  exportBtn.className = 'z-graph-export';
  exportBtn.type = 'button';
  exportBtn.textContent = '⬇ Export JSON';
  exportBtn.addEventListener('click', () => {
    window.open(`/v1/graph?q=${encodeURIComponent(state.q)}&export=json`, '_blank');
  });
  main.appendChild(exportBtn);
  await renderGraph(graphEl, state.q);
}

const searchBar = new SearchBar(async (q) => {
  state.q = q;
  state.offset = 0;
  history.replaceState(null, '', `?q=${encodeURIComponent(q)}`);
  await doSearch();
});

async function doSearch() {
  if (!state.q.trim()) return;
  renderResultsView();
  results.showSkeleton();
  state.loading = true;
  const settings = loadSettings();
  // AI Overview (parallel, only if enabled)
  const overviewEl = document.getElementById('z-overview');
  if (settings.overview && overviewEl) renderOverview(overviewEl, state.q);
  try {
    const resp = await search({
      q: state.q,
      facets: true,
      limit: 20,
      type: state.type ? [state.type] : undefined,
      semantic: state.semantic || undefined,
      fuzzy: state.fuzzy,
    });
    results.render(resp, state.q);
  } catch (e) {
    const err = e as Error;
    const isNet = err.message.includes('fetch') || err.message.includes('Failed to fetch') || err.message.includes('Network');
    const friendly = isNet
      ? 'Cannot reach the search service. Is the API running?'
      : err.message || 'Something went wrong while searching.';
    results.setError(friendly, () => doSearch());
  } finally {
    state.loading = false;
  }
}

// ---------- Boot / routing ----------
function clearOverlay() {
  root.querySelectorAll('.z-overlay-page').forEach((n) => n.remove());
  main.style.display = '';
  results.el.style.display = '';
}

// ---------- Settings (persisted in localStorage) ----------
interface ZwepSettings {
  theme: 'light' | 'dark';
  semantic: boolean;
  overview: boolean;
  llmProvider: 'ollama' | 'openrouter' | 'none';
  ollamaModel: string;
  openrouterModel: string;
  openrouterKey: string;
}
const SETTINGS_KEY = 'zwep.settings';
const DEFAULT_SETTINGS: ZwepSettings = {
  theme: 'light',
  semantic: false,
  overview: false,
  llmProvider: 'none',
  ollamaModel: 'llama3.1',
  openrouterModel: 'openai/gpt-4o-mini',
  openrouterKey: '',
};
function loadSettings(): ZwepSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_SETTINGS };
}
function saveSettings(s: ZwepSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

const OLLAMA_PRESETS = ['llama3.1', 'llama3.1:70b', 'qwen2.5', 'mistral', 'phi3'];
const OR_PRESETS = ['openai/gpt-4o-mini', 'openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'meta-llama/llama-3.1-70b-instruct', 'google/gemini-flash-1.5'];

function renderSettings() {
  clearOverlay();
  main.style.display = 'none';
  results.el.style.display = 'none';
  const s = loadSettings();
  const wrap = document.createElement('div');
  wrap.className = 'z-overlay-page z-settings';
  wrap.appendChild(renderTopBar({ back: true, title: 'Settings' }));
  const card = document.createElement('div');
  card.className = 'z-settings__card';
  card.innerHTML = `
    <div class="z-field z-field--row">
      <span>Appearance</span>
      <button class="z-btn" id="set-theme">Switch to ${s.theme === 'dark' ? 'light' : 'dark'}</button>
    </div>
    <div class="z-field z-field--row">
      <span>Semantic search <small>Hybrid vector search (needs embedding provider)</small></span>
      <label class="z-switch"><input type="checkbox" id="set-semantic" ${s.semantic ? 'checked' : ''}><span></span></label>
    </div>
    <hr class="z-settings__hr" />
    <h4 class="z-settings__h">AI Overview</h4>
    <div class="z-field z-field--row">
      <span>Enable AI Overview <small>Summarize curated results via LLM</small></span>
      <label class="z-switch"><input type="checkbox" id="set-overview" ${s.overview ? 'checked' : ''}><span></span></label>
    </div>
    <div class="z-field">
      <span>LLM Provider</span>
      <select id="set-llm">
        <option value="none" ${s.llmProvider === 'none' ? 'selected' : ''}>None (disabled)</option>
        <option value="ollama" ${s.llmProvider === 'ollama' ? 'selected' : ''}>Ollama (local)</option>
        <option value="openrouter" ${s.llmProvider === 'openrouter' ? 'selected' : ''}>OpenRouter (cloud)</option>
      </select>
    </div>
    <div class="z-field" data-prev="ollama" style="${s.llmProvider === 'ollama' ? '' : 'display:none'}">
      <span>Ollama Model <small id="ollama-status">loading…</small></span>
      <select id="set-ollama-model"></select>
      <input class="z-settings__custom" id="set-ollama-custom" placeholder="Custom model…" value="${s.ollamaModel && !OLLAMA_PRESETS.includes(s.ollamaModel) ? s.ollamaModel : ''}" />
    </div>
    <div class="z-field" data-prev="openrouter" style="${s.llmProvider === 'openrouter' ? '' : 'display:none'}">
      <span>OpenRouter Model <small id="or-status">loading…</small></span>
      <select id="set-or-model"></select>
      <input class="z-settings__custom" id="set-or-custom" placeholder="Custom model…" value="${s.openrouterModel && !OR_PRESETS.includes(s.openrouterModel) ? s.openrouterModel : ''}" />
      <span>OpenRouter API Key</span>
      <input type="password" id="set-or-key" placeholder="sk-or-…" value="${s.openrouterKey}" />
    </div>
    <p class="z-hint">Settings are stored in your browser (localStorage). For server-wide defaults, set LLM_PROVIDER / OPENROUTER_LLM_KEY in .env.</p>
    <div class="z-field z-field--row">
      <span>Sources</span>
      <a class="z-btn z-btn--primary" href="/admin" data-admin>Manage sources →</a>
    </div>`;
  wrap.appendChild(card);
  root.appendChild(wrap);

  const persist = () => {
    const next: ZwepSettings = {
      ...s,
      semantic: (wrap.querySelector('#set-semantic') as HTMLInputElement).checked,
      overview: (wrap.querySelector('#set-overview') as HTMLInputElement).checked,
      llmProvider: (wrap.querySelector('#set-llm') as HTMLSelectElement).value as ZwepSettings['llmProvider'],
      ollamaModel: customOrSelect(wrap, '#set-ollama-model', '#set-ollama-custom', s.ollamaModel),
      openrouterModel: customOrSelect(wrap, '#set-or-model', '#set-or-custom', s.openrouterModel),
      openrouterKey: (wrap.querySelector('#set-or-key') as HTMLInputElement).value,
    };
    saveSettings(next);
    state.semantic = next.semantic;
    // notify backend: if overview on, push key to .env-less runtime via localStorage only (backend reads .env)
    syncBackendSettings(next);
  };

  wrap.querySelector('#set-theme')!.addEventListener('click', () => {
    const next = s.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    const upd = { ...loadSettings(), theme: next };
    saveSettings(upd);
    renderSettings();
  });
  wrap.querySelector('#set-semantic')!.addEventListener('change', persist);
  wrap.querySelector('#set-overview')!.addEventListener('change', persist);
  wrap.querySelector('#set-llm')!.addEventListener('change', () => {
    const v = (wrap.querySelector('#set-llm') as HTMLSelectElement).value;
    wrap.querySelectorAll('[data-prev]').forEach((el) => {
      (el as HTMLElement).style.display = (el as HTMLElement).dataset.prev === v ? '' : 'none';
    });
    persist();
  });
  wrap.querySelector('#set-ollama-model')!.addEventListener('change', (e) => {
    if ((e.target as HTMLSelectElement).value === '__custom') {
      const c = wrap.querySelector('#set-ollama-custom') as HTMLInputElement;
      c.value = '';
      c.focus();
    }
    persist();
  });
  wrap.querySelector('#set-ollama-custom')!.addEventListener('input', persist);
  wrap.querySelector('#set-or-model')!.addEventListener('change', (e) => {
    if ((e.target as HTMLSelectElement).value === '__custom') {
      const c = wrap.querySelector('#set-or-custom') as HTMLInputElement;
      c.value = '';
      c.focus();
    }
    persist();
  });
  wrap.querySelector('#set-or-key')!.addEventListener('input', persist);
  wrap.querySelector('[data-admin]')!.addEventListener('click', (e) => {
    e.preventDefault();
    history.pushState({}, '', '/admin');
    route();
  });

  // async-load available models into the dropdowns
  loadModelDropdowns(wrap, s);
}

function customOrSelect(wrap: HTMLElement, sel: string, custom: string, fallback: string): string {
  const c = (wrap.querySelector(custom) as HTMLInputElement).value.trim();
  if (c) return c;
  const s = (wrap.querySelector(sel) as HTMLSelectElement).value;
  return s || fallback;
}

/** Fetch installed/free models and populate the provider dropdowns. */
async function loadModelDropdowns(wrap: HTMLElement, s: ZwepSettings) {
  const ollamaSel = wrap.querySelector('#set-ollama-model') as HTMLSelectElement | null;
  const orSel = wrap.querySelector('#set-or-model') as HTMLSelectElement | null;
  const ollamaStatus = wrap.querySelector('#ollama-status') as HTMLElement | null;
  const orStatus = wrap.querySelector('#or-status') as HTMLElement | null;

  // Ollama: locally installed models
  if (ollamaSel) {
    try {
      const models = await ollamaModels();
      if (models.length) {
        const opts = models.map((m) => {
          const selected = m.id === s.ollamaModel ? 'selected' : '';
          const label = m.size ? `${m.name} (${(m.size / 1e9).toFixed(1)}GB)` : m.name;
          return `<option value="${escapeHtml(m.id)}" ${selected}>${escapeHtml(label)}</option>`;
        });
        // keep presets that aren't installed, plus a custom entry
        ollamaSel.innerHTML = opts.join('') + OLLAMA_PRESETS.filter((p) => !models.some((m) => m.id === p)).map((p) => `<option value="${p}" ${p === s.ollamaModel ? 'selected' : ''}>${p}</option>`).join('') + `<option value="__custom" ${!models.some((m) => m.id === s.ollamaModel) && !OLLAMA_PRESETS.includes(s.ollamaModel) ? 'selected' : ''}>Custom…</option>`;
        if (ollamaStatus) ollamaStatus.textContent = `${models.length} installed`;
      } else {
        ollamaSel.innerHTML = OLLAMA_PRESETS.map((p) => `<option value="${p}" ${p === s.ollamaModel ? 'selected' : ''}>${p}</option>`).join('') + `<option value="__custom">Custom…</option>`;
        if (ollamaStatus) ollamaStatus.textContent = 'Ollama offline — presets only';
      }
    } catch {
      if (ollamaStatus) ollamaStatus.textContent = 'unavailable';
    }
  }

  // OpenRouter: all available models
  if (orSel) {
    try {
      const models = await openrouterModels();
      if (models.length) {
        const opts = models.map((m) => {
          const selected = m.id === s.openrouterModel ? 'selected' : '';
          const label = m.context_length ? `${m.name} (${m.context_length.toLocaleString()} ctx)` : m.name;
          return `<option value="${escapeHtml(m.id)}" ${selected}>${escapeHtml(label)}</option>`;
        });
        orSel.innerHTML = opts.join('') + `<option value="__custom" ${!models.some((m) => m.id === s.openrouterModel) && !OR_PRESETS.includes(s.openrouterModel) ? 'selected' : ''}>Custom…</option>`;
        if (orStatus) orStatus.textContent = `${models.length} available`;
      } else {
        orSel.innerHTML = OR_PRESETS.map((p) => `<option value="${p}" ${p === s.openrouterModel ? 'selected' : ''}>${p}</option>`).join('') + `<option value="__custom">Custom…</option>`;
        if (orStatus) orStatus.textContent = 'no models — presets only';
      }
    } catch {
      if (orStatus) orStatus.textContent = 'unavailable';
    }
  }
}

/** Push user LLM settings to the backend at runtime (no restart needed). */
async function syncBackendSettings(s: ZwepSettings) {
  try {
    await fetch('/v1/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        llmProvider: s.llmProvider,
        ollamaLlmModel: s.ollamaModel,
        openrouterLlmModel: s.openrouterModel,
        openrouterLlmKey: s.openrouterKey,
      }),
    });
  } catch {}
}

function route() {
  // tear down any overlay page
  root.querySelectorAll('.z-overlay-page').forEach((n) => n.remove());
  const path = location.pathname;
  if (path.startsWith('/admin')) {
    const admin = new AdminView();
    results.el.style.display = 'none';
    main.style.display = 'none';
    root.appendChild(renderTopBar({ back: true, title: 'Admin' }));
    root.appendChild(admin.el);
    admin.mount().catch(() => {});
    window.addEventListener('popstate', () => admin.unmount(), { once: true });
    return;
  }
  if (path.startsWith('/settings')) {
    renderSettings();
    return;
  }
  main.style.display = '';
  const initialQ = new URLSearchParams(location.search).get('q');
  if (initialQ) {
    searchBar.setValue(initialQ);
    state.q = initialQ;
    const initialType = new URLSearchParams(location.search).get('type');
    state.type = initialType || '';
    doSearch();
  } else {
    renderHome();
  }
}

route();

// apply persisted settings on boot
(function applyBootSettings() {
  const s = loadSettings();
  applyTheme(s.theme);
  state.semantic = s.semantic;
  if (s.llmProvider !== 'none') {
    // push to backend so AI Overview works without .env restart
    syncBackendSettings(s);
  }
})();

footer.querySelector('#nav-admin')!.addEventListener('click', (e) => {
  e.preventDefault();
  history.pushState({}, '', '/admin');
  route();
});
footer.querySelector('#nav-settings')!.addEventListener('click', (e) => {
  e.preventDefault();
  history.pushState({}, '', '/settings');
  route();
});

// show indexed count in footer tag after stats resolves
stats()
  .then((s) => {
    const tag = footer.querySelector('.z-footer__tag');
    if (tag && s.ok) tag.textContent = `${s.indexed} documents indexed. Search what you curate.`;
  })
  .catch(() => {});
