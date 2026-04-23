/**
 * Gemini adapter — subprocess-based coder for the `gemini` CLI.
 */

import { CliExitError, FeatureNotSupportedError } from '../../errors.js';
import type {
  CoderStreamEvent,
  HeadlessCoder,
  PromptInput,
  RunOpts,
  RunResult,
  SharedStartOpts,
  ThreadHandle,
} from '../../types.js';
import { HttpMcpBridge } from '../../tools/bridge.js';
import { createToolRegistry } from '../../tools/define.js';
import { spawnCli, type SpawnedCli } from '../../transport/spawn.js';
import { buildGeminiArgv } from './flags.js';
import { setupEphemeralGeminiHome, type EphemeralHome } from './home.js';
import { translateGeminiLine } from './translate.js';

export function createGeminiCoder(
  defaults?: SharedStartOpts,
): HeadlessCoder<'gemini'> {
  return new GeminiCoder(defaults);
}

class GeminiCoder implements HeadlessCoder<'gemini'> {
  readonly provider = 'gemini' as const;
  constructor(private readonly defaults?: SharedStartOpts) {}

  async startThread(opts?: SharedStartOpts): Promise<ThreadHandle<'gemini'>> {
    return new GeminiThread({ ...this.defaults, ...opts });
  }

  async resumeThread(
    id: string,
    opts?: SharedStartOpts,
  ): Promise<ThreadHandle<'gemini'>> {
    const t = new GeminiThread({ ...this.defaults, ...opts });
    t.id = id;
    return t;
  }

  async resumeLatest(opts?: SharedStartOpts): Promise<ThreadHandle<'gemini'>> {
    const t = new GeminiThread({ ...this.defaults, ...opts });
    t._resumeLatest = true;
    return t;
  }

  async close(thread: ThreadHandle<'gemini'>): Promise<void> {
    await thread.close();
  }
}

function promptToString(input: PromptInput): string {
  if (typeof input === 'string') return input;
  return input.map((m) => `[${m.role}] ${m.content}`).join('\n');
}

function schemaPreamble(schema: Record<string, unknown>): string {
  return [
    'Respond with a single valid JSON value that conforms to this JSON Schema:',
    JSON.stringify(schema),
    'Do not wrap in code fences. Emit JSON only.',
  ].join('\n');
}

class GeminiThread implements ThreadHandle<'gemini'> {
  readonly provider = 'gemini' as const;
  id?: string;
  /** @internal */ _resumeLatest = false;
  private active?: SpawnedCli;
  private bridge?: HttpMcpBridge;
  private home?: EphemeralHome;

  constructor(private readonly opts: SharedStartOpts) {}

  async run(input: PromptInput, runOpts?: RunOpts): Promise<RunResult<'gemini'>> {
    const events: CoderStreamEvent<'gemini'>[] = [];
    let text: string | undefined;
    let jsonResult: unknown;
    let usage: RunResult<'gemini'>['usage'];
    let error: RunResult<'gemini'>['error'];
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

    if (runOpts?.outputSchema && text !== undefined) {
      try {
        jsonResult = JSON.parse(text.trim());
      } catch {
        /* leave json undefined */
      }
    }

    return {
      provider: 'gemini',
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
  ): AsyncIterable<CoderStreamEvent<'gemini'>> {
    const effectiveOpts: SharedStartOpts & RunOpts = {
      ...this.opts,
      ...runOpts,
    };

    // Best-effort structured output on Gemini: inject the schema into the prompt.
    let prompt = promptToString(input);
    if (effectiveOpts.outputSchema) {
      prompt = `${schemaPreamble(effectiveOpts.outputSchema)}\n\n${prompt}`;
    }

    // Custom tools: set up MCP bridge + ephemeral GEMINI_CLI_HOME.
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...(effectiveOpts.extraEnv ?? {}),
    };
    if (effectiveOpts.tools && effectiveOpts.tools.length > 0) {
      const registry = createToolRegistry(effectiveOpts.tools);
      this.bridge = new HttpMcpBridge({ registry });
      await this.bridge.start();
      this.home = await setupEphemeralGeminiHome({
        bridgeUrl: this.bridge.url,
        mcpServerName: this.bridge.serverName,
      });
      Object.assign(env, this.home.env);
    }

    const argv = buildGeminiArgv({
      prompt,
      opts: effectiveOpts,
      resumeId: this.id,
      resumeLatest: this._resumeLatest && !this.id,
    });

    this.active = spawnCli({
      bin: 'gemini',
      args: argv,
      env,
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
        for (const ev of translateGeminiLine(line)) {
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
        throw new CliExitError('gemini', exitCode, signal, stderrChunks.join('\n'));
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

  async fork(): Promise<ThreadHandle<'gemini'>> {
    throw new FeatureNotSupportedError(
      'gemini',
      'fork',
      'Gemini CLI has no --fork-session equivalent. Use resumeLatest or resumeThread(id) for a new branch.',
    );
  }

  private async cleanup(): Promise<void> {
    if (this.bridge) {
      await this.bridge.close();
      this.bridge = undefined;
    }
    if (this.home) {
      await this.home.cleanup().catch(() => undefined);
      this.home = undefined;
    }
    this.active = undefined;
  }
}
