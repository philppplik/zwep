import './styles/tokens.css';
import './styles/app.css';
import { SearchBar, ResultList } from './components.ts';
import { AdminView } from './admin.ts';
import { search, stats } from './client.ts';

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
const state = { q: '', offset: 0, loading: false };

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
  results.showSkeleton();
  state.loading = true;
  try {
    const resp = await search({ q: state.q, facets: true, limit: 20 });
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

function renderSettings() {
  clearOverlay();
  main.style.display = 'none';
  results.el.style.display = 'none';
  const wrap = document.createElement('div');
  wrap.className = 'z-overlay-page z-settings';
  wrap.appendChild(renderTopBar({ back: true, title: 'Settings' }));
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const card = document.createElement('div');
  card.className = 'z-settings__card';
  card.innerHTML = `
      <div class="z-field">
        <span>Appearance</span>
        <button class="z-btn" id="set-theme">Switch to ${dark ? 'light' : 'dark'}</button>
      </div>
      <p class="z-hint">Theme is stored in your browser (localStorage).</p>
      <div class="z-field">
        <span>Sources</span>
        <a class="z-btn z-btn--primary" href="/admin" data-admin>Manage sources →</a>
      </div>`;
  wrap.appendChild(card);
  root.appendChild(wrap);
  wrap.querySelector('#set-theme')!.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    renderSettings();
  });
  wrap.querySelector('[data-admin]')!.addEventListener('click', (e) => {
    e.preventDefault();
    history.pushState({}, '', '/admin');
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
