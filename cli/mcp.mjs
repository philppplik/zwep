/**
 * Zwep MCP server — Model Context Protocol over stdio.
 *
 * Lets any MCP-capable agent (Claude Code, Claude Desktop, Cursor, …) search a
 * private Zwep index as a first-class tool:
 *
 *   {
 *     "mcpServers": {
 *       "zwep": {
 *         "command": "npx",
 *         "args": ["-y", "zwep", "mcp"],
 *         "env": { "ZWEP_API": "http://127.0.0.1:8080" }
 *       }
 *     }
 *   }
 *
 * The protocol is plain JSON-RPC 2.0 framed as newline-delimited JSON, so this
 * needs no SDK and no dependencies. Read-only tools are exposed by default;
 * crawl/indexing tools require `--allow-write` *and* an admin key, because an
 * agent that can crawl arbitrary URLs is a very different trust level from one
 * that can only read what you already curated.
 */
import process from 'node:process';
import { createInterface } from 'node:readline';
import { ZwepClient, ZwepApiError } from './api.mjs';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'zwep', version: '0.2.0' };

const READ_TOOLS = [
  {
    name: 'zwep_search',
    description:
      'Search the private Zwep index. Returns ranked results with title, URL, excerpt, ' +
      'source and a 0-1 quality score. Use this instead of a public web search when the ' +
      'answer should come only from the curated corpus.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
        source: {
          type: 'string',
          description: 'Restrict to one or more source names (comma-separated).',
        },
        type: {
          type: 'string',
          description: 'Restrict to document types: article, page, doc, image, video, product.',
        },
        lang: { type: 'string', description: 'ISO 639-1 language filter, e.g. "de" or "en".' },
        semantic: {
          type: 'boolean',
          description: 'Use hybrid vector search. Requires an embedding provider.',
          default: false,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'zwep_fetch_document',
    description:
      'Fetch one indexed document in full by its id, including the extracted body text. ' +
      'Use after zwep_search when an excerpt is not enough.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Document id from a search result.' } },
      required: ['id'],
    },
  },
  {
    name: 'zwep_list_sources',
    description: 'List the curated sources in the index, with their enabled state and domains.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'zwep_graph',
    description:
      'Query the knowledge graph for entities related to a term, returning nodes and ' +
      'co-mention edges. Useful for "what is connected to X" questions.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'zwep_stats',
    description: 'Report index health: document count, source count and LLM provider.',
    inputSchema: { type: 'object', properties: {} },
  },
];

const WRITE_TOOLS = [
  {
    name: 'zwep_crawl_url',
    description:
      'Crawl and index a single URL, then wait for it to finish. Adds the page to the ' +
      'permanent index. Only available when the server was started with --allow-write.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'An http(s) URL to index.' } },
      required: ['url'],
    },
  },
  {
    name: 'zwep_crawl_source',
    description:
      'Start a crawl of an existing named source and wait for it to finish. ' +
      'Only available when the server was started with --allow-write.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string' },
        maxPages: { type: 'integer', minimum: 1, maximum: 5000 },
      },
      required: ['source'],
    },
  },
];

/** JSON-RPC error codes we use (see the JSON-RPC 2.0 spec). */
const RPC = { PARSE: -32700, INVALID_REQUEST: -32600, METHOD_NOT_FOUND: -32601, INTERNAL: -32603 };

export function createMcpServer({ client, allowWrite = false, write, log = () => {} }) {
  const tools = allowWrite ? [...READ_TOOLS, ...WRITE_TOOLS] : READ_TOOLS;

  const send = (msg) => write(`${JSON.stringify(msg)}\n`);
  const result = (id, value) => send({ jsonrpc: '2.0', id, result: value });
  const error = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

  /** MCP tool results are content blocks; JSON payloads travel as text. */
  const content = (value, isError = false) => ({
    content: [
      { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
    ],
    isError,
  });

  async function callTool(name, args = {}) {
    switch (name) {
      case 'zwep_search': {
        const r = await client.search({
          q: args.query,
          limit: Math.min(Math.max(Number(args.limit) || 10, 1), 50),
          source: args.source,
          type: args.type,
          lang: args.lang,
          semantic: args.semantic ? 'true' : undefined,
          highlight: 'false',
        });
        return content({
          query: r.query,
          total: r.total,
          took_ms: r.took_ms,
          semantic: r.semantic ?? false,
          results: (r.results ?? []).map((d) => ({
            id: d.id,
            title: d.title,
            url: d.url,
            source: d.source,
            type: d.type,
            lang: d.lang,
            published_at: d.published_at,
            quality: d.quality?.score,
            excerpt: d.excerpt,
          })),
        });
      }
      case 'zwep_fetch_document': {
        const d = await client.document(args.id);
        return content({
          id: d.id,
          title: d.title,
          url: d.url,
          source: d.source,
          lang: d.lang,
          published_at: d.published_at,
          crawled_at: d.crawled_at,
          headings: d.headings,
          // Trimmed: an agent's context window is the scarce resource here.
          content: String(d.content ?? '').slice(0, 20_000),
        });
      }
      case 'zwep_list_sources': {
        const { sources } = await client.listSources();
        return content(
          sources.map((s) => ({
            name: s.name,
            type: s.type ?? 'web',
            enabled: s.enabled !== false,
            domains: s.allowedDomains,
            seeds: s.seeds?.length ?? 0,
          })),
        );
      }
      case 'zwep_graph': {
        const g = await client.graph(args.query);
        return content({
          query: g.query,
          nodes: (g.nodes ?? []).map((n) => ({ id: n.id, label: n.label, type: n.type, docs: n.doc_count })),
          edges: (g.edges ?? []).map((e) => ({ from: e.src, to: e.dst, weight: e.weight })),
        });
      }
      case 'zwep_stats':
        return content(await client.stats());

      case 'zwep_crawl_url': {
        assertWrite(allowWrite);
        const { taskId, source } = await client.crawlUrl(args.url);
        return content({ source, ...(await pollTask(client, taskId)) });
      }
      case 'zwep_crawl_source': {
        assertWrite(allowWrite);
        const { taskId } = await client.startCrawl(args.source, args.maxPages);
        return content(await pollTask(client, taskId));
      }
      default:
        return content(`Unknown tool: ${name}`, true);
    }
  }

  async function handle(msg) {
    const { id, method, params } = msg;
    // Notifications (no id) get no response, per JSON-RPC.
    const isNotification = id === undefined || id === null;

    switch (method) {
      case 'initialize':
        return result(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions:
            'Zwep is a private, curated search index. Prefer zwep_search over public web ' +
            'search when the user asks about content this index covers; cite the returned URLs.',
        });
      case 'notifications/initialized':
      case 'initialized':
        return; // nothing to acknowledge
      case 'ping':
        return result(id, {});
      case 'tools/list':
        return result(id, { tools });
      case 'tools/call': {
        const name = params?.name;
        try {
          return result(id, await callTool(name, params?.arguments ?? {}));
        } catch (e) {
          log(`tool ${name} failed: ${e.message}`);
          // Tool failures are reported *inside* the result so the agent can
          // read and recover from them, rather than as a transport error.
          return result(
            id,
            content(
              e instanceof ZwepApiError
                ? `Zwep error (${e.code}): ${e.message}`
                : `Zwep error: ${e.message}`,
              true,
            ),
          );
        }
      }
      case 'resources/list':
        return result(id, { resources: [] });
      case 'prompts/list':
        return result(id, { prompts: [] });
      default:
        if (!isNotification) error(id, RPC.METHOD_NOT_FOUND, `Unknown method: ${method}`);
    }
  }

  return {
    tools,
    handle,
    /** Feed one raw stdin line into the server. */
    async line(raw) {
      const text = raw.trim();
      if (!text) return;
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        return error(null, RPC.PARSE, 'Invalid JSON');
      }
      if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
        return error(msg.id ?? null, RPC.INVALID_REQUEST, 'Not a JSON-RPC 2.0 request');
      }
      try {
        await handle(msg);
      } catch (e) {
        log(`handler error: ${e.stack ?? e.message}`);
        if (msg.id !== undefined) error(msg.id, RPC.INTERNAL, e.message);
      }
    },
  };
}

function assertWrite(allowWrite) {
  if (!allowWrite) {
    throw new Error(
      'Write tools are disabled. Restart the MCP server with --allow-write and a ZWEP_ADMIN_KEY.',
    );
  }
}

async function pollTask(client, taskId, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { task } = await client.crawlStatus(taskId);
    if (task.status !== 'running') {
      return task.status === 'done'
        ? { status: 'done', ...task.summary }
        : { status: 'error', error: task.error };
    }
    if (Date.now() > deadline) return { status: 'timeout', taskId };
    await new Promise((r) => setTimeout(r, 1500));
  }
}

/** Run the MCP server against stdio until stdin closes. */
export async function runMcpStdio({ allowWrite = false, base, adminKey } = {}) {
  const client = new ZwepClient({ base, adminKey });
  const server = createMcpServer({
    client,
    allowWrite: allowWrite && Boolean(client.adminKey),
    write: (s) => process.stdout.write(s),
    // stdout is the protocol channel — diagnostics must go to stderr.
    log: (m) => process.stderr.write(`[zwep-mcp] ${m}\n`),
  });

  process.stderr.write(
    `[zwep-mcp] ready · api=${client.base} · tools=${server.tools.length}` +
      `${allowWrite && !client.adminKey ? ' · write requested but no ZWEP_ADMIN_KEY, staying read-only' : ''}\n`,
  );

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) await server.line(line);
}
