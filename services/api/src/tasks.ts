import type { CrawlTask, CrawlSummary } from '@zwep/shared';

/**
 * In-memory registry of background crawl tasks.
 *
 * Tasks are ephemeral by design — they describe work owned by *this* process,
 * so persisting them would only create ghosts after a restart. Entries are
 * evicted once they are finished and older than `TTL_MS`, which is what stops
 * a long-lived server from leaking one object per crawl forever.
 */

const TTL_MS = 60 * 60 * 1000; // keep finished tasks for an hour
const MAX_TASKS = 500;

export class TaskRegistry {
  private tasks = new Map<string, CrawlTask>();
  /** Tasks grouped by batch id, so a batch is not matched by string prefix. */
  private batches = new Map<string, string[]>();

  private id(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  create(source: string, batchId?: string): CrawlTask {
    this.evict();
    const task: CrawlTask = {
      id: this.id('task'),
      source,
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    this.tasks.set(task.id, task);
    if (batchId) {
      const list = this.batches.get(batchId) ?? [];
      list.push(task.id);
      this.batches.set(batchId, list);
    }
    return task;
  }

  newBatchId(): string {
    return this.id('batch');
  }

  get(id: string): CrawlTask | undefined {
    return this.tasks.get(id);
  }

  batch(batchId: string): CrawlTask[] | undefined {
    const ids = this.batches.get(batchId);
    if (!ids) return undefined;
    return ids.map((id) => this.tasks.get(id)).filter((t): t is CrawlTask => !!t);
  }

  succeed(id: string, summary: CrawlSummary): void {
    const t = this.tasks.get(id);
    if (!t) return;
    t.status = 'done';
    t.summary = summary;
    t.finishedAt = new Date().toISOString();
  }

  fail(id: string, error: unknown): void {
    const t = this.tasks.get(id);
    if (!t) return;
    t.status = 'error';
    t.error = error instanceof Error ? error.message : String(error);
    t.finishedAt = new Date().toISOString();
  }

  /** Number of tasks currently running. */
  runningCount(): number {
    let n = 0;
    for (const t of this.tasks.values()) if (t.status === 'running') n++;
    return n;
  }

  private evict(): void {
    const cutoff = Date.now() - TTL_MS;
    for (const [id, t] of this.tasks) {
      if (t.status === 'running') continue;
      const finished = t.finishedAt ? Date.parse(t.finishedAt) : 0;
      if (finished && finished < cutoff) this.tasks.delete(id);
    }
    // Hard ceiling in case a caller spams short-lived crawls.
    while (this.tasks.size > MAX_TASKS) {
      const oldest = this.tasks.keys().next().value;
      if (oldest === undefined) break;
      this.tasks.delete(oldest);
    }
    for (const [batchId, ids] of this.batches) {
      const alive = ids.filter((id) => this.tasks.has(id));
      if (!alive.length) this.batches.delete(batchId);
      else this.batches.set(batchId, alive);
    }
  }
}
