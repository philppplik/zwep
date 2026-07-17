import type { SourceConfig } from '@zwep/shared';
import {
  adminListSources,
  adminUpsertSource,
  adminDeleteSource,
  adminCrawl,
  adminCrawlStatus,
  adminConfig,
  type CrawlTask,
  type AdminConfig,
} from './client.ts';

const ADMIN_KEY = localStorage.getItem('zwep-admin-key') || 'zwep_admin_dev_key';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export class AdminView {
  readonly el: HTMLDivElement;
  private sources: SourceConfig[] = [];
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private activeTask: CrawlTask | undefined;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'z-admin';
  }

  async mount() {
    this.renderShell();
    await this.load();
  }

  unmount() {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  private config: AdminConfig | undefined;

  private async load() {
    try {
      this.config = await adminConfig(ADMIN_KEY);
    } catch {
      this.config = undefined;
    }
    try {
      this.sources = await adminListSources(ADMIN_KEY);
    } catch (e) {
      this.sources = [];
      this.el.querySelector('.z-admin__body')!.innerHTML = `<div class="z-error">Admin error: ${(e as Error).message}</div>`;
      return;
    }
    this.renderTable();
  }

  private renderShell() {
    const gp = this.config?.googleProxyEnabled;
    const gpBanner = gp
      ? `<div class="z-banner z-banner--warn">⚠ Google proxy is <strong>enabled</strong> — queries are sent to Google when you crawl google-type sources.</div>`
      : `<div class="z-banner z-banner--ok">✓ Google proxy is <strong>disabled</strong> (privacy default). Google-type sources are rejected until you set GOOGLE_PROXY_ENABLED=true.</div>`;
    this.el.innerHTML = `
      <div class="z-admin__head">
        <h2 class="z-admin__title">Sources</h2>
        <div class="z-admin__actions">
          <button class="z-btn z-btn--primary" id="add-source">+ New source</button>
        </div>
      </div>
      ${gpBanner}
      <div class="z-admin__body"></div>
      <div class="z-admin__toast" id="admin-toast" hidden></div>
    `;
    this.el.querySelector('#add-source')!.addEventListener('click', () => this.openEditor(null));
  }

  private renderTable() {
    const body = this.el.querySelector('.z-admin__body')!;
    if (!this.sources.length) {
      body.innerHTML = `<div class="z-empty">No sources yet. Add one to start crawling.</div>`;
      return;
    }
    body.innerHTML = `
      <table class="z-table">
        <thead>
          <tr><th>Name</th><th>Active</th><th>Domains</th><th>Seeds</th><th>Max pages</th><th></th></tr>
        </thead>
        <tbody>
          ${this.sources
            .map(
              (s) => `
            <tr data-name="${escapeHtml(s.name)}">
              <td><strong>${escapeHtml(s.name)}</strong></td>
              <td>
                <label class="z-switch z-switch--sm">
                  <input type="checkbox" data-act="toggle" ${s.enabled !== false ? 'checked' : ''}>
                  <span></span>
                </label>
              </td>
              <td>${s.allowedDomains.map((d) => `<span class="z-chip">${escapeHtml(d)}</span>`).join(' ')}</td>
              <td>${s.seeds.length}</td>
              <td>${s.maxPages ?? '—'}</td>
              <td class="z-table__actions">
                <button class="z-btn z-btn--sm" data-act="crawl">Crawl</button>
                <button class="z-btn z-btn--sm" data-act="edit">Edit</button>
                <button class="z-btn z-btn--sm z-btn--danger" data-act="del">Delete</button>
              </td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
      <div class="z-admin__task" id="admin-task" ${this.activeTask ? '' : 'hidden'}></div>
    `;
    body.querySelectorAll<HTMLTableRowElement>('tr[data-name]').forEach((tr) => {
      const name = tr.dataset.name!;
      tr.querySelector('[data-act="toggle"]')!.addEventListener('click', (e) => {
        const checked = (e.target as HTMLInputElement).checked;
        this.toggleSource(name, checked);
      });
      tr.querySelector('[data-act="crawl"]')!.addEventListener('click', () => this.triggerCrawl(name));
      tr.querySelector('[data-act="edit"]')!.addEventListener('click', () => {
        const src = this.sources.find((s) => s.name === name)!;
        this.openEditor(src);
      });
      tr.querySelector('[data-act="del"]')!.addEventListener('click', () => this.deleteSource(name));
    });
    if (this.activeTask) this.renderTask(this.activeTask);
  }

  private async toggleSource(name: string, enabled: boolean) {
    const src = this.sources.find((s) => s.name === name);
    if (!src) return;
    const updated: SourceConfig = { ...src, enabled };
    try {
      await adminUpsertSource(ADMIN_KEY, updated);
      this.toast(`${name} ${enabled ? 'enabled' : 'disabled'} — ${enabled ? 'now in search' : 'excluded from search'}`);
      await this.load();
    } catch (e) {
      this.toast((e as Error).message, true);
      await this.load(); // re-render to reset toggle state
    }
  }

  private async triggerCrawl(name: string) {
    try {
      const taskId = await adminCrawl(ADMIN_KEY, name, 20);
      this.toast(`Crawl started for "${name}"`);
      this.pollTask(taskId);
    } catch (e) {
      this.toast((e as Error).message, true);
    }
  }

  private pollTask(taskId: string) {
    if (this.pollTimer) clearInterval(this.pollTimer);
    const tick = async () => {
      try {
        const task = await adminCrawlStatus(ADMIN_KEY, taskId);
        this.activeTask = task;
        this.renderTask(task);
        if (task.status === 'done' || task.status === 'error') {
          if (this.pollTimer) clearInterval(this.pollTimer);
          if (task.status === 'done') this.toast(`Crawl done: ${task.summary?.indexed} docs indexed`);
          else this.toast(`Crawl failed: ${task.error}`, true);
          await this.load();
        }
      } catch {
        /* keep polling */
      }
    };
    tick();
    this.pollTimer = setInterval(tick, 1500);
  }

  private renderTask(task: CrawlTask) {
    const box = this.el.querySelector('#admin-task');
    if (!box) return;
    box.hidden = false;
    const bar =
      task.status === 'running'
        ? `<span class="z-spinner"></span> running…`
        : task.status === 'done'
          ? `✓ done in ${task.summary?.seconds.toFixed(1)}s — ${task.summary?.indexed} indexed, ${task.summary?.failed} failed`
          : `✗ ${escapeHtml(task.error ?? 'error')}`;
    box.innerHTML = `
      <div class="z-admin__task-row">
        <strong>${escapeHtml(task.source)}</strong> · ${bar}
      </div>`;
  }

  private openEditor(src: SourceConfig | null) {
    const isNew = !src;
    const s: SourceConfig = src ?? { name: '', type: 'web', seeds: [''], allowedDomains: [''], maxPages: 50 };
    const isGoogle = s.type === 'google';
    const overlay = document.createElement('div');
    overlay.className = 'z-modal__overlay';
    overlay.innerHTML = `
      <div class="z-modal">
        <h3>${isNew ? 'New source' : 'Edit source'}</h3>
        <label class="z-field"><span>Name</span><input id="f-name" value="${escapeHtml(s.name)}" ${isNew ? '' : 'readonly'} /></label>
        <label class="z-field"><span>Type</span>
          <select id="f-type">
            <option value="web" ${!isGoogle ? 'selected' : ''}>web (seed URLs)</option>
            <option value="google" ${isGoogle ? 'selected' : ''}>google (queries → proxy)</option>
          </select>
        </label>
        <div class="z-field__dyn" id="f-web" ${isGoogle ? 'hidden' : ''}>
          <label class="z-field"><span>Seeds (one URL per line)</span><textarea id="f-seeds">${s.seeds.join('\n')}</textarea></label>
        </div>
        <div class="z-field__dyn" id="f-google" ${isGoogle ? '' : 'hidden'}>
          <label class="z-field"><span>Queries (one per line)</span><textarea id="f-queries">${(s.queries ?? []).join('\n')}</textarea></label>
          <p class="z-hint z-hint--warn">⚠ Queries are sent to Google. The Google proxy is opt-in (server env GOOGLE_PROXY_ENABLED). If disabled, saving is rejected.</p>
        </div>
        <label class="z-field"><span>Allowed domains (comma-separated)</span><textarea id="f-domains">${s.allowedDomains.join(', ')}</textarea></label>
        <label class="z-field"><span>Sitemap URL (optional)</span><input id="f-sitemap" value="${escapeHtml(s.sitemap ?? '')}" /></label>
        <label class="z-field"><span>Max pages</span><input id="f-max" type="number" value="${s.maxPages ?? 50}" /></label>
        <div class="z-modal__actions">
          <button class="z-btn" id="cancel">Cancel</button>
          <button class="z-btn z-btn--primary" id="save">Save</button>
        </div>
        <div class="z-error" id="editor-err" hidden></div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    const typeSel = overlay.querySelector('#f-type') as HTMLSelectElement;
    typeSel.addEventListener('change', () => {
      const g = typeSel.value === 'google';
      (overlay.querySelector('#f-google') as HTMLElement).hidden = !g;
      (overlay.querySelector('#f-web') as HTMLElement).hidden = g;
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    overlay.querySelector('#cancel')!.addEventListener('click', close);
    overlay.querySelector('#save')!.addEventListener('click', async () => {
      const type = (overlay.querySelector('#f-type') as HTMLSelectElement).value as 'web' | 'google';
      const payload: SourceConfig = {
        name: (overlay.querySelector('#f-name') as HTMLInputElement).value.trim(),
        type,
        seeds: (overlay.querySelector('#f-seeds') as HTMLTextAreaElement)
          .value.split('\n').map((x) => x.trim()).filter(Boolean),
        queries: type === 'google'
          ? (overlay.querySelector('#f-queries') as HTMLTextAreaElement)
            .value.split('\n').map((x) => x.trim()).filter(Boolean)
          : undefined,
        allowedDomains: (overlay.querySelector('#f-domains') as HTMLTextAreaElement)
          .value.split(',').map((x) => x.trim()).filter(Boolean),
        sitemap: (overlay.querySelector('#f-sitemap') as HTMLInputElement).value.trim() || undefined,
        maxPages: Number((overlay.querySelector('#f-max') as HTMLInputElement).value) || undefined,
      };
      try {
        await adminUpsertSource(ADMIN_KEY, payload);
        close();
        this.toast(`Saved "${payload.name}"`);
        await this.load();
      } catch (e) {
        const err = overlay.querySelector('#editor-err') as HTMLDivElement;
        err.hidden = false;
        err.textContent = (e as Error).message;
      }
    });
  }

  private async deleteSource(name: string) {
    if (!confirm(`Delete source "${name}"? This does not remove indexed docs.`)) return;
    try {
      await adminDeleteSource(ADMIN_KEY, name);
      this.toast(`Deleted "${name}"`);
      await this.load();
    } catch (e) {
      this.toast((e as Error).message, true);
    }
  }

  private toast(msg: string, isError = false) {
    const t = this.el.querySelector('#admin-toast') as HTMLElement;
    t.hidden = false;
    t.textContent = msg;
    t.className = `z-admin__toast${isError ? ' is-error' : ''}`;
    setTimeout(() => (t.hidden = true), 3500);
  }
}
