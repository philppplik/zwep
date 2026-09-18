import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMcpServer } from '../../cli/mcp.mjs';
import { ZwepApiError } from '../../cli/api.mjs';

/**
 * The MCP server is exercised through its JSON-RPC surface — the same way an
 * agent drives it — rather than by calling internals. That keeps these tests
 * honest about the protocol contract.
 */

interface Sent {
  jsonrpc: string;
  id?: number | string | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

function harness(overrides: Record<string, unknown> = {}, allowWrite = false) {
  const sent: Sent[] = [];
  const client = {
    search: vi.fn(async () => ({ query: 'x', total: 0, took_ms: 3, results: [] })),
    document: vi.fn(async () => ({ id: 'a', title: 'T', content: 'body' })),
    listSources: vi.fn(async () => ({ sources: [] })),
    graph: vi.fn(async () => ({ query: 'x', nodes: [], edges: [] })),
    stats: vi.fn(async () => ({ ok: true, indexed: 7 })),
    crawlUrl: vi.fn(async () => ({ taskId: 't1', source: 's1' })),
    startCrawl: vi.fn(async () => ({ taskId: 't1' })),
    crawlStatus: vi.fn(async () => ({ task: { status: 'done', summary: { indexed: 1 } } })),
    ...overrides,
  };
  const server = createMcpServer({
    client,
    allowWrite,
    write: (s: string) => sent.push(JSON.parse(s)),
  });
  return { server, sent, client };
}

const rpc = (method: string, params?: unknown, id: number | null = 1) =>
  JSON.stringify({ jsonrpc: '2.0', id, method, params });

let h: ReturnType<typeof harness>;
beforeEach(() => {
  h = harness();
});

describe('initialize', () => {
  it('reports the protocol version, capabilities and server identity', async () => {
    await h.server.line(rpc('initialize'));
    const r = h.sent[0].result!;
    expect(r.protocolVersion).toBe('2024-11-05');
    expect(r.capabilities).toMatchObject({ tools: {} });
    expect(r.serverInfo).toMatchObject({ name: 'zwep' });
    expect(String(r.instructions)).toContain('zwep_search');
  });

  it('does not answer the initialized notification', async () => {
    await h.server.line(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
    expect(h.sent).toHaveLength(0);
  });
});

describe('tools/list', () => {
  it('advertises the read-only tools by default', async () => {
    await h.server.line(rpc('tools/list'));
    const names = (h.sent[0].result!.tools as { name: string }[]).map((t) => t.name);
    expect(names).toContain('zwep_search');
    expect(names).toContain('zwep_fetch_document');
    expect(names).not.toContain('zwep_crawl_url');
  });

  it('adds the write tools only when explicitly allowed', async () => {
    const w = harness({}, true);
    await w.server.line(rpc('tools/list'));
    const names = (w.sent[0].result!.tools as { name: string }[]).map((t) => t.name);
    expect(names).toContain('zwep_crawl_url');
  });

  it('gives every tool a JSON Schema an agent can validate against', async () => {
    await h.server.line(rpc('tools/list'));
    for (const tool of h.sent[0].result!.tools as {
      name: string;
      description: string;
      inputSchema: { type: string };
    }[]) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema.type).toBe('object');
    }
  });
});

describe('tools/call', () => {
  it('returns a text content block', async () => {
    await h.server.line(
      rpc('tools/call', { name: 'zwep_search', arguments: { query: 'climate' } }),
    );
    const result = h.sent[0].result as {
      content: { type: string; text: string }[];
      isError: boolean;
    };
    expect(result.isError).toBe(false);
    expect(result.content[0].type).toBe('text');
    expect(() => JSON.parse(result.content[0].text)).not.toThrow();
  });

  it('clamps the search limit into the advertised range', async () => {
    await h.server.line(
      rpc('tools/call', { name: 'zwep_search', arguments: { query: 'x', limit: 9999 } }),
    );
    expect(h.client.search).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));
  });

  it('projects results down to the fields an agent needs', async () => {
    const custom = harness({
      search: vi.fn(async () => ({
        query: 'x',
        total: 1,
        took_ms: 1,
        results: [
          {
            id: 'a',
            title: 'T',
            url: 'https://e.com',
            source: 's',
            type: 'article',
            lang: 'en',
            excerpt: 'e',
            content: 'huge',
            quality: { score: 0.8 },
          },
        ],
      })),
    });
    await custom.server.line(rpc('tools/call', { name: 'zwep_search', arguments: { query: 'x' } }));
    const payload = JSON.parse(
      (custom.sent[0].result as { content: { text: string }[] }).content[0].text,
    );
    expect(payload.results[0]).toMatchObject({ id: 'a', quality: 0.8 });
    // The full body would waste the agent's context window.
    expect(payload.results[0]).not.toHaveProperty('content');
  });

  it('truncates a fetched document so one page cannot fill the context window', async () => {
    const big = harness({
      document: vi.fn(async () => ({ id: 'a', title: 'T', content: 'x'.repeat(50_000) })),
    });
    await big.server.line(
      rpc('tools/call', { name: 'zwep_fetch_document', arguments: { id: 'a' } }),
    );
    const payload = JSON.parse(
      (big.sent[0].result as { content: { text: string }[] }).content[0].text,
    );
    expect(payload.content.length).toBe(20_000);
  });

  it('reports a tool failure inside the result so the agent can recover', async () => {
    const failing = harness({
      search: vi.fn(async () => {
        throw new ZwepApiError('index down', { status: 503, code: 'index_unavailable' });
      }),
    });
    await failing.server.line(
      rpc('tools/call', { name: 'zwep_search', arguments: { query: 'x' } }),
    );
    const result = failing.sent[0].result as { content: { text: string }[]; isError: boolean };
    // A transport-level error would abort the agent's turn; this is recoverable.
    expect(failing.sent[0].error).toBeUndefined();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('index_unavailable');
  });

  it('refuses a write tool when write access is off', async () => {
    await h.server.line(
      rpc('tools/call', { name: 'zwep_crawl_url', arguments: { url: 'https://e.com' } }),
    );
    const result = h.sent[0].result as { content: { text: string }[]; isError: boolean };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('--allow-write');
    expect(h.client.crawlUrl).not.toHaveBeenCalled();
  });

  it('runs a write tool when write access is on', async () => {
    const w = harness({}, true);
    await w.server.line(
      rpc('tools/call', { name: 'zwep_crawl_url', arguments: { url: 'https://e.com' } }),
    );
    expect(w.client.crawlUrl).toHaveBeenCalledWith('https://e.com');
    const payload = JSON.parse(
      (w.sent[0].result as { content: { text: string }[] }).content[0].text,
    );
    expect(payload).toMatchObject({ status: 'done', source: 's1' });
  });

  it('flags an unknown tool without crashing', async () => {
    await h.server.line(rpc('tools/call', { name: 'zwep_nonexistent', arguments: {} }));
    expect((h.sent[0].result as { isError: boolean }).isError).toBe(true);
  });
});

describe('protocol errors', () => {
  it('reports a parse error for malformed JSON', async () => {
    await h.server.line('{ not json');
    expect(h.sent[0].error?.code).toBe(-32700);
  });

  it('rejects a non-JSON-RPC-2.0 message', async () => {
    await h.server.line(JSON.stringify({ id: 1, method: 'tools/list' }));
    expect(h.sent[0].error?.code).toBe(-32600);
  });

  it('reports an unknown method', async () => {
    await h.server.line(rpc('does/not/exist'));
    expect(h.sent[0].error?.code).toBe(-32601);
  });

  it('ignores a blank line', async () => {
    await h.server.line('   ');
    expect(h.sent).toHaveLength(0);
  });

  it('answers ping', async () => {
    await h.server.line(rpc('ping'));
    expect(h.sent[0].result).toEqual({});
  });

  it('reports empty resource and prompt lists rather than erroring', async () => {
    await h.server.line(rpc('resources/list'));
    await h.server.line(rpc('prompts/list', undefined, 2));
    expect(h.sent[0].result).toEqual({ resources: [] });
    expect(h.sent[1].result).toEqual({ prompts: [] });
  });
});
