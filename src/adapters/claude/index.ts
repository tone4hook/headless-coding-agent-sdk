/**
 * Claude adapter — subprocess-based coder for the `claude` CLI.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { CliExitError, FeatureNotSupportedError } from '../../errors.js';
import {
  type CoderStreamEvent,
  type HeadlessCoder,
  type PromptInput,
  type RunOpts,
  type RunResult,
  type SharedStartOpts,
  type ThreadHandle,
} from '../../types.js';
import { HttpMcpBridge } from '../../tools/bridge.js';
import { createToolRegistry } from '../../tools/define.js';
import { spawnCli, type SpawnedCli } from '../../transport/spawn.js';
import { buildClaudeArgv } from './flags.js';
import { translateClaudeLine } from './translate.js';

export function createClaudeCoder(
  defaults?: SharedStartOpts,
): HeadlessCoder<'claude'> {
  return new ClaudeCoder(defaults);
}

class ClaudeCoder implements HeadlessCoder<'claude'> {
  readonly provider = 'claude' as const;
  constructor(private readonly defaults?: SharedStartOpts) {}

  async startThread(opts?: SharedStartOpts): Promise<ThreadHandle<'claude'>> {
    return new ClaudeThread(mergeOpts(this.defaults, opts));
  }

  async resumeThread(
    id: string,
    opts?: SharedStartOpts,
  ): Promise<ThreadHandle<'claude'>> {
    const t = new ClaudeThread(mergeOpts(this.defaults, opts));
    t.id = id;
    return t;
  }

  async resumeLatest(opts?: SharedStartOpts): Promise<ThreadHandle<'claude'>> {
    const t = new ClaudeThread(mergeOpts(this.defaults, opts));
    t._continueLatest = true;
    return t;
  }

  async close(thread: ThreadHandle<'claude'>): Promise<void> {
    await thread.close();
  }
}

function mergeOpts(
  defaults: SharedStartOpts | undefined,
  opts: SharedStartOpts | undefined,
): SharedStartOpts {
  return { ...(defaults ?? {}), ...(opts ?? {}) };
}

function promptToString(input: PromptInput): string {
  if (typeof input === 'string') return input;
  return input
    .map((m) => `[${m.role}] ${m.content}`)
    .join('\n');
}

class ClaudeThread implements ThreadHandle<'claude'> {
  readonly provider = 'claude' as const;
  id?: string;
  /** @internal */ _continueLatest = false;
  private active?: SpawnedCli;
  private bridge?: HttpMcpBridge;
  private mcpConfigPath?: string;

  constructor(private readonly opts: SharedStartOpts) {}

  async run(input: PromptInput, runOpts?: RunOpts): Promise<RunResult<'claude'>> {
    const events: CoderStreamEvent<'claude'>[] = [];
    let text: string | undefined;
    let jsonResult: unknown;
    let usage: RunResult<'claude'>['usage'];
    let error: RunResult<'claude'>['error'];
    let terminalReason: string | undefined;

    for await (const ev of this.runStreamed(input, runOpts)) {
      events.push(ev);
      if (ev.type === 'message' && ev.role === 'assistant' && ev.text) {
        text = (text ?? '') + ev.text;
      }
      if (ev.type === 'usage') usage = ev.stats;
      if (ev.type === 'error') error = { code: ev.code, message: ev.message };
      if (ev.type === 'done') terminalReason = ev.extra?.terminalReason;
    }

    if (text !== undefined && runOpts?.outputSchema !== undefined) {
      try {
        jsonResult = JSON.parse(text);
      } catch {
        // leave json undefined; caller can inspect text
      }
    }

    return {
      provider: 'claude',
      threadId: this.id,
      text,
      json: jsonResult,
      usage,
      events,
      terminalReason,
      error,
    };
  }

  async *runStreamed(
    input: PromptInput,
    runOpts?: RunOpts,
  ): AsyncIterable<CoderStreamEvent<'claude'>> {
    const effectiveOpts: SharedStartOpts & RunOpts = {
      ...this.opts,
      ...runOpts,
    };

    // Set up the MCP bridge if the user supplied custom tools.
    if (effectiveOpts.tools && effectiveOpts.tools.length > 0) {
      const registry = createToolRegistry(effectiveOpts.tools);
      this.bridge = new HttpMcpBridge({ registry });
      await this.bridge.start();

      const mcpConfigDir = await mkdtemp(join(tmpdir(), 'hca-claude-mcp-'));
      this.mcpConfigPath = join(mcpConfigDir, 'mcp.json');
      await writeFile(
        this.mcpConfigPath,
        JSON.stringify({
          mcpServers: {
            [this.bridge.serverName]: {
              type: 'http',
              url: this.bridge.url,
            },
          },
        }),
      );
    }

    const argv = buildClaudeArgv({
      prompt: promptToString(input),
      opts: effectiveOpts,
      resumeId: this.id,
      continueLatest: this._continueLatest && !this.id,
      mcpConfigPath: this.mcpConfigPath,
    });

    this.active = spawnCli({
      bin: 'claude',
      args: argv,
      env: { ...process.env, ...(effectiveOpts.extraEnv ?? {}) },
      cwd: effectiveOpts.workingDirectory,
      signal: runOpts?.signal,
    });

    const stderrChunks: string[] = [];
    const stderrCollector = (async () => {
      for await (const line of this.active!.stderr) stderrChunks.push(line);
    })();

    try {
      for await (const line of this.active.lines) {
        effectiveOpts.onRawLine?.(line);
        for (const ev of translateClaudeLine(line)) {
          if (!this.id && ev.type === 'init' && ev.threadId) {
            this.id = ev.threadId;
          }
          yield ev;
        }
      }
    } finally {
      const { exitCode, signal } = await this.active.done;
      await stderrCollector;
      await this.cleanup();
      if (exitCode !== 0 && signal === null) {
        throw new CliExitError('claude', exitCode, signal, stderrChunks.join('\n'));
      }
    }
  }

  async interrupt(_reason?: string): Promise<void> {
    this.active?.interrupt();
  }

  async close(): Promise<void> {
    const active = this.active;
    active?.kill();
    if (active) {
      await active.done.catch(() => undefined);
    }
    await this.cleanup();
  }

  async fork(): Promise<ThreadHandle<'claude'>> {
    if (!this.id) {
      throw new FeatureNotSupportedError(
        'claude',
        'fork',
        'fork() requires a thread with an established id. Run at least once first.',
      );
    }
    const f = new ClaudeThread({ ...this.opts, forkSession: true });
    f.id = this.id;
    return f;
  }

  private async cleanup(): Promise<void> {
    if (this.bridge) {
      await this.bridge.close();
      this.bridge = undefined;
    }
    if (this.mcpConfigPath) {
      const dir = resolve(dirname(this.mcpConfigPath));
      const tmpRoot = resolve(tmpdir());
      if (dir.startsWith(tmpRoot + '/') || dir.startsWith(tmpRoot + '\\')) {
        try {
          await rm(dir, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
      this.mcpConfigPath = undefined;
    }
    this.active = undefined;
  }
}
