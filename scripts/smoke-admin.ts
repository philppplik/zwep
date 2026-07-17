// In-process smoke test for the Admin API.
// Starts the Fastify app and hits the endpoints over loopback from the SAME process,
// avoiding the Hermes cross-process port-isolation issue.
import { build } from '../services/api/src/server.ts';

const KEY = 'zwep_admin_dev_key';
const BASE = 'http://127.0.0.1:8080';

async function main() {
  const app = await build();
  await app.listen({ port: 8080, host: '127.0.0.1' });

  const results: string[] = [];
  const check = (name: string, cond: boolean, extra = '') =>
    results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);

  // health
  let r = await fetch(`${BASE}/healthz`);
  check('healthz', r.ok);

  // unauthorized
  r = await fetch(`${BASE}/v1/admin/sources`);
  check('admin requires key', r.status === 401, `status=${r.status}`);

  // list
  r = await fetch(`${BASE}/v1/admin/sources?admin_key=${KEY}`);
  const list = await r.json();
  check('list sources', r.ok && Array.isArray(list.sources), `count=${list.sources?.length}`);

  // create
  r = await fetch(`${BASE}/v1/admin/sources?admin_key=${KEY}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'test', seeds: ['https://example.org/'], allowedDomains: ['example.org'], maxPages: 5 }),
  });
  check('create source', r.ok, `status=${r.status}`);

  // re-list shows it
  r = await fetch(`${BASE}/v1/admin/sources?admin_key=${KEY}`);
  const list2 = await r.json();
  check('source persisted', list2.sources.some((s: any) => s.name === 'test'));

  // invalid create
  r = await fetch(`${BASE}/v1/admin/sources?admin_key=${KEY}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '', seeds: [], allowedDomains: [] }),
  });
  check('invalid source rejected', r.status === 400, `status=${r.status}`);

  // crawl trigger (async)
  r = await fetch(`${BASE}/v1/admin/crawl?admin_key=${KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: 'test', maxPages: 3 }),
  });
  const crawl = await r.json();
  check('crawl triggered', r.status === 202 && !!crawl.taskId, `taskId=${crawl.taskId}`);

  // poll until done
  let task: any = {};
  for (let i = 0; i < 20 && task.status !== 'done' && task.status !== 'error'; i++) {
    await new Promise((res) => setTimeout(res, 1000));
    r = await fetch(`${BASE}/v1/admin/crawl/${crawl.taskId}?admin_key=${KEY}`);
    task = (await r.json()).task;
  }
  check('crawl completed', task.status === 'done', `indexed=${task.summary?.indexed}, failed=${task.summary?.failed}`);

  // delete
  r = await fetch(`${BASE}/v1/admin/sources/test?admin_key=${KEY}`, { method: 'DELETE' });
  check('delete source', r.ok);

  await app.close();
  console.log(results.join('\n'));
  const failed = results.filter((l) => l.startsWith('FAIL')).length;
  console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
