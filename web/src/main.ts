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

// ---------- Header ----------
const header = document.createElement('header');
header.className = 'z-header';
header.innerHTML = `
  <div class="z-header__brand">
    <span class="z-header__mark">Z</span>
    <span>Zwep</span>
  </div>
  <div class="z-header__actions">
    <a class="z-header__link" id="nav-admin" href="/admin">Admin</a>
    <button class="z-icon-btn" id="theme-toggle" aria-label="Toggle theme">
      <span id="theme-icon"></span>
    </button>
  </div>
`;
root.appendChild(header);

const themeToggle = header.querySelector('#theme-toggle') as HTMLButtonElement;
const themeIcon = header.querySelector('#theme-icon') as HTMLSpanElement;
function paintIcon() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  themeIcon.textContent = dark ? '☀' : '☾';
}
paintIcon();
themeToggle.addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  paintIcon();
});

// ---------- Main ----------
const main = document.createElement('main');
main.className = 'z-main';
root.appendChild(main);

// ---------- Result list (always present, below) ----------
const results = new ResultList();
root.appendChild(results.el);

// ---------- Search state ----------
const state = { q: '', offset: 0, loading: false };

function renderHome() {
  main.className = 'z-main';
  main.innerHTML = `
    <div class="z-home">
      <h1 class="z-home__title">Zwep</h1>
      <p class="z-home__subtitle">A small, self-hosted search engine. Search what you curate.</p>
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
function route() {
  const path = location.pathname;
  if (path.startsWith('/admin')) {
    const admin = new AdminView();
    results.el.style.display = 'none';
    main.style.display = 'none';
    root.appendChild(admin.el);
    admin.mount().catch(() => {});
    // clean up on navigation away
    window.addEventListener('popstate', () => admin.unmount(), { once: true });
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

// intercept Admin link to use SPA-style nav (no full reload)
header.querySelector('#nav-admin')!.addEventListener('click', (e) => {
  e.preventDefault();
  history.pushState({}, '', '/admin');
  route();
});

// show indexed count in subtitle after stats resolves
stats()
  .then((s) => {
    const sub = main.querySelector('.z-home__subtitle');
    if (sub && s.ok) sub.textContent = `${s.indexed} documents indexed. Search what you curate.`;
  })
  .catch(() => {});
