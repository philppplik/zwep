#!/usr/bin/env node
/**
 * `zwep` — the Zwep command line.
 *
 * Two audiences, one binary:
 *   - humans get an ASCII UI (banner, tables, quality meters, a REPL);
 *   - agents get `--json` on every command plus a full MCP server (`zwep mcp`).
 *
 * It speaks to the Zwep HTTP API (`ZWEP_API`, default http://127.0.0.1:8080),
 * so it needs no local index, no Playwright and no native modules.
 */
import process from 'node:process';
import { createInterface } from 'node:readline';
import { parseArgs } from '../cli/args.mjs';
import { ZwepClient, ZwepApiError, waitForTask } from '../cli/api.mjs';
import { runMcpStdio } from '../cli/mcp.mjs';
import { banner, box, c, meter, rule, spinner, symbols, table, termWidth, truncate } from '../cli/ui.mjs';

const VERSION = '0.2.0';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const { flags, positional } = parseArgs(process.argv.slice(2));
const command = positional[0];
const asJson = Boolean(flags.json);

const client = new ZwepClient({
  base: flags.api ?? process.env.ZWEP_API,
  adminKey: flags['admin-key'] ?? process.env.ZWEP_ADMIN_KEY,
});

function out(value) {
  process.stdout.write(typeof value === 'string' ? `${value}\n` : `${JSON.stringify(value)}\n`);
}

function emit(human, json) {
  if (asJson) out(JSON.stringify(json ?? human, null, flags.compact ? 0 : 2));
  else out(human);
}

function die(message, code = 1) {
  if (asJson) out(JSON.stringify({ ok: false, error: message }));
  else process.stderr.write(`${symbols.err} ${message}\n`);
  process.exit(code);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderResults(resp, { showBanner = false } = {}) {
  const lines = [];
  if (showBanner) lines.push(banner());
  const semantic = resp.semantic ? c.magenta(' · hybrid') : '';
  lines.push(
    c.dim(
      `${resp.total} result${resp.total === 1 ? '' : 's'} for “${resp.query}” · ${resp.took_ms} ms${semantic}`,
    ),
  );
  lines.push(rule());
  if (!resp.results.length) {
    lines.push('');
    lines.push(`  ${c.dim('Nothing indexed matches that yet.')}`);
    lines.push(`  ${c.dim('Try:')} zwep crawl <source>   ${c.dim('or')}   zwep index <url>`);
    return lines.join('\n');
  }
  const w = termWidth();
  resp.results.forEach((r, i) => {
    const n = c.dim(String(i + 1 + (resp.offset ?? 0)).padStart(2));
    const q = r.quality ? `  ${meter(r.quality.score, 8)}` : '';
    lines.push('');
    lines.push(`${n} ${c.bold(truncate(r.title, w - 18))}${q}`);
    lines.push(`   ${c.cyan(truncate(r.url, w - 4))}`);
    const tags = (r.tags ?? []).slice(0, 4).join(' · ');
    lines.push(
      `   ${c.dim(truncate(r.excerpt ?? '', w - 4))}`,
    );
    lines.push(
      `   ${c.gray(`${r.source} · ${r.type}${r.lang && r.lang !== 'und' ? ` · ${r.lang}` : ''}${tags ? ` · ${tags}` : ''}`)}`,
    );
  });
  if (resp.total > resp.offset + resp.results.length) {
    lines.push('');
    lines.push(
      c.dim(
        `  … ${resp.total - resp.offset - resp.results.length} more. ` +
          `Use --offset ${resp.offset + resp.limit}`,
      ),
    );
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const commands = {
  async search() {
    const q = positional.slice(1).join(' ').trim() || String(flags.q ?? '');
    if (!q) die('Usage: zwep search <query> [--limit N] [--source NAME] [--type TYPE] [--semantic]');
    const spin = asJson ? null : spinner(`searching “${q}”…`);
    try {
      const resp = await client.search({
        q,
        limit: flags.limit ?? 10,
        offset: flags.offset,
        source: flags.source,
        type: flags.type,
        tag: flags.tag,
        lang: flags.lang,
        sort: flags.sort,
        semantic: flags.semantic ? 'true' : undefined,
        highlight: 'false',
      });
      spin?.stop();
      emit(renderResults(resp), resp);
    } catch (e) {
      spin?.stop();
      throw e;
    }
  },

  async suggest() {
    const q = positional.slice(1).join(' ').trim();
    if (!q) die('Usage: zwep suggest <partial query>');
    const r = await client.suggest({ q, limit: flags.limit ?? 8 });
    emit(
      r.suggestions.length
        ? r.suggestions.map((s) => `${c.dim(symbols.bullet)} ${s.text}`).join('\n')
        : c.dim('(no suggestions)'),
      r,
    );
  },

  async doc() {
    const id = positional[1];
    if (!id) die('Usage: zwep doc <document-id>');
    const d = await client.document(id);
    if (asJson) return emit(null, d);
    out(
      [
        c.bold(d.title),
        c.cyan(d.url),
        c.gray(
          `${d.source} · ${d.type} · ${d.lang}${d.published_at ? ` · ${d.published_at.slice(0, 10)}` : ''}`,
        ),
        d.quality ? `quality ${meter(d.quality.score)}` : '',
        rule(),
        d.content ?? '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  },

  async overview() {
    const q = positional.slice(1).join(' ').trim();
    if (!q) die('Usage: zwep overview <query>');
    const spin = asJson ? null : spinner('asking the model…');
    try {
      const r = await client.overview(q);
      spin?.stop();
      if (asJson) return emit(null, r);
      out(box(`AI overview · ${q}`, wrap(r.overview || '(empty)', termWidth() - 8)));
      if (r.sources?.length) {
        out(c.dim('\nSources:'));
        r.sources.forEach((s, i) => out(`  ${c.dim(`[${i + 1}]`)} ${c.cyan(s.url)}`));
      }
      if (r.cached) out(c.dim('\n(served from cache)'));
    } catch (e) {
      spin?.stop();
      throw e;
    }
  },

  async graph() {
    const q = positional.slice(1).join(' ').trim();
    if (!q) die('Usage: zwep graph <term>');
    const g = await client.graph(q);
    if (asJson) return emit(null, g);
    if (!g.nodes.length) return out(c.dim(`No entities related to “${q}”.`));
    out(
      table(
        [...g.nodes].sort((a, b) => b.doc_count - a.doc_count).slice(0, 25),
        [
          { key: 'label', label: 'Entity' },
          { key: 'type', label: 'Type' },
          { key: 'doc_count', label: 'Docs', align: 'right' },
        ],
      ),
    );
    out(c.dim(`\n${g.nodes.length} entities · ${g.edges.length} relations · ${g.stats.entities} in graph`));
  },

  async status() {
    const [health, stats] = await Promise.all([
      client.health().catch(() => null),
      client.stats().catch((e) => ({ error: e.message })),
    ]);
    const payload = { api: client.base, healthy: Boolean(health?.ok), ...stats };
    if (asJson) return emit(null, payload);
    out(banner());
    out(
      box('Status', [
        `API           ${client.base}`,
        `Reachable     ${health?.ok ? `${symbols.ok} yes` : `${symbols.err} no`}`,
        `Documents     ${stats.indexed ?? '—'}`,
        `Sources       ${stats.sourcesEnabled ?? '—'} enabled / ${stats.sources ?? '—'} total`,
        `LLM provider  ${stats.llm ?? 'none'}`,
        `Crawls active ${stats.runningCrawls ?? 0}`,
      ]),
    );
  },

  async sources() {
    const sub = positional[1] ?? 'list';
    if (sub === 'list') {
      const { sources } = await client.listSources();
      if (asJson) return emit(null, sources);
      return out(
        table(sources, [
          { key: 'name', label: 'Name' },
          {
            key: 'enabled',
            label: 'Active',
            format: (v) => (v === false ? c.red('off') : c.green('on')),
          },
          { key: 'type', label: 'Type', format: (v) => v ?? 'web' },
          { key: 'allowedDomains', label: 'Domains', format: (v) => (v ?? []).join(', ') },
          { key: 'maxPages', label: 'Max', align: 'right', format: (v) => v ?? '—' },
        ]),
      );
    }
    if (sub === 'enable' || sub === 'disable') {
      const name = positional[2];
      if (!name) die(`Usage: zwep sources ${sub} <name>`);
      const { sources } = await client.listSources();
      const src = sources.find((s) => s.name === name);
      if (!src) die(`Unknown source: ${name}`);
      const r = await client.upsertSource({ ...src, enabled: sub === 'enable' });
      return emit(`${symbols.ok} ${name} ${sub}d`, r);
    }
    if (sub === 'rm' || sub === 'delete') {
      const name = positional[2];
      if (!name) die('Usage: zwep sources rm <name> [--purge]');
      const r = await client.deleteSource(name, Boolean(flags.purge));
      return emit(`${symbols.ok} deleted ${name}${r.purged ? ' (documents purged)' : ''}`, r);
    }
    if (sub === 'add') {
      const name = positional[2];
      const seeds = String(flags.seed ?? flags.seeds ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!name || !seeds.length) {
        die('Usage: zwep sources add <name> --seed https://example.com[,https://…] [--domain example.com] [--max-pages 50]');
      }
      const domains = String(flags.domain ?? flags.domains ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const source = {
        name,
        type: 'web',
        seeds,
        allowedDomains: domains.length ? domains : seeds.map((s) => new URL(s).hostname.replace(/^www\./, '')),
        maxPages: flags['max-pages'] ? Number(flags['max-pages']) : 50,
        maxDepth: flags['max-depth'] ? Number(flags['max-depth']) : undefined,
      };
      const r = await client.upsertSource(source);
      return emit(`${symbols.ok} added source “${name}”. Run: zwep crawl ${name}`, r);
    }
    die(`Unknown subcommand: sources ${sub}. Try: list | add | enable | disable | rm`);
  },

  async crawl() {
    const name = positional[1];
    if (!name) die('Usage: zwep crawl <source|--all> [--max-pages N]');
    const maxPages = flags['max-pages'] ? Number(flags['max-pages']) : undefined;

    if (name === '--all' || flags.all) {
      const { batchId, count } = await client.crawlAll(maxPages);
      if (asJson && !flags.wait) return emit(null, { batchId, count });
      const spin = asJson ? null : spinner(`crawling ${count} sources…`);
      for (;;) {
        const { batch, done, total } = await client.batchStatus(batchId);
        spin?.update(`crawling… ${done}/${total} sources done`);
        if (done === total) {
          spin?.stop();
          const indexed = batch.reduce((n, t) => n + (t.summary?.indexed ?? 0), 0);
          const failed = batch.filter((t) => t.status === 'error').length;
          return emit(
            `${symbols.ok} batch complete · ${indexed} documents indexed · ${failed} source(s) failed`,
            { batchId, batch },
          );
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    const { taskId } = await client.startCrawl(name, maxPages);
    if (flags.detach) return emit(`${symbols.info} crawl started · task ${taskId}`, { taskId });
    const spin = asJson ? null : spinner(`crawling “${name}”…`);
    const task = await waitForTask(client, taskId);
    spin?.stop();
    if (task.status === 'error') die(`crawl failed: ${task.error}`);
    const s = task.summary;
    return emit(
      `${symbols.ok} ${name}: ${s.indexed} indexed · ${s.pages} fetched · ${s.skipped} skipped · ` +
        `${s.failed} failed · ${s.seconds}s`,
      task,
    );
  },

  async index() {
    const url = positional[1];
    if (!url) die('Usage: zwep index <url>');
    const { taskId, source } = await client.crawlUrl(url);
    const spin = asJson ? null : spinner(`indexing ${url}…`);
    const task = await waitForTask(client, taskId);
    spin?.stop();
    if (task.status === 'error') die(`indexing failed: ${task.error}`);
    return emit(`${symbols.ok} indexed ${url} as source “${source}”`, task);
  },

  async deindex() {
    if (!flags.yes && !flags.y) {
      die('This deletes every indexed document. Re-run with --yes to confirm.');
    }
    const r = await client.deindexAll();
    return emit(`${symbols.ok} ${r.message}`, r);
  },

  async repl() {
    if (!process.stdin.isTTY) die('zwep repl needs an interactive terminal.');
    out(banner('interactive search — type a query, or /help'));
    const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: c.orange('zwep › ') });
    rl.prompt();
    for await (const line of rl) {
      const q = line.trim();
      if (!q) {
        rl.prompt();
        continue;
      }
      if (q === '/quit' || q === '/exit' || q === '/q') break;
      if (q === '/help') {
        out(
          [
            '  <text>         search the index',
            '  /status        index health',
            '  /sources       list sources',
            '  /graph <term>  knowledge graph around a term',
            '  /ai <query>    AI overview',
            '  /quit          leave',
          ].join('\n'),
        );
        rl.prompt();
        continue;
      }
      try {
        if (q.startsWith('/status')) await commands.status();
        else if (q.startsWith('/sources')) {
          positional.length = 0;
          positional.push('sources', 'list');
          await commands.sources();
        } else if (q.startsWith('/graph ')) {
          const g = await client.graph(q.slice(7).trim());
          out(g.nodes.map((n) => `  ${n.label} ${c.dim(`(${n.doc_count})`)}`).join('\n') || c.dim('(none)'));
        } else if (q.startsWith('/ai ')) {
          const r = await client.overview(q.slice(4).trim());
          out(box('AI overview', wrap(r.overview || '(empty)', termWidth() - 8)));
        } else {
          out(renderResults(await client.search({ q, limit: flags.limit ?? 8, highlight: 'false' })));
        }
      } catch (e) {
        process.stderr.write(`${symbols.err} ${e.message}\n`);
      }
      rl.prompt();
    }
    out(c.dim('bye.'));
  },

  async mcp() {
    await runMcpStdio({
      allowWrite: Boolean(flags['allow-write']),
      base: flags.api ?? process.env.ZWEP_API,
      adminKey: flags['admin-key'] ?? process.env.ZWEP_ADMIN_KEY,
    });
  },

  version() {
    emit(`zwep ${VERSION}`, { version: VERSION });
  },

  help() {
    out(banner());
    out(
      [
        c.bold('USAGE'),
        '  zwep <command> [options]',
        '',
        c.bold('SEARCH'),
        '  search <query>        Search the index',
        '  suggest <partial>     Title autocompletions',
        '  doc <id>              Print one document in full',
        '  overview <query>      AI summary of the top results',
        '  graph <term>          Knowledge-graph neighbourhood',
        '  repl                  Interactive search session',
        '',
        c.bold('INDEX') + c.dim('  (needs ZWEP_ADMIN_KEY)'),
        '  status                Index health and counts',
        '  sources list          List curated sources',
        '  sources add <name> --seed <url>[,<url>] [--domain d] [--max-pages N]',
        '  sources enable|disable|rm <name>',
        '  crawl <source>        Crawl one source (--all for every enabled one)',
        '  index <url>           Crawl and index a single URL',
        '  deindex --yes         Delete every indexed document',
        '',
        c.bold('AGENTS'),
        '  mcp [--allow-write]   Run as an MCP server on stdio',
        '  --json                Machine-readable output for any command',
        '',
        c.bold('OPTIONS'),
        '  --api <url>           Zwep API base URL (env ZWEP_API)',
        '  --admin-key <key>     Admin key (env ZWEP_ADMIN_KEY)',
        '  --limit, --offset, --source, --type, --lang, --sort, --semantic',
        '  --no-color            Disable ANSI colour',
        '',
        c.dim(`  API: ${client.base}`),
      ].join('\n'),
    );
  },
};

/** Hard-wrap text to a column width, preserving paragraph breaks. */
function wrap(text, width) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    if (!para.trim()) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of para.split(/\s+/)) {
      if (line && line.length + word.length + 1 > width) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const ALIASES = { s: 'search', q: 'search', ls: 'sources', stat: 'status', '-v': 'version' };

async function main() {
  if (flags.version || flags.V) return commands.version();
  if (!command || flags.help || flags.h || command === 'help') return commands.help();
  const name = ALIASES[command] ?? command;
  const fn = commands[name];
  if (!fn) die(`Unknown command: ${command}. Run 'zwep help'.`, 2);
  await fn();
}

main().catch((e) => {
  if (e instanceof ZwepApiError) die(`${e.message}${e.code ? c.dim(` (${e.code})`) : ''}`);
  die(e?.stack ?? String(e));
});
