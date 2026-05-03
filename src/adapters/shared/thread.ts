/**
 * GenericThread — the shared run/runStreamed orchestration that every
 * adapter shares. Adapter-specific behaviour is delegated to AdapterSpec.
 *
 * Lifecycle owned here:
 *   1. (optional) start MCP bridge + adapter-specific registration
 *   2. transformPrompt → buildArgv (+ append mcp.argv)
 *   3. spawn CLI, merge stdout/stderr
 *   4. translate stdout lines → events; capture init id
 *   5. on finally: drain exit, cleanup, raise CliExitError on non-zero exit
 */

import { CliExitError, FeatureNotSupportedError } from '../../errors.js';
import type {
  CoderStreamEvent,
  HeadlessCoder,
  PromptInput,
  Provider,
  RunOpts,
  RunResult,
  SharedStartOpts,
  ThreadHandle,
} from '../../types.js';
import { HttpMcpBridge } from '../../tools/bridge.js';
import { createToolRegistry } from '../../tools/define.js';
import { mergeStdoutStderr } from '../../transport/lines.js';
import { composeEnv, spawnCli, type SpawnedCli } from '../../transport/spawn.js';
import type { AdapterSpec, McpHandshake, PreparedRun } from './spec.js';

export interface GenericThreadInit {
  id?: string;
  resumeLatest?: boolean;
}

export function promptToString(input: PromptInput): string {
  if (typeof input === 'string') return input;
  return input.map((m) => `[${m.role}] ${m.content}`).join('\n');
}

export class GenericThread<P extends Provider> implements ThreadHandle<P> {
  readonly provider: P;
  id?: string;
  /** @internal */ readonly opts: SharedStartOpts;
  private readonly resumeLatest: boolean;
  private active?: SpawnedCli;
  private bridge?: HttpMcpBridge;
  private mcp?: McpHandshake;
  private prepared?: PreparedRun;

  constructor(
    private readonly spec: AdapterSpec<P>,
    opts: SharedStartOpts,
    init?: GenericThreadInit,
  ) {
    this.provider = spec.provider;
    this.opts = opts;
    this.id = init?.id;
    this.resumeLatest = init?.resumeLatest ?? false;
  }

  async run(input: PromptInput, runOpts?: RunOpts): Promise<RunResult<P>> {
    const events: CoderStreamEvent<P>[] = [];
    let text: string | undefined;
    let jsonResult: unknown;
    let usage: RunResult<P>['usage'];
    let error: RunResult<P>['error'];
    let terminalReason: string | undefined;

    for await (const ev of this.runStreamed(input, runOpts)) {
      events.push(ev);
      if (this.spec.shouldAccumulateText(ev) && ev.type === 'message' && ev.text) {
        text = (text ?? '') + ev.text;
      }
      if (ev.type === 'usage') usage = ev.stats;
      if (ev.type === 'error') error = { code: ev.code, message: ev.message };
      if (ev.type === 'done') terminalReason = ev.extra?.terminalReason;
    }

    if (text !== undefined && runOpts?.outputSchema !== undefined) {
      try {
        jsonResult = JSON.parse(text.trim());
      } catch {
        // leave json undefined; caller can inspect text
      }
    }

    return {
      provider: this.provider,
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
  ): AsyncIterable<CoderStreamEvent<P>> {
    const effectiveOpts: SharedStartOpts & RunOpts = {
      ...this.opts,
      ...runOpts,
    };

    let prompt = promptToString(input);
    if (this.spec.transformPrompt) {
      prompt = this.spec.transformPrompt(prompt, effectiveOpts);
    }

    const env = composeEnv(
      process.env,
      effectiveOpts.extraEnv,
      effectiveOpts.unsetEnv,
    );

    if (effectiveOpts.tools && effectiveOpts.tools.length > 0) {
      if (!this.spec.registerMcp) {
        throw new FeatureNotSupportedError(
          this.provider,
          'tools',
          `${this.provider} adapter does not support custom tools.`,
        );
      }
      const registry = createToolRegistry(effectiveOpts.tools);
      this.bridge = new HttpMcpBridge({ registry });
      await this.bridge.start();
      this.mcp = await this.spec.registerMcp(this.bridge);
      if (this.mcp.env) Object.assign(env, this.mcp.env);
    }

    const buildCtx = {
      prompt,
      opts: effectiveOpts,
      resumeId: this.id,
      resumeLatest: this.resumeLatest && !this.id,
    };
    this.prepared = this.spec.prepareRun
      ? await this.spec.prepareRun(buildCtx)
      : {
          argv: this.spec.buildArgv(buildCtx),
          stdin: this.spec.promptTransport === 'stdin' ? prompt : undefined,
        };
    const argv = [...this.prepared.argv];
    if (this.mcp?.argv) argv.push(...this.mcp.argv);

    this.active = spawnCli({
      bin: this.spec.bin,
      args: argv,
      env,
      cwd: effectiveOpts.workingDirectory,
      signal: runOpts?.signal,
      stdin: this.prepared.stdin,
    });

    const stderrChunks: string[] = [];

    try {
      for await (const item of mergeStdoutStderr(
        this.active.lines,
        this.active.stderr,
      )) {
        if (item.src === 'stderr') {
          stderrChunks.push(item.line);
          yield {
            provider: this.provider,
            type: 'stderr',
            line: item.line,
            ts: Date.now(),
          } as CoderStreamEvent<P>;
          continue;
        }
        effectiveOpts.onRawLine?.(item.line);
        for (const ev of this.spec.translateLine(item.line)) {
          if (!this.id && ev.type === 'init' && ev.threadId) {
            this.id = ev.threadId;
          }
          yield ev;
        }
      }
    } finally {
      const { exitCode, signal } = await this.active.done;
      await this.cleanup();
      if (exitCode !== 0 && signal === null) {
        throw new CliExitError(
          this.provider,
          exitCode,
          signal,
          stderrChunks.join('\n'),
        );
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

  async fork(): Promise<ThreadHandle<P>> {
    if (!this.spec.fork) {
      throw new FeatureNotSupportedError(
        this.provider,
        'fork',
        `${this.provider} adapter does not support fork().`,
      );
    }
    return this.spec.fork(this);
  }

  private async cleanup(): Promise<void> {
    if (this.bridge) {
      await this.bridge.close();
      this.bridge = undefined;
    }
    if (this.mcp) {
      await this.mcp.cleanup().catch(() => undefined);
      this.mcp = undefined;
    }
    if (this.prepared?.cleanup) {
      await this.prepared.cleanup().catch(() => undefined);
    }
    this.prepared = undefined;
    this.active = undefined;
  }
}

/**
 * Build a HeadlessCoder<P> backed by GenericThread<P>. Adapter packages
 * compose this with their AdapterSpec to expose `createXCoder()`.
 */
export function createCoderFromSpec<P extends Provider>(
  spec: AdapterSpec<P>,
  defaults?: SharedStartOpts,
): HeadlessCoder<P> {
  const merge = (opts?: SharedStartOpts): SharedStartOpts => ({
    ...(defaults ?? {}),
    ...(opts ?? {}),
  });
  return {
    provider: spec.provider,
    async startThread(opts?: SharedStartOpts) {
      return new GenericThread<P>(spec, merge(opts));
    },
    async resumeThread(id: string, opts?: SharedStartOpts) {
      return new GenericThread<P>(spec, merge(opts), { id });
    },
    async resumeLatest(opts?: SharedStartOpts) {
      return new GenericThread<P>(spec, merge(opts), { resumeLatest: true });
    },
    async close(thread: ThreadHandle<P>) {
      await thread.close();
    },
  };
}
