import './styles/tokens.css';
import './styles/app.css';
import { SearchBar, ResultList } from './components.ts';
import { AdminView } from './admin.ts';
import { search, stats } from './client.ts';

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

// ---------- Main ----------
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
const state = { q: '', offset: 0, loading: false };

function renderHome() {
  main.className = 'z-main';
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

function renderResultsView() {
  main.className = 'z-main';
  main.innerHTML = '';
  main.appendChild(searchBar.el);
  results.el.style.display = '';
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
  results.clearStatus();
  state.loading = true;
  try {
    const resp = await search({ q: state.q, facets: true, limit: 20 });
    results.render(resp, state.q);
  } catch (e) {
    results.setError((e as Error).message || 'Search failed');
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

function renderSettings() {
  clearOverlay();
  main.style.display = 'none';
  results.el.style.display = 'none';
  const wrap = document.createElement('div');
  wrap.className = 'z-overlay-page z-settings';
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  wrap.innerHTML = `
    <div class="z-settings__card">
      <h2>Settings</h2>
      <div class="z-field">
        <span>Appearance</span>
        <button class="z-btn" id="set-theme">Switch to ${dark ? 'light' : 'dark'}</button>
      </div>
      <p class="z-hint">Theme is stored in your browser (localStorage).</p>
      <div class="z-field">
        <span>Sources</span>
        <a class="z-btn z-btn--primary" href="/admin">Manage sources →</a>
      </div>
      <a class="z-footer__link" href="/" id="set-back">← Back to search</a>
    </div>`;
  root.appendChild(wrap);
  wrap.querySelector('#set-theme')!.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    renderSettings();
  });
  wrap.querySelector('#set-back')!.addEventListener('click', (e) => {
    e.preventDefault();
    history.pushState({}, '', '/');
    route();
  });
}

function route() {
  // tear down any overlay page
  root.querySelectorAll('.z-overlay-page').forEach((n) => n.remove());
  const path = location.pathname;
  if (path.startsWith('/admin')) {
    const admin = new AdminView();
    results.el.style.display = 'none';
    main.style.display = 'none';
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
    doSearch();
  } else {
    renderHome();
  }
}

route();

// SPA-style nav for footer links
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
