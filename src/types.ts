/**
 * Shared type surface for headless-coding-agent-sdk.
 *
 * The unification principle (see `.plan/findings.md`): if one adapter
 * has a richer feature on the same kind of I/O, expose it as an
 * optional field on the shared schema rather than subtracting to a
 * lowest common denominator. JSDoc tags each optional with the
 * adapter(s) that honor it.
 */

export type Provider = 'claude' | 'gemini';

export type PromptInput =
  | string
  | Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export interface ToolResultContentText {
  type: 'text';
  text: string;
}

export interface ToolResultContentImage {
  type: 'image';
  data: string;
  mimeType: string;
}

export interface ToolResultContentResource {
  type: 'resource';
  uri: string;
  mimeType?: string;
  text?: string;
}

export type ToolResultContent =
  | ToolResultContentText
  | ToolResultContentImage
  | ToolResultContentResource;

export interface ToolResult {
  content: ToolResultContent[];
  isError?: boolean;
}

/**
 * Input schema for a tool definition. Accepts:
 *  - A simple type record (`{ latitude: 'number' }`)
 *  - A JSON Schema object (`{ type: 'object', properties: {...} }`)
 *  - Anything with a `.parse(value)` method (Zod-compatible), optionally
 *    with a `.toJsonSchema()` helper.
 */
export type SimpleTypeSchema = Record<
  string,
  'string' | 'number' | 'boolean' | 'object' | 'array'
>;

export interface JsonSchema {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

export interface ParseCompatibleSchema {
  parse: (value: unknown) => unknown;
  toJsonSchema?: () => JsonSchema;
}

export type ToolInputSchema =
  | SimpleTypeSchema
  | JsonSchema
  | ParseCompatibleSchema;

export type ToolHandler<TArgs = unknown> = (
  args: TArgs,
) => Promise<ToolResult> | ToolResult;

export interface ToolDefinition<TArgs = unknown> {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  handler: ToolHandler<TArgs>;
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

export interface PermissionRequest {
  toolName: string;
  input?: unknown;
  reason?: string;
}

export type PermissionDecision =
  | { decision: 'granted' }
  | { decision: 'denied'; reason?: string };

/**
 * Static permission policy mapped to each CLI's native flags.
 * Live interactive callbacks are deferred (see findings.md).
 */
export interface PermissionPolicy {
  /**
   * Coarse mode applied to all tool use.
   *  - `default`: CLI's default behavior (typically interactive prompt — unused in headless)
   *  - `accept-edits`: auto-approve file edits (Claude `acceptEdits`, Gemini `auto_edit`)
   *  - `plan`: read-only planning mode (Claude `plan`, Gemini `plan`)
   *  - `bypass`: approve everything (Claude `bypassPermissions`, Gemini `yolo`)
   */
  mode?: 'default' | 'accept-edits' | 'plan' | 'bypass';
  /** Tool names to always allow without prompt. */
  allow?: string[];
  /** Tool names to always deny. (Claude only; Gemini uses policy engine.) */
  deny?: string[];
}

// ---------------------------------------------------------------------------
// Start / Run options
// ---------------------------------------------------------------------------

export interface SharedStartOpts {
  /** Model name or alias. Both adapters. */
  model?: string;
  /** CWD for the CLI subprocess. Both adapters. */
  workingDirectory?: string;
  /** Pre-allowlisted tool names. Both adapters (distinct flag names). */
  allowedTools?: string[];
  /** Custom tools surfaced via the in-process MCP bridge. Both adapters. */
  tools?: ToolDefinition<any>[];
  /** Static permission policy — mapped per-adapter to native flags. Both adapters. */
  permissionPolicy?: PermissionPolicy;
  /** Extra env vars for the spawned CLI. Both adapters. */
  extraEnv?: Record<string, string>;
  /**
   * Env var names to delete from the spawn env after `extraEnv` is applied.
   * Empty-string values in `extraEnv` are preserved as legitimate values, so
   * stripping requires this explicit list. Common use: remove stale auth env
   * (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_USE_BEDROCK`,
   * `CLAUDE_CODE_USE_VERTEX`) to force the CLI's OAuth / keychain fallback.
   * Both adapters.
   */
  unsetEnv?: string[];
  /** Debug hook — invoked for every raw stdout line before translation. Both adapters. */
  onRawLine?: (line: string) => void;

  // --- Claude-only extras ---
  /** @adapter claude — maps to `--permission-mode`. */
  permissionMode?:
    | 'default'
    | 'acceptEdits'
    | 'auto'
    | 'bypassPermissions'
    | 'dontAsk'
    | 'plan';
  /** @adapter claude — maps to `--setting-sources`. */
  settingSources?: Array<'local' | 'project' | 'user'>;
  /** @adapter claude — maps to `--add-dir`. */
  addDirs?: string[];
  /** @adapter claude — maps to `--fork-session` on resume. */
  forkSession?: boolean;
  /** @adapter claude — maps to `--system-prompt`. */
  systemPrompt?: string;
  /** @adapter claude — maps to `--append-system-prompt`. */
  appendSystemPrompt?: string;
  /** @adapter claude — maps to `--agents <json>`. */
  agents?: Record<string, unknown>;
  /** @adapter claude — maps to `--max-budget-usd`. */
  maxBudgetUsd?: number;

  // --- Gemini-only extras ---
  /** @adapter gemini — maps to `--approval-mode`. */
  approvalMode?: 'default' | 'auto_edit' | 'yolo' | 'plan';
  /** @adapter gemini — maps to `-y/--yolo`. */
  yolo?: boolean;
  /** @adapter gemini — maps to `-s/--sandbox`. */
  sandbox?: boolean;
  /** @adapter gemini — maps to `--policy`. */
  policyFiles?: string[];
  /** @adapter gemini — maps to `--admin-policy`. */
  adminPolicyFiles?: string[];
  /** @adapter gemini — maps to `-e/--extensions`. */
  extensions?: string[];
  /** @adapter gemini — maps to `--include-directories`. */
  includeDirectories?: string[];
  /** @adapter gemini — maps to `--allowed-mcp-server-names`. */
  allowedMcpServerNames?: string[];
}

export interface RunOpts {
  /** Abort the run. Sends SIGINT to the child. */
  signal?: AbortSignal;
  /**
   * JSON Schema for structured output validation.
   *  - Claude: native via `--json-schema`.
   *  - Gemini: best-effort via prompt injection + `--output-format json`, or
   *    throws FeatureNotSupportedError when `strictSchema: true`.
   */
  outputSchema?: JsonSchema;
  /** Throw FeatureNotSupportedError if the adapter cannot honor outputSchema natively. */
  strictSchema?: boolean;
  /** Request partial message deltas where the CLI supports it. */
  streamPartialMessages?: boolean;
  /** Cap the number of model turns for this run. */
  maxTurns?: number;
}

// ---------------------------------------------------------------------------
// Run result
// ---------------------------------------------------------------------------

export interface UsageStats {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  durationMs?: number;
  numTurns?: number;
  /** Full provider-specific usage payload. */
  raw?: unknown;
}

export interface RunResult<P extends Provider = Provider> {
  threadId?: string;
  provider: P;
  text?: string;
  /** Parsed JSON if `outputSchema` was set and the CLI returned valid JSON. */
  json?: unknown;
  usage?: UsageStats;
  /** Full collected event log for this run. */
  events: CoderStreamEvent<P>[];
  /** Terminal reason emitted by the CLI (`success`, `error`, `cancelled`, etc.). */
  terminalReason?: string;
  error?: { code?: string; message: string };
}

// ---------------------------------------------------------------------------
// Provider-specific event extras
// ---------------------------------------------------------------------------

/**
 * Typed, discoverable extras surfaced per provider × event type.
 * Clients access them via `ev.extra` narrowed by `ev.provider`.
 * Unmapped (provider, type) pairs resolve to `undefined`.
 */
export interface ProviderExtras {
  claude: {
    init: {
      cwd?: string;
      apiKeySource?: string;
      claudeCodeVersion?: string;
      permissionMode?: string;
      outputStyle?: string;
      agents?: string[];
      skills?: string[];
      plugins?: Array<{ name: string; path: string; source: string }>;
      mcpServers?: Array<{ name: string; status: string }>;
      sessionFile?: string;
    };
    message: {
      thinking?: string;
      stopReason?: string;
      eventUuid?: string;
      parentToolUseId?: string | null;
    };
    tool_use: {
      parentToolUseId?: string | null;
      eventUuid?: string;
    };
    tool_result: {
      parentToolUseId?: string | null;
    };
    progress: {
      subtype?: string;
      hookName?: string;
      hookId?: string;
      hookEvent?: string;
      exitCode?: number;
      outcome?: string;
    };
    usage: {
      modelUsage?: Record<string, unknown>;
      cacheCreationTokens?: number;
      cacheReadTokens?: number;
    };
    done: {
      numTurns?: number;
      totalCostUsd?: number;
      permissionDenials?: unknown[];
      terminalReason?: string;
      apiErrorStatus?: number;
    };
    error: {
      apiErrorStatus?: number;
    };
    permission: Record<string, never>;
    file_change: Record<string, never>;
    plan_update: Record<string, never>;
    cancelled: Record<string, never>;
    stderr: Record<string, never>;
  };
  gemini: {
    init: {
      timestamp?: string;
    };
    message: {
      timestamp?: string;
    };
    tool_use: {
      timestamp?: string;
    };
    tool_result: {
      timestamp?: string;
      status?: 'success' | 'error';
    };
    progress: {
      timestamp?: string;
    };
    usage: {
      cached?: number;
      toolCalls?: number;
      models?: Record<string, UsageStats>;
    };
    done: {
      terminalReason?: string;
    };
    error: Record<string, never>;
    permission: Record<string, never>;
    file_change: Record<string, never>;
    plan_update: Record<string, never>;
    cancelled: Record<string, never>;
    stderr: Record<string, never>;
  };
}

/** Event type literal keys matching the CoderStreamEvent discriminants. */
export type CoderStreamEventType =
  | 'init'
  | 'message'
  | 'tool_use'
  | 'tool_result'
  | 'progress'
  | 'permission'
  | 'file_change'
  | 'plan_update'
  | 'usage'
  | 'error'
  | 'cancelled'
  | 'done'
  | 'stderr';

/** Lookup the extras shape for a provider × event type pair. */
export type ExtraFor<
  P extends Provider,
  T extends CoderStreamEventType,
> = T extends keyof ProviderExtras[P] ? ProviderExtras[P][T] : never;

interface EventBase<P extends Provider, T extends CoderStreamEventType> {
  provider: P;
  ts: number;
  extra?: ExtraFor<P, T>;
  originalItem?: unknown;
}

// ---------------------------------------------------------------------------
// Streaming events
// ---------------------------------------------------------------------------

export type CoderStreamEvent<P extends Provider = Provider> =
  | ({ type: 'init'; threadId?: string; model?: string } & EventBase<P, 'init'>)
  | ({
      type: 'message';
      role: 'assistant' | 'user' | 'system';
      text?: string;
      delta?: boolean;
    } & EventBase<P, 'message'>)
  | ({
      type: 'tool_use';
      name: string;
      callId?: string;
      args?: unknown;
    } & EventBase<P, 'tool_use'>)
  | ({
      type: 'tool_result';
      name?: string;
      callId?: string;
      result?: unknown;
      error?: unknown;
    } & EventBase<P, 'tool_result'>)
  | ({
      type: 'progress';
      label?: string;
      detail?: string;
    } & EventBase<P, 'progress'>)
  | ({
      type: 'permission';
      request: PermissionRequest;
      decision?: PermissionDecision['decision'];
    } & EventBase<P, 'permission'>)
  | ({
      type: 'file_change';
      path?: string;
      op?: 'create' | 'modify' | 'delete' | 'rename';
      patch?: string;
    } & EventBase<P, 'file_change'>)
  | ({
      type: 'plan_update';
      text?: string;
    } & EventBase<P, 'plan_update'>)
  | ({
      type: 'usage';
      stats?: UsageStats;
    } & EventBase<P, 'usage'>)
  | ({
      type: 'error';
      code?: string;
      message: string;
    } & EventBase<P, 'error'>)
  | ({ type: 'cancelled' } & EventBase<P, 'cancelled'>)
  | ({ type: 'done' } & EventBase<P, 'done'>)
  | ({ type: 'stderr'; line: string } & EventBase<P, 'stderr'>);

export type EventIterator<P extends Provider = Provider> = AsyncIterable<
  CoderStreamEvent<P>
>;

// ---------------------------------------------------------------------------
// Thread handle and coder
// ---------------------------------------------------------------------------

export interface ThreadHandle<P extends Provider = Provider> {
  readonly provider: P;
  /** Session UUID captured from the first stream-json line. Undefined before the first run. */
  id?: string;
  run(input: PromptInput, opts?: RunOpts): Promise<RunResult<P>>;
  runStreamed(input: PromptInput, opts?: RunOpts): EventIterator<P>;
  /** SIGINT the active subprocess. Second call escalates to SIGTERM. */
  interrupt(reason?: string): Promise<void>;
  close(): Promise<void>;
  /** @adapter claude — creates a new session branching from the current one. */
  fork?(): Promise<ThreadHandle<P>>;
}

export interface HeadlessCoder<P extends Provider = Provider> {
  readonly provider: P;
  startThread(opts?: SharedStartOpts): Promise<ThreadHandle<P>>;
  resumeThread(id: string, opts?: SharedStartOpts): Promise<ThreadHandle<P>>;
  /** Resume the most recent session for this coder's project/cwd. */
  resumeLatest(opts?: SharedStartOpts): Promise<ThreadHandle<P>>;
  close(thread: ThreadHandle<P>): Promise<void>;
}
