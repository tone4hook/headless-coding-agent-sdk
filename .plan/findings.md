# Findings — headless-coding-agent-sdk

## Project goal

A TypeScript SDK that unifies headless coding-agent **CLI binaries**
behind one I/O schema. MVP targets: the **`claude`** CLI (Claude Code in
headless mode) and the **`gemini`** CLI (Gemini CLI in headless mode).
Clients write against a single schema and switch backends with a line of
config; features available on only one agent are exposed as optional
extras on the shared schema, not hidden or subtracted.

**Scope exclusion — this SDK does not depend on any vendor JS SDK.**
We do not import `@anthropic-ai/claude-agent-sdk`, `@anthropic-ai/sdk`,
`@google/generative-ai`, or similar. The only surface we integrate with
is the CLI subprocess: spawn it, pass flags, parse its stream-json
output, translate events, tear down. Auth, credentials, and model
access are whatever the installed CLI already has configured on the
user's machine.

Reference (studied for shape, not reused): `ohadassulin-headless-coder-sdk`
(`specs/headless-coder.txt`). That project uses the Claude Agent JS SDK
in-process for its Claude adapter; we explicitly diverge from that and
go subprocess-only for both adapters.

## Design decisions (from brainstorming)

- **Chose subprocess-only transport (CLI binaries only) over any vendor-JS-SDK-backed transport.** Both the `claude` and `gemini` CLIs are invoked as child processes in headless mode (`claude -p --output-format stream-json --verbose`, `gemini -p` with JSON streaming). Reason: the product is a wrapper over CLI binaries — not a wrapper over vendor JS SDKs. Honors the "headless coding agent CLI SDK" framing, keeps both adapters mechanically uniform, eliminates any dependency on `@anthropic-ai/claude-agent-sdk` / `@anthropic-ai/sdk` / `@google/generative-ai`, and works for any user who has the CLI installed regardless of whether a vendor JS SDK is published or stable. Adapters expose a "transport" seam internally so a future long-lived subprocess mode can be added without breaking the public API — still subprocess-based, never importing a vendor SDK.

- **Chose unified schema with richer features as optional extras over lowest-common-denominator.** The shared `StartOpts` / `RunOpts` / `CoderStreamEvent` carry every feature; fields only one CLI honors are optional and documented per-field ("Claude only", "Gemini only"). Reason: this is the user's load-bearing design principle — unification must not reduce clients to the weakest agent; the richer agent's capabilities remain reachable through the same schema.

- **Chose per-turn subprocess spawn as the single transport mode for both adapters.** Each `thread.run()` / `thread.runStreamed()` spawns a fresh CLI invocation with `--resume <id>` / `--session-tag <tag>`. Reason: it is the only mode both CLIs support reliably in headless mode; cancellation is trivial (SIGINT the child); no stream-json-input edge cases. Bidirectional features (live permission prompts, custom tool callbacks) are delivered via an MCP bridge instead of a long-lived stdin protocol — so the simpler transport does not cost us capability.

- **Chose in-process MCP bridge for custom tools with per-adapter wiring confirmed by code inspection.** The SDK hosts a localhost HTTP MCP server per thread and wires it differently per CLI, both without mutating user files:
  - **Claude**: per-invocation `--mcp-config <file>` flag pointing at an ephemeral JSON file with our bridge's `httpUrl`. Paired with `--strict-mcp-config` to ensure only our bridge is active during the run.
  - **Gemini**: spawn `gemini` with `GEMINI_CLI_HOME=<ephemeralDir>` (verified at `chunk-ETUADTWF.js:41664` — `homedir()` checks this env var first, redirecting all `.gemini/` lookups). Pre-populate `<ephemeralDir>/.gemini/settings.json` with `mcpServers.__sdk_bridge` pointing at our localhost HTTP MCP URL, and symlink `oauth_creds.json`, `google_accounts.json`, `installation_id`, `trustedFolders.json`, `projects.json`, and `extensions/` from the real `~/.gemini` so user auth and installed extensions still work. Teardown removes the ephemeral dir; user files are untouched. Concurrency-safe because each thread gets its own `GEMINI_CLI_HOME`.

  Reason: both CLIs natively support MCP as a client, giving us mid-turn tool callbacks uniformly. This wiring strategy keeps the mutation surface zero on the user's real config and scales to concurrent threads.

- **Deferred live interactive permission callbacks out of MVP.** Neither `claude` nor `gemini` exposes a permission-prompt-tool-style flag at the CLI layer (claude's `--permission-prompt-tool` is an Agent SDK feature, not a CLI flag; gemini only offers `--approval-mode` + `--policy`). The shared schema will expose a **static `permissionPolicy`** option mapped to each CLI's native modes/policy flags at MVP, and reserve a future `onPermissionRequest(req)` hook for when a supported transport (Gemini ACP mode, or a Claude CLI flag that surfaces) is wired in. Reason: the principle says "don't subtract richer capability" — but we also don't invent capability that the CLI doesn't provide. Static policy is what both CLIs honestly support today; live callbacks stay as a named future extension.

- **Chose HTTP-localhost MCP transport over stdio-child-proxy MCP transport.** SDK binds an HTTP MCP server on `127.0.0.1:<random-port>` per thread and tears it down on `thread.close()`. Reason: no helper-script IPC dance, simpler lifecycle management, cleaner teardown, and both CLIs support remote MCP servers.

- **Chose three-layer event envelope over flat `originalItem: any` escape hatch.** Every event has (1) universal normalized fields, (2) a typed `extra` discriminated by `provider` for structured provider-specific extensions the SDK promotes, (3) `originalItem: unknown` for the full raw CLI JSON as last-resort escape hatch. Reason: `originalItem: any` alone gives clients no autocomplete and hides richer features behind opacity — effectively subtracting them, which violates the unification principle. The typed `extra` field surfaces provider-specific richness through the TypeScript API so consumers discover it at compile time.

- **Chose generic-over-provider-literal factory for type narrowing.** `createCoder<'claude'>(...)` / `createCoder<'gemini'>(...)` narrows `ThreadHandle`'s event stream so `provider` literals drive `extra` narrowing automatically. Reason: without this the optional-extras design is un-discoverable; with it, swapping providers surfaces type errors exactly where richer-on-one-side features were used.

- **Chose flexible `inputSchema` acceptance (type record | JSON Schema | `.parse()`-compatible) for custom tools.** SDK normalizes internally to JSON Schema before handing to the MCP bridge. Reason: the principle is unification of I/O, not forcing a validation library; accepting anything `.parse()`-shaped means Zod works out of the box without the SDK depending on Zod.

- **Chose permission callback as an optional top-level hook, implemented via the MCP bridge.** `onPermissionRequest: (req) => Promise<Decision>` on `StartOpts`. Claude wires through `--permission-prompt-tool mcp__bridge__approval`; Gemini does a best-effort equivalent. Reason: same mechanism as custom tools — capability is universal through MCP, and the shared schema stays clean.

- **Chose single package with subpath exports over pnpm monorepo with separate adapter packages.** Ship `@pkg/sdk` with `@pkg/sdk/claude` and `@pkg/sdk/gemini` subpaths. Reason: adapters are thin (subprocess + event translation, no heavy SDK deps), so the monorepo overhead buys nothing at MVP. Subpath imports still give tree-shakability for consumers who only want one adapter.

- **Chose direct-factory exports plus a thin generic `createCoder(name, opts)` over a global adapter registry.** Reason: the reference project's `registerAdapter` + `createCoder(name)` dance exists to keep adapters as optional peer dependencies in a monorepo — a problem we do not have with single-package + subpath exports. Direct factories (`createClaudeCoder`, `createGeminiCoder`) are type-narrow by construction; `createCoder(name, opts)` is a convenience switch on top.

- **Chose unified thread/session model with UUID identifiers on both adapters.** Verified live: Claude emits `session_id` (UUID) on every stream-json line from the first; Gemini's `init` event emits `session_id` (UUID) too. Gemini's `--resume` help text claims only `"latest"|index` but `--resume <uuid>` works in practice. `thread.id` is therefore a UUID string for both adapters, captured from the first stream-json line. Claude can optionally pre-specify the id via `--session-id <uuid>` (Gemini has no equivalent; the first run captures the assigned UUID). `startThread()` / `resumeThread(id)` / `run` / `runStreamed` / `interrupt` / `close` are universal. Claude-only extras `thread.fork()` (→ `--fork-session`) and `thread.continueLatest()` (→ `--continue`) live as optional methods that throw `FeatureNotSupportedError` on Gemini; Gemini's `--resume latest` is exposed as a shared `coder.resumeLatest()` convenience with both adapters honoring their native form.

- **Chose SIGINT-based cancellation via `thread.interrupt()` and `AbortSignal` in `RunOpts`.** Per-turn spawn makes this trivial: first call SIGINTs the active child, second escalates to SIGTERM; run resolves/emits `cancelled`. Reason: standard POSIX semantics, no protocol invention, works identically for both adapters.

- **Chose `outputSchema` on `RunOpts` as a shared option, implemented via each CLI's native surface.** Claude `claude` CLI has **native JSON-schema-validated structured output** via `--json-schema <schema>` paired with `--output-format=json` — this is a CLI flag, not an Agent SDK feature. Gemini CLI has `--output-format json` but no schema flag, so the Gemini adapter either does prompt-injection best-effort (schema stringified into the system prompt + JSON output format) or throws `FeatureNotSupportedError` when `strictSchema: true`. Reason: the principle — do not drop the richer capability; expose it with clear degradation semantics. **Framing correction: this is a CLI-native feature on Claude, not a vendor-SDK feature; the SDK stays CLI-only.**

- **Chose recorded-transcript fixture tests for event normalization + live examples dir for end-to-end.** Event translator is a pure `(rawLine: string) => CoderStreamEvent | null`, snapshot-tested against JSONL fixtures in CI. Live tests in `examples/` spawn real CLIs and are skipped without credentials. Reason: matches the reference's practical testing structure, but the pure-function translator is the right boundary for deterministic unit coverage.

## Proposed package layout

```
headless-coding-agent-sdk/
├─ package.json                 # single package, subpath exports
├─ tsconfig.json
├─ src/
│  ├─ index.ts                  # public API: createCoder, types
│  ├─ types.ts                  # StartOpts, RunOpts, ThreadHandle, CoderStreamEvent (generic over Provider)
│  ├─ errors.ts                 # FeatureNotSupportedError, CoderError, ...
│  ├─ factory.ts                # createCoder(name, opts) generic switch
│  ├─ tools/
│  │  ├─ define.ts              # tool() definition helper, schema normalization
│  │  └─ bridge.ts              # localhost HTTP MCP server (per-thread)
│  ├─ transport/
│  │  └─ spawn.ts               # child_process wrapper: spawn, stream stdout lines, cancel
│  └─ adapters/
│     ├─ claude/
│     │  ├─ index.ts            # createClaudeCoder
│     │  ├─ translate.ts        # raw Claude stream-json line -> CoderStreamEvent
│     │  └─ flags.ts            # StartOpts -> claude CLI argv
│     └─ gemini/
│        ├─ index.ts            # createGeminiCoder
│        ├─ translate.ts        # raw Gemini output -> CoderStreamEvent
│        └─ flags.ts            # StartOpts -> gemini CLI argv
├─ test/
│  ├─ fixtures/
│  │  ├─ claude/*.jsonl         # recorded CLI transcripts
│  │  └─ gemini/*.jsonl
│  └─ translate.test.ts         # pure-function event normalization tests
└─ examples/                    # live CLI tests (skipped in CI w/o creds)
   ├─ claude-stream.ts
   ├─ gemini-stream.ts
   ├─ custom-tools.ts
   └─ permissions.ts
```

## Public API sketch

```ts
// types.ts
export type Provider = 'claude' | 'gemini';

export interface SharedStartOpts {
  model?: string;
  workingDirectory?: string;
  allowedTools?: string[];
  tools?: ToolDefinition[];                    // auto-bridged via MCP
  onPermissionRequest?: (req: PermissionRequest) => Promise<PermissionDecision>;

  // Optional extras (per principle): documented which adapter honors each.
  // Claude-only:
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
  settingSources?: Array<'local' | 'project' | 'user'>;
  includeDirectories?: string[];
  forkSession?: boolean;
  // Gemini-only:
  yolo?: boolean;
  geminiBinaryPath?: string;
  // ...
}

export interface RunOpts {
  signal?: AbortSignal;
  extraEnv?: Record<string, string>;
  outputSchema?: object;                       // Claude native, Gemini best-effort
  strictSchema?: boolean;                      // throw FeatureNotSupportedError instead of best-effort
  streamPartialMessages?: boolean;
}

export type CoderStreamEvent<P extends Provider = Provider> =
  | ({ type: 'init'; provider: P; threadId?: string; model?: string } & EventBase<P, 'init'>)
  | ({ type: 'message'; provider: P; role: 'assistant' | 'user' | 'system'; text?: string; delta?: boolean } & EventBase<P, 'message'>)
  | ({ type: 'tool_use'; provider: P; name: string; callId?: string; args?: unknown } & EventBase<P, 'tool_use'>)
  | ({ type: 'tool_result'; provider: P; name: string; callId?: string; result?: unknown; error?: unknown } & EventBase<P, 'tool_result'>)
  | ({ type: 'permission'; provider: P; request: PermissionRequest; decision?: PermissionDecision } & EventBase<P, 'permission'>)
  | ({ type: 'file_change'; provider: P; path?: string; op?: 'create' | 'modify' | 'delete' | 'rename'; patch?: string } & EventBase<P, 'file_change'>)
  | ({ type: 'plan_update'; provider: P; text?: string } & EventBase<P, 'plan_update'>)   // Claude-favored, Gemini may emit
  | ({ type: 'usage'; provider: P; stats?: { inputTokens?: number; outputTokens?: number } } & EventBase<P, 'usage'>)
  | ({ type: 'error'; provider: P; code?: string; message: string } & EventBase<P, 'error'>)
  | ({ type: 'cancelled'; provider: P } & EventBase<P, 'cancelled'>)
  | ({ type: 'done'; provider: P } & EventBase<P, 'done'>);

interface EventBase<P extends Provider, T extends string> {
  ts: number;
  extra?: ProviderExtras[P][T];                // typed, discriminated
  originalItem?: unknown;                       // full raw CLI JSON
}

// Provider-specific extras surfaced as typed extensions
type ProviderExtras = {
  claude: {
    tool_use: { parentToolUseId?: string; permissionSuggestion?: string };
    message: { thinking?: string };
    init: { sessionFile?: string };
    // ...
  };
  gemini: {
    tool_use: { confirmationId?: string };
    // ...
  };
};

export interface ThreadHandle<P extends Provider = Provider> {
  readonly provider: P;
  id?: string;
  run(input: PromptInput, opts?: RunOpts): Promise<RunResult<P>>;
  runStreamed(input: PromptInput, opts?: RunOpts): AsyncIterable<CoderStreamEvent<P>>;
  interrupt(reason?: string): Promise<void>;
  close(): Promise<void>;
  fork?(): Promise<ThreadHandle<P>>;           // Claude-only; Gemini throws FeatureNotSupportedError
}

export interface HeadlessCoder<P extends Provider = Provider> {
  startThread(opts?: SharedStartOpts): Promise<ThreadHandle<P>>;
  resumeThread(id: string, opts?: SharedStartOpts): Promise<ThreadHandle<P>>;
  close(thread: ThreadHandle<P>): Promise<void>;
}

// factory.ts
export function createCoder<P extends Provider>(
  name: P,
  defaults?: SharedStartOpts,
): HeadlessCoder<P>;
```

## Verified CLI surface (as of claude 2.1.118, gemini 0.38.2)

Flags the design relies on, confirmed present in `--help`:

**`claude` CLI**
- Headless: `-p`, `--output-format text|json|stream-json`, `--verbose`, `--include-partial-messages`, `--include-hook-events`.
- Input streaming: `--input-format text|stream-json`, `--replay-user-messages` (reserved for future long-lived mode).
- Sessions: `--resume [id]`, `--continue`, `--session-id <uuid>`, `--fork-session`, `--no-session-persistence`, `--from-pr`.
- Structured output: `--json-schema <schema>` (native, CLI-level).
- Permissions: `--permission-mode {default|acceptEdits|auto|bypassPermissions|dontAsk|plan}`, `--allowedTools`, `--disallowedTools`, `--allow-dangerously-skip-permissions`, `--dangerously-skip-permissions`.
- MCP: `--mcp-config <configs...>` (per-invocation), `--strict-mcp-config`.
- Model/prompt: `--model`, `--system-prompt`, `--append-system-prompt`, `--agents`.
- Directories: `--add-dir`, `--setting-sources`, `--settings`.
- Budget: `--max-budget-usd`.
- No `--permission-prompt-tool` flag exists at the CLI layer in this version.

**`gemini` CLI**
- Headless: `-p`, `--output-format text|json|stream-json`.
- Sessions: `--resume <"latest"|index>`, `--list-sessions`, `--delete-session <index>`.
- Permissions/policy: `--approval-mode {default|auto_edit|yolo|plan}`, `--policy`, `--admin-policy`, `--allowed-tools` (deprecated in favor of policy engine), `-y/--yolo`.
- MCP: settings-file-based (`gemini mcp` subcommand / `~/.gemini/settings.json`). Not per-invocation. `--allowed-mcp-server-names` scopes which servers are active.
- Directories: `--include-directories`, `-e/--extensions`.
- ACP: `--acp` (Agent Client Protocol — bidirectional, out of MVP scope).
- No `--json-schema` flag — structured output is prompt-injection best-effort.

## Confirmed stream-json event shapes (live capture)

**Claude (`claude 2.1.118`)** — every line carries `session_id`; `uuid` identifies the event itself.
```
{"type":"system","subtype":"hook_started|hook_response|init", "session_id":"<uuid>", "uuid":"<event-uuid>", ...}
{"type":"system","subtype":"init","cwd":"...","session_id":"<uuid>","tools":[...],"mcp_servers":[...],"model":"...","permissionMode":"auto","slash_commands":[...],"apiKeySource":"...","claude_code_version":"2.1.118","output_style":"default","agents":[...],"skills":[...],"plugins":[...],"uuid":"<event-uuid>","memory_paths":{...}}
{"type":"assistant","message":{"id":"...","role":"assistant","content":[{"type":"text","text":"..."}],"usage":{...},"stop_reason":"..."}, "parent_tool_use_id":null,"session_id":"<uuid>","uuid":"<event-uuid>"}
{"type":"result","subtype":"success","is_error":false,"duration_ms":N,"num_turns":N,"result":"...","session_id":"<uuid>","total_cost_usd":N,"usage":{...},"modelUsage":{},"permission_denials":[],"terminal_reason":"completed"}
```

**Gemini (`gemini 0.38.2`)** — `session_id` on init; timestamps on every event.
```
{"type":"init","timestamp":"...","session_id":"<uuid>","model":"..."}
{"type":"message","timestamp":"...","role":"user"|"assistant","content":"...","delta":true?}
{"type":"tool_use","timestamp":"...","tool_name":"...","tool_id":"...","parameters":{...}}
{"type":"tool_result","timestamp":"...","tool_id":"...","status":"success|error","output":"..."}
{"type":"result","timestamp":"...","status":"success","stats":{"total_tokens":N,"input_tokens":N,"output_tokens":N,"cached":N,"duration_ms":N,"tool_calls":N,"models":{"<model>":{...}}}}
```

Event translator mapping to unified `CoderStreamEvent`:
- Claude `system/init` → `init` (populate `threadId`, `model`, `extra.claude.sessionFile`, etc.)
- Claude `system/hook_started|hook_response` → `progress` with `extra.claude.hookName`
- Claude `assistant.message.content[].type === 'text'` → `message` (one event per text item)
- Claude `assistant.message.content[].type === 'tool_use'` → `tool_use`
- Claude `result` → `usage` + `done` (two events: stats, then terminal)
- Gemini `init` → `init`
- Gemini `message` (role=user) → reflected echo, filter or emit as `message(role:'user')`
- Gemini `message` (role=assistant) → `message` (accumulate `delta` chunks or emit as they come per `streamPartialMessages`)
- Gemini `tool_use` → `tool_use` (`name` from `tool_name`, `callId` from `tool_id`, `args` from `parameters`)
- Gemini `tool_result` → `tool_result` (`callId` from `tool_id`, `result` from `output`, error from `status==='error'`)
- Gemini `result` → `usage` + `done`

## Open items deferred to planning

- Capture additional stream-json transcripts into `test/fixtures/` covering tool use, resume, interrupt, structured output, and error cases (CLI versions may evolve).
- Minimum supported CLI versions and runtime detection: `claude --version` / `gemini --version` at `startThread` time; fail fast with typed `CliNotFoundError` / `CliVersionError` below floor (initial floor: claude ≥ 2.1.x, gemini ≥ 0.38.x).
- Gemini `outputSchema` best-effort prompt template (inject schema into system prompt, set `--output-format json`, parse assistant text as JSON).
- Logging / debug hook (`onRawLine(line: string): void` on `StartOpts`) for troubleshooting event translation without exposing internals as a stable API.
- Future extension: bidirectional mode for Claude via `--input-format stream-json` and for Gemini via `--acp`, once a use case (live permission callbacks, streaming user messages back into a running turn) justifies the complexity.
