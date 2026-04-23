/**
 * HTTP MCP bridge — per-thread localhost MCP server.
 *
 * The SDK spawns a CLI subprocess that speaks MCP as a client. For
 * custom tools and mid-turn callbacks, we host an MCP server in-process
 * and point the CLI at it via `--mcp-config` (Claude) or `mcpServers` in
 * an ephemeral `GEMINI_CLI_HOME/.gemini/settings.json` (Gemini).
 *
 * Transport: StreamableHTTP on 127.0.0.1:<random-port>. Each HTTP
 * request gets a fresh Server + Transport pair (stateless per-request
 * pattern). The registry supplies the persistent state across calls.
 */

import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { normalizeInputSchema } from './define.js';
import type { ToolRegistry } from './define.js';

export interface HttpMcpBridgeOptions {
  registry: ToolRegistry;
  serverName?: string;
  serverVersion?: string;
}

export class HttpMcpBridge {
  private readonly registry: ToolRegistry;
  readonly serverName: string;
  readonly serverVersion: string;
  private httpServer?: HttpServer;
  private _url?: string;

  constructor(opts: HttpMcpBridgeOptions) {
    this.registry = opts.registry;
    this.serverName =
      opts.serverName ?? `sdk_bridge_${randomBytes(4).toString('hex')}`;
    this.serverVersion = opts.serverVersion ?? '0.1.0';
  }

  async start(): Promise<void> {
    if (this.httpServer) return;

    this.httpServer = createServer((req, res) => {
      this.handle(req, res).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[HttpMcpBridge] uncaught: ${msg}\n`);
        if (!res.headersSent) {
          res.statusCode = 500;
        }
        try {
          res.end(msg);
        } catch {
          /* already ended */
        }
      });
    });

    await new Promise<void>((resolve) => {
      this.httpServer!.listen(0, '127.0.0.1', () => resolve());
    });

    const addr = this.httpServer.address();
    if (!addr || typeof addr === 'string') {
      throw new Error('HttpMcpBridge: could not determine bound port');
    }
    this._url = `http://127.0.0.1:${addr.port}/mcp`;
  }

  private async handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    if (!req.url || !req.url.startsWith('/mcp')) {
      res.statusCode = 404;
      res.end();
      return;
    }
    if (req.method !== 'POST' && req.method !== 'GET' && req.method !== 'DELETE') {
      res.statusCode = 405;
      res.end();
      return;
    }

    // One Server + Transport per request. MCP's streamable-HTTP protocol is
    // stateless; we only need the registry to be long-lived.
    const mcp = this.buildMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    try {
      await mcp.connect(transport);
      await transport.handleRequest(req, res);
    } finally {
      try {
        await transport.close();
      } catch {
        /* ignore */
      }
      try {
        await mcp.close();
      } catch {
        /* ignore */
      }
    }
  }

  private buildMcpServer(): Server {
    const mcp = new Server(
      { name: this.serverName, version: this.serverVersion },
      { capabilities: { tools: {} } },
    );

    mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.registry.list().map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: normalizeInputSchema(t.inputSchema),
      })),
    }));

    mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
      const { name, arguments: args } = req.params;
      try {
        const result = await this.registry.invoke(name, args ?? {});
        return {
          content: result.content,
          isError: result.isError ?? false,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: message }],
          isError: true,
        };
      }
    });

    return mcp;
  }

  get url(): string {
    if (!this._url) throw new Error('HttpMcpBridge: start() not called');
    return this._url;
  }

  get toolNamePrefix(): string {
    return `mcp__${this.serverName}__`;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (!this.httpServer) return resolve();
      this.httpServer.close(() => resolve());
    });
    this.httpServer = undefined;
    this._url = undefined;
  }
}
