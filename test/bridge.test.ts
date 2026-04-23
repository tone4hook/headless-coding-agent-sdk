import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HttpMcpBridge } from '../src/tools/bridge.js';
import { createToolRegistry, tool } from '../src/tools/define.js';

/**
 * These tests exercise the bridge end-to-end by making real HTTP JSON-RPC
 * calls against a loopback socket — no mocks, no MCP client SDK. The CLI
 * subprocesses we'll invoke in Phases 6-10 will hit the same endpoint.
 */

function randomId() {
  return Math.floor(Math.random() * 1_000_000);
}

async function rpc(url: string, method: string, params?: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: randomId(),
      method,
      params,
    }),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<{ jsonrpc: '2.0'; id: number; result?: unknown; error?: unknown }>;
}

async function initialize(url: string) {
  // Streamable HTTP transport requires an `initialize` before any other request.
  await rpc(url, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '0.0.0' },
  });
}

describe('HttpMcpBridge', () => {
  let bridge: HttpMcpBridge;

  beforeEach(async () => {
    const add = tool({
      name: 'add',
      description: 'add two numbers',
      inputSchema: { a: 'number', b: 'number' },
      handler: async ({ a, b }: { a: number; b: number }) => ({
        content: [{ type: 'text', text: String(a + b) }],
      }),
    });
    bridge = new HttpMcpBridge({ registry: createToolRegistry([add]) });
    await bridge.start();
  });

  afterEach(async () => {
    await bridge.close();
  });

  it('exposes a bound localhost URL', () => {
    expect(bridge.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  });

  it('advertises registered tools over MCP tools/list', async () => {
    await initialize(bridge.url);
    const resp = await rpc(bridge.url, 'tools/list');
    const tools = (resp.result as { tools: Array<{ name: string; inputSchema: unknown }> })
      .tools;
    expect(tools.map((t) => t.name)).toEqual(['add']);
    expect(tools[0]!.inputSchema).toMatchObject({
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
    });
  });

  it('invokes handlers via MCP tools/call and returns their results', async () => {
    await initialize(bridge.url);
    const resp = await rpc(bridge.url, 'tools/call', {
      name: 'add',
      arguments: { a: 4, b: 7 },
    });
    expect(resp.result).toMatchObject({
      content: [{ type: 'text', text: '11' }],
      isError: false,
    });
  });

  it('reports isError:true when a handler throws', async () => {
    const bad = tool({
      name: 'boom',
      description: 'always throws',
      inputSchema: {},
      handler: async () => {
        throw new Error('kaboom');
      },
    });
    const b = new HttpMcpBridge({ registry: createToolRegistry([bad]) });
    await b.start();
    try {
      await initialize(b.url);
      const resp = await rpc(b.url, 'tools/call', { name: 'boom', arguments: {} });
      expect(resp.result).toMatchObject({
        content: [{ type: 'text', text: 'kaboom' }],
        isError: true,
      });
    } finally {
      await b.close();
    }
  });

  it('releases the port on close', async () => {
    const boundUrl = bridge.url;
    await bridge.close();
    const port = Number(new URL(boundUrl).port);
    await expect(
      fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST' }),
    ).rejects.toThrow();
  });

  it('uses the mcp__<serverName>__ tool name prefix', () => {
    expect(bridge.toolNamePrefix).toBe(`mcp__${bridge.serverName}__`);
  });
});
