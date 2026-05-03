/**
 * AdapterSpec — the per-provider seam that GenericThread runs against.
 *
 * Each adapter (claude, gemini, …) exports a single AdapterSpec value
 * describing how to (a) translate shared opts into argv, (b) translate
 * raw stdout lines into CoderStreamEvents, (c) register the in-process
 * MCP bridge with the underlying CLI, and (d) decide which assistant
 * messages contribute to the accumulated `text` field of RunResult.
 */

import type { HttpMcpBridge } from '../../tools/bridge.js';
import type {
  CoderStreamEvent,
  Provider,
  RunOpts,
  SharedStartOpts,
  ThreadHandle,
} from '../../types.js';

/**
 * What an adapter's MCP registration returns. The shared module appends
 * `argv` to the spawned CLI's argv and merges `env` into the child's
 * environment. `cleanup` runs on thread teardown and is responsible for
 * removing any temp files/dirs the registration created.
 */
export interface McpHandshake {
  argv?: string[];
  env?: Record<string, string>;
  cleanup: () => Promise<void>;
}

/** Inputs the shared module hands to an adapter's argv builder. */
export interface BuildArgvCtx {
  prompt: string;
  opts: SharedStartOpts & RunOpts;
  resumeId?: string;
  /** Resume the most recent session for the cwd (no specific id). */
  resumeLatest: boolean;
}

export interface PreparedRun {
  argv: string[];
  stdin?: string;
  cleanup?: () => Promise<void>;
}

export interface AdapterSpec<P extends Provider> {
  readonly provider: P;
  readonly bin: string;

  /** Build argv from the unified ctx. The shared module appends mcp.argv after this. */
  buildArgv(ctx: BuildArgvCtx): string[];

  /**
   * Prompt transport mode. Stdin keeps long prompts out of argv and avoids
   * shell-length cliffs. Defaults to `argv` for older adapters.
   */
  promptTransport?: 'argv' | 'stdin';

  /**
   * Optional async preparation for adapters that need temp files or other
   * per-run resources before spawn.
   */
  prepareRun?(ctx: BuildArgvCtx): Promise<PreparedRun>;

  /** Translate one raw stdout line into zero or more events. */
  translateLine(line: string): CoderStreamEvent<P>[];

  /** Register the in-process MCP bridge with the CLI. Omitted if the adapter has no MCP support. */
  registerMcp?(bridge: HttpMcpBridge): Promise<McpHandshake>;

  /** Optional prompt rewrite (e.g. inject schema preamble for prompt-based structured output). */
  transformPrompt?(prompt: string, opts: SharedStartOpts & RunOpts): string;

  /** Decide whether an event contributes to RunResult.text. Default: assistant messages with non-empty text. */
  shouldAccumulateText(ev: CoderStreamEvent<P>): boolean;

  /** Adapter-specific fork support. Default (omitted) throws FeatureNotSupportedError. */
  fork?(thread: ThreadHandle<P>): Promise<ThreadHandle<P>>;
}
