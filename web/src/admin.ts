import type { SourceConfig, CrawlTask } from '@zwep/shared';
import {
  adminConfig,
  adminCrawl,
  adminCrawlAll,
  adminCrawlAllStatus,
  adminCrawlStatus,
  adminCrawlUrl,
  adminDeindexAll,
  adminDeleteSource,
  adminListSources,
  adminUpsertSource,
  ApiError,
  type AdminConfig,
} from './client.ts';
import { Disposables, escapeHtml, trapFocus } from './dom.ts';
import { loadSettings } from './settings.ts';

/**
 * Library — the source management console (formerly "Admin").
 *
 * Every mutation is optimistic-free: the UI re-reads the server after a change
 * rather than assuming success, because sources are the one piece of state a
 * wrong assumption would silently corrupt.
 */
export class LibraryView {
  readonly el: HTMLDivElement;
  private sources: SourceConfig[] = [];
  private config: AdminConfig | null = null;
  private disposables = new Disposables();
  private poll?: ReturnType<typeof setInterval>;
  private toastTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'z-library';
  }

  private get adminKey(): string {
    return loadSettings().adminKey;
  }

  async mount(): Promise<void> {
    if (!this.adminKey) return this.renderKeyPrompt();
    this.renderShell();
    await this.load();
  }

  destroy(): void {
    this.stopPolling();
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.disposables.dispose();
  }

  private stopPolling(): void {
    if (this.poll) clearInterval(this.poll);
    this.poll = undefined;
  }

  /** Shown when no admin key is configured — the most common first-run wall. */
  private renderKeyPrompt(): void {
    this.el.innerHTML = `
      <div class="z-empty z-empty--card">
        <h1 class="z-empty__title">Admin key required</h1>
        <p>
          Managing sources and starting crawls needs the key set as
          <code>ZWEP_ADMIN_KEY</code> on the server (default in development:
          <code>zwep_admin_dev_key</code>).
        </p>
        <a class="z-btn z-btn--primary" href="/settings" data-route="/settings">Open Settings →</a>
      </div>`;
  }

  private async load(): Promise<void> {
    const body = this.el.querySelector('.z-library__body');
    try {
      this.config = await adminConfig(this.adminKey);
    } catch (e) {
      this.config = null;
      if (e instanceof ApiError && e.status === 401) {
        if (body) {
          body.innerHTML = `<div class="z-error" role="alert">
            <div class="z-error__body">
              <div class="z-error__msg">The admin key was rejected.</div>
              <p class="z-error__hint">Update it in <a href="/settings" data-route="/settings">Settings</a>.</p>
            </div>
          </div>`;
        }
        return;
      }
    }
    try {
      this.sources = await adminListSources(this.adminKey);
    } catch (e) {
      this.sources = [];
      if (body) {
        body.innerHTML = `<div class="z-error" role="alert">
          <div class="z-error__body"><div class="z-error__msg">${escapeHtml((e as Error).message)}</div></div>
        </div>`;
      }
      return;
    }
    // The Google banner depends on config, so the header is painted after the
    // fetch — the old version rendered it first and always claimed "disabled".
    this.renderHeader();
    this.renderTable();
  }

  private renderShell(): void {
    this.el.innerHTML = `
      <div class="z-library__head" id="library-head"></div>
      <div class="z-library__body"></div>
      <div class="z-toast" id="library-toast" role="status" aria-live="polite" hidden></div>
      <div class="z-library__task" id="library-task" hidden></div>
    `;
  }

  private renderHeader(): void {
    const head = this.el.querySelector('#library-head')!;
    const gp = this.config?.googleProxyEnabled;
    head.innerHTML = `
      <h1 class="z-page__title">Library</h1>
      <p class="z-page__lead">
        Zwep only searches what is listed here. ${this.sources.length} source${this.sources.length === 1 ? '' : 's'},
        ${this.sources.filter((s) => s.enabled !== false).length} active.
      </p>

      <div class="z-library__actions">
        <button class="z-btn z-btn--primary" data-act="new">+ New source</button>
        <button class="z-btn" data-act="crawl-all">⚡ Crawl all active</button>
        <button class="z-btn" data-act="activate-all">Activate all</button>
        <button class="z-btn" data-act="deactivate-all">Deactivate all</button>
        <button class="z-btn z-btn--danger" data-act="deindex">Clear index</button>
      </div>

      <form class="z-library__quick" data-act="crawl-url-form">
        <label class="z-sr-only" for="crawl-url">URL to index</label>
        <input id="crawl-url" type="url" placeholder="https://example.com/article — index a single page" required />
        <button class="z-btn z-btn--primary" type="submit">Index URL</button>
      </form>

      <div class="z-banner ${gp ? 'z-banner--warn' : 'z-banner--ok'}">
        ${
          gp
            ? '⚠ Google proxy is <strong>enabled</strong> — crawling a google-type source sends your queries to Google.'
            : '✓ Google proxy is <strong>disabled</strong> (the privacy default). Set <code>GOOGLE_PROXY_ENABLED=true</code> to allow google-type sources.'
        }
      </div>`;

    head.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!btn || btn.tagName === 'FORM') return;
      switch (btn.dataset.act) {
        case 'new':
          return this.openEditor(null);
        case 'crawl-all':
          return void this.crawlAll();
        case 'activate-all':
          return void this.setAllEnabled(true);
        case 'deactivate-all':
          return void this.setAllEnabled(false);
        case 'deindex':
          return void this.deindexAll();
      }
    });

    head.querySelector<HTMLFormElement>('[data-act="crawl-url-form"]')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = head.querySelector<HTMLInputElement>('#crawl-url')!;
      const url = input.value.trim();
      if (!url) return;
      input.value = '';
      void this.crawlUrl(url);
    });
  }

  private renderTable(): void {
    const body = this.el.querySelector('.z-library__body')!;
    if (!this.sources.length) {
      body.innerHTML = `
        <div class="z-empty z-empty--card">
          <h2 class="z-empty__title">No sources yet</h2>
          <p>A source is a set of seed URLs plus the domains the crawler may follow.</p>
          <button class="z-btn z-btn--primary" data-row-act="new">Add your first source</button>
        </div>`;
    } else {
      body.innerHTML = `
        <table class="z-table">
          <caption class="z-sr-only">Curated sources</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Active</th>
              <th scope="col">Type</th>
              <th scope="col">Domains</th>
              <th scope="col" class="z-table__num">Seeds</th>
              <th scope="col" class="z-table__num">Max pages</th>
              <th scope="col"><span class="z-sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            ${this.sources.map((s) => this.rowHtml(s)).join('')}
          </tbody>
        </table>`;
    }

    body.addEventListener('change', (e) => {
      const toggle = (e.target as HTMLElement).closest<HTMLInputElement>('[data-row-act="toggle"]');
      if (!toggle) return;
      void this.toggleSource(toggle.dataset.name!, toggle.checked);
    });

    body.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-row-act]');
      if (!btn || btn.dataset.rowAct === 'toggle') return;
      const name = btn.dataset.name ?? '';
      switch (btn.dataset.rowAct) {
        case 'new':
          return this.openEditor(null);
        case 'crawl':
          return void this.triggerCrawl(name);
        case 'edit':
          return this.openEditor(this.sources.find((s) => s.name === name) ?? null);
        case 'delete':
          return void this.deleteSource(name);
      }
    });
  }

  private rowHtml(s: SourceConfig): string {
    const on = s.enabled !== false;
    const name = escapeHtml(s.name);
    return `
      <tr>
        <th scope="row">
          <strong>${escapeHtml(s.label || s.name)}</strong>
          ${s.label ? `<small class="z-table__sub">${name}</small>` : ''}
        </th>
        <td>
          <label class="z-switch z-switch--sm">
            <input type="checkbox" data-row-act="toggle" data-name="${name}" ${on ? 'checked' : ''}
                   aria-label="${on ? 'Deactivate' : 'Activate'} ${name}">
            <span></span>
          </label>
        </td>
        <td><span class="z-chip">${escapeHtml(s.type ?? 'web')}</span></td>
        <td>${(s.allowedDomains ?? []).map((d) => `<span class="z-chip">${escapeHtml(d)}</span>`).join(' ')}</td>
        <td class="z-table__num">${s.seeds?.length ?? 0}</td>
        <td class="z-table__num">${s.maxPages ?? '—'}</td>
        <td class="z-table__actions">
          <button class="z-btn z-btn--sm" data-row-act="crawl" data-name="${name}">Crawl</button>
          <button class="z-btn z-btn--sm" data-row-act="edit" data-name="${name}">Edit</button>
          <button class="z-btn z-btn--sm z-btn--danger" data-row-act="delete" data-name="${name}">Delete</button>
        </td>
      </tr>`;
  }

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  private async toggleSource(name: string, enabled: boolean): Promise<void> {
    const src = this.sources.find((s) => s.name === name);
    if (!src) return;
    try {
      await adminUpsertSource(this.adminKey, { ...src, enabled });
      this.toast(`${name} is now ${enabled ? 'active — included in search' : 'inactive — excluded from search'}`);
    } catch (e) {
      this.toast((e as Error).message, 'error');
    }
    await this.load();
  }

  private async setAllEnabled(enabled: boolean): Promise<void> {
    const targets = this.sources.filter((s) => (s.enabled !== false) !== enabled);
    if (!targets.length) {
      return this.toast(`All sources are already ${enabled ? 'active' : 'inactive'}.`);
    }
    this.toast(`Updating ${targets.length} source${targets.length === 1 ? '' : 's'}…`);
    const settled = await Promise.allSettled(
      targets.map((s) => adminUpsertSource(this.adminKey, { ...s, enabled })),
    );
    const failed = settled.filter((r) => r.status === 'rejected').length;
    this.toast(
      failed
        ? `${settled.length - failed} updated, ${failed} failed`
        : `${settled.length} source${settled.length === 1 ? '' : 's'} ${enabled ? 'activated' : 'deactivated'}`,
      failed ? 'error' : 'ok',
    );
    await this.load();
  }

  private async triggerCrawl(name: string): Promise<void> {
    try {
      const taskId = await adminCrawl(this.adminKey, name, 50);
      this.toast(`Crawl started for “${name}”`);
      this.pollTask(taskId);
    } catch (e) {
      this.toast((e as Error).message, 'error');
    }
  }

  private async crawlAll(): Promise<void> {
    const active = this.sources.filter((s) => s.enabled !== false);
    if (!active.length) return this.toast('No active sources to crawl.', 'error');
    const ok = await this.confirm(
      'Crawl all active sources?',
      `${active.length} source${active.length === 1 ? '' : 's'} will be crawled sequentially in the background. ` +
        'You can keep using Zwep while it runs.',
      'Start crawl',
    );
    if (!ok) return;
    try {
      const { batchId, count } = await adminCrawlAll(this.adminKey);
      this.toast(`Crawling ${count} sources in the background…`);
      this.pollBatch(batchId);
    } catch (e) {
      this.toast((e as Error).message, 'error');
    }
  }

  private async deindexAll(): Promise<void> {
    const ok = await this.confirm(
      'Delete every indexed document?',
      'Sources stay configured, but the search index is emptied. You will need to crawl again. ' +
        'This cannot be undone.',
      'Clear index',
      true,
    );
    if (!ok) return;
    try {
      const r = await adminDeindexAll(this.adminKey);
      this.toast(r.message);
    } catch (e) {
      this.toast((e as Error).message, 'error');
    }
    await this.load();
  }

  private async crawlUrl(url: string): Promise<void> {
    try {
      const { taskId, source } = await adminCrawlUrl(this.adminKey, url);
      this.toast(`Indexing ${url} as “${source}”…`);
      this.pollTask(taskId);
      await this.load();
    } catch (e) {
      this.toast((e as Error).message, 'error');
    }
  }

  private async deleteSource(name: string): Promise<void> {
    const ok = await this.confirm(
      `Delete source “${name}”?`,
      'The source configuration is removed. Its already-indexed documents are also purged from the index.',
      'Delete',
      true,
    );
    if (!ok) return;
    try {
      await adminDeleteSource(this.adminKey, name, true);
      this.toast(`Deleted “${name}”`);
    } catch (e) {
      this.toast((e as Error).message, 'error');
    }
    await this.load();
  }

  // -------------------------------------------------------------------------
  // Task progress
  // -------------------------------------------------------------------------

  private pollTask(taskId: string): void {
    this.stopPolling();
    const tick = async () => {
      try {
        const task = await adminCrawlStatus(this.adminKey, taskId);
        this.renderTask(task);
        if (task.status === 'running') return;
        this.stopPolling();
        if (task.status === 'done') {
          const s = task.summary!;
          this.toast(`Crawl finished: ${s.indexed} indexed, ${s.pages} fetched, ${s.failed} failed`);
        } else {
          this.toast(`Crawl failed: ${task.error}`, 'error');
        }
        await this.load();
      } catch (e) {
        // A 404 means the task expired; anything else is likely transient.
        if (e instanceof ApiError && e.status === 404) {
          this.stopPolling();
          this.toast('Lost track of that crawl (the task expired).', 'error');
        }
      }
    };
    void tick();
    this.poll = setInterval(() => void tick(), 1500);
  }

  private pollBatch(batchId: string): void {
    this.stopPolling();
    const tick = async () => {
      try {
        const { batch, done, total } = await adminCrawlAllStatus(this.adminKey, batchId);
        this.renderBatch(batch, done, total);
        if (done < total) return;
        this.stopPolling();
        const failed = batch.filter((t) => t.status === 'error').length;
        const indexed = batch.reduce((n, t) => n + (t.summary?.indexed ?? 0), 0);
        this.toast(
          failed
            ? `Batch finished with ${failed} failure${failed === 1 ? '' : 's'} · ${indexed} indexed`
            : `Batch complete — ${indexed} documents indexed from ${total} sources`,
          failed ? 'error' : 'ok',
        );
        await this.load();
      } catch {
        /* keep polling through a transient failure */
      }
    };
    void tick();
    this.poll = setInterval(() => void tick(), 2500);
  }

  private renderTask(task: CrawlTask): void {
    const box = this.el.querySelector<HTMLElement>('#library-task');
    if (!box) return;
    box.hidden = false;
    const detail =
      task.status === 'running'
        ? '<span class="z-spinner" aria-hidden="true"></span> running…'
        : task.status === 'done'
          ? `✓ ${task.summary?.indexed ?? 0} indexed · ${task.summary?.pages ?? 0} fetched · ${task.summary?.seconds ?? 0}s`
          : `✗ ${escapeHtml(task.error ?? 'error')}`;
    box.innerHTML = `<div class="z-task__row"><strong>${escapeHtml(task.source)}</strong> · ${detail}</div>`;
  }

  private renderBatch(batch: CrawlTask[], done: number, total: number): void {
    const box = this.el.querySelector<HTMLElement>('#library-task');
    if (!box) return;
    box.hidden = false;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const current = batch.find((t) => t.status === 'running');
    box.innerHTML = `
      <div class="z-task__row">
        <strong>Crawling ${total} sources</strong> · ${done}/${total} done
        ${current ? `· ${escapeHtml(current.source)}` : ''}
      </div>
      <div class="z-progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
        <div class="z-progress__bar" style="width:${pct}%"></div>
      </div>`;
  }

  // -------------------------------------------------------------------------
  // Dialogs
  // -------------------------------------------------------------------------

  /** In-app confirmation dialog, replacing the blocking native `confirm()`. */
  private confirm(title: string, message: string, action: string, danger = false): Promise<boolean> {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'z-modal__overlay';
      overlay.innerHTML = `
        <div class="z-modal z-modal--sm" role="dialog" aria-modal="true" aria-labelledby="z-confirm-title">
          <h2 id="z-confirm-title">${escapeHtml(title)}</h2>
          <p>${escapeHtml(message)}</p>
          <div class="z-modal__actions">
            <button class="z-btn" data-confirm="no">Cancel</button>
            <button class="z-btn ${danger ? 'z-btn--danger' : 'z-btn--primary'}" data-confirm="yes">
              ${escapeHtml(action)}
            </button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const release = trapFocus(overlay, () => finish(false));
      const finish = (value: boolean) => {
        release();
        overlay.remove();
        resolve(value);
      };
      overlay.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target === overlay) return finish(false);
        const btn = target.closest<HTMLElement>('[data-confirm]');
        if (btn) finish(btn.dataset.confirm === 'yes');
      });
    });
  }

  private openEditor(src: SourceConfig | null): void {
    const isNew = !src;
    const s: SourceConfig = src ?? {
      name: '',
      type: 'web',
      seeds: [],
      allowedDomains: [],
      maxPages: 50,
    };
    const isGoogle = s.type === 'google';
    const googleBlocked = !this.config?.googleProxyEnabled;

    const overlay = document.createElement('div');
    overlay.className = 'z-modal__overlay';
    overlay.innerHTML = `
      <form class="z-modal" role="dialog" aria-modal="true" aria-labelledby="z-editor-title">
        <h2 id="z-editor-title">${isNew ? 'New source' : `Edit “${escapeHtml(s.name)}”`}</h2>

        <label class="z-field">
          <span>Name</span>
          <small>Letters, digits, dot, dash or underscore. Used as the source id.</small>
          <input id="f-name" value="${escapeHtml(s.name)}" ${isNew ? 'required' : 'readonly'}
                 pattern="[a-zA-Z0-9][a-zA-Z0-9._\\-]*" maxlength="64" />
        </label>

        <label class="z-field">
          <span>Display label <small>(optional)</small></span>
          <input id="f-label" value="${escapeHtml(s.label ?? '')}" maxlength="120" />
        </label>

        <label class="z-field">
          <span>Type</span>
          <select id="f-type">
            <option value="web" ${!isGoogle ? 'selected' : ''}>web — crawl seed URLs</option>
            <option value="google" ${isGoogle ? 'selected' : ''} ${googleBlocked ? 'disabled' : ''}>
              google — run queries through Google${googleBlocked ? ' (disabled on the server)' : ''}
            </option>
          </select>
        </label>

        <div data-kind="web" ${isGoogle ? 'hidden' : ''}>
          <label class="z-field">
            <span>Seed URLs</span>
            <small>One per line. The crawl starts here.</small>
            <textarea id="f-seeds" rows="3" spellcheck="false">${escapeHtml((s.seeds ?? []).join('\n'))}</textarea>
          </label>
        </div>

        <div data-kind="google" ${isGoogle ? '' : 'hidden'}>
          <label class="z-field">
            <span>Queries</span>
            <small>One per line. Each is sent to Google; the result pages are then crawled.</small>
            <textarea id="f-queries" rows="3">${escapeHtml((s.queries ?? []).join('\n'))}</textarea>
          </label>
          <p class="z-hint z-hint--warn">
            ⚠ These queries leave your machine. The Google proxy is opt-in on the server.
          </p>
        </div>

        <label class="z-field">
          <span>Allowed domains</span>
          <small>Comma-separated. The crawler never leaves this list. Empty = the seeds' own hosts.</small>
          <textarea id="f-domains" rows="2" spellcheck="false">${escapeHtml((s.allowedDomains ?? []).join(', '))}</textarea>
        </label>

        <label class="z-field">
          <span>Sitemap URL <small>(optional)</small></span>
          <input id="f-sitemap" type="url" value="${escapeHtml(s.sitemap ?? '')}" />
        </label>

        <div class="z-field__grid">
          <label class="z-field">
            <span>Max pages</span>
            <input id="f-max" type="number" min="1" max="1000000" value="${s.maxPages ?? 50}" />
          </label>
          <label class="z-field">
            <span>Max depth</span>
            <input id="f-depth" type="number" min="0" max="10" value="${s.maxDepth ?? 4}" />
          </label>
        </div>

        <div class="z-modal__actions">
          <button class="z-btn" type="button" data-editor="cancel">Cancel</button>
          <button class="z-btn z-btn--primary" type="submit">${isNew ? 'Create source' : 'Save changes'}</button>
        </div>
        <p class="z-error__msg" id="editor-err" hidden></p>
      </form>`;

    document.body.appendChild(overlay);
    const release = trapFocus(overlay, close);
    function close() {
      release();
      overlay.remove();
    }

    const typeSel = overlay.querySelector<HTMLSelectElement>('#f-type')!;
    typeSel.addEventListener('change', () => {
      const google = typeSel.value === 'google';
      overlay.querySelector<HTMLElement>('[data-kind="google"]')!.hidden = !google;
      overlay.querySelector<HTMLElement>('[data-kind="web"]')!.hidden = google;
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
      if ((e.target as HTMLElement).closest('[data-editor="cancel"]')) close();
    });

    overlay.querySelector('form')!.addEventListener('submit', async (e) => {
      e.preventDefault();
      const val = (sel: string) => overlay.querySelector<HTMLInputElement | HTMLTextAreaElement>(sel)!.value;
      const lines = (sel: string) =>
        val(sel)
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean);
      const type = typeSel.value as 'web' | 'google';

      // `enabled` is carried over explicitly: dropping it here is what used to
      // silently re-activate a source the moment you edited anything else.
      const payload: SourceConfig = {
        ...s,
        name: val('#f-name').trim(),
        label: val('#f-label').trim() || undefined,
        type,
        seeds: type === 'web' ? lines('#f-seeds') : (s.seeds ?? []),
        queries: type === 'google' ? lines('#f-queries') : undefined,
        allowedDomains: val('#f-domains')
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean),
        sitemap: val('#f-sitemap').trim() || undefined,
        maxPages: Number(val('#f-max')) || undefined,
        maxDepth: Number.isFinite(Number(val('#f-depth'))) ? Number(val('#f-depth')) : undefined,
        enabled: s.enabled,
      };

      const err = overlay.querySelector<HTMLElement>('#editor-err')!;
      try {
        await adminUpsertSource(this.adminKey, payload);
        close();
        this.toast(`Saved “${payload.name}”`);
        await this.load();
      } catch (e2) {
        err.hidden = false;
        err.textContent = (e2 as Error).message;
      }
    });
  }

  private toast(message: string, kind: 'ok' | 'error' = 'ok'): void {
    const t = this.el.querySelector<HTMLElement>('#library-toast');
    if (!t) return;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    t.hidden = false;
    t.textContent = message;
    t.className = `z-toast is-visible${kind === 'error' ? ' is-error' : ''}`;
    this.toastTimer = setTimeout(() => {
      t.hidden = true;
      t.className = 'z-toast';
    }, 4000);
  }
}

/** Backwards-compatible alias for the old class name. */
export { LibraryView as AdminView };
