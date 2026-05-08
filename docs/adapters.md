# Adapter coverage

Per-field mapping of `SharedStartOpts` and `RunOpts` to each CLI, verified
against `claude 2.1.118`, `gemini 0.38.2`, and `codex-cli 0.128.0`.

Legend: ✅ native · ⚠️ best-effort · ❌ `FeatureNotSupportedError`.

## `SharedStartOpts` — universal fields

| Field | Claude | Gemini | Codex |
|---|---|---|---|
| `model` | ✅ `--model` | ✅ `-m` | ✅ `--model` |
| `workingDirectory` | ✅ `cwd` | ✅ `cwd` | ✅ `-C` (also `cwd`) |
| `addDirs` | ✅ `--add-dir` | ❌ | ✅ `--add-dir` |
| `allowedTools` | ✅ `--allowed-tools` | ✅ `--allowed-tools` (deprecated) | ❌ |
| `tools` (custom) | ✅ MCP bridge via `--mcp-config` | ✅ MCP bridge via ephemeral `GEMINI_CLI_HOME` | ❌ no MCP bridge |
| `permissionPolicy.mode` | ✅ → `--permission-mode` | ✅ → `--approval-mode` | ⚠️ see below |
| `permissionPolicy.allow` | ✅ `--allowed-tools` | ⚠️ `--allowed-tools` (deprecated) | ❌ |
| `permissionPolicy.deny` | ✅ `--disallowed-tools` | ❌ | ❌ |
| `extraEnv` | ✅ | ✅ | ✅ |
| `unsetEnv` | ✅ | ✅ | ✅ |
| `onRawLine` | ✅ | ✅ | ✅ |

`extraEnv` empty-string values are preserved as legitimate values; use
`unsetEnv` to delete. `unsetEnv` runs *after* `extraEnv` is merged — typical
use is stripping stale auth env vars to force OAuth/keychain fallback.

Codex `permissionPolicy.mode`:

| Mode | Maps to |
|---|---|
| `bypass` | `--dangerously-bypass-approvals-and-sandbox` |
| `plan` | `--sandbox read-only` |
| anything else | `--full-auto` |

## Claude-only optional extras

| Field | Maps to | Gemini | Codex |
|---|---|---|---|
| `permissionMode` | `--permission-mode` | ❌ | ❌ |
| `settingSources` | `--setting-sources` | ❌ | ❌ |
| `forkSession` | `--fork-session` | ❌ | ❌ |
| `systemPrompt` | `--system-prompt` | ❌ | ❌ |
| `appendSystemPrompt` | `--append-system-prompt` | ❌ | ❌ |
| `agents` | `--agents <json>` | ❌ | ❌ |
| `maxBudgetUsd` | `--max-budget-usd` | ❌ | ❌ |

## Gemini-only optional extras

| Field | Maps to | Claude | Codex |
|---|---|---|---|
| `yolo` | `-y` (normalized to `--approval-mode yolo`) | ❌ | ❌ |
| `sandbox` | `-s` | ❌ | ❌ |
| `approvalMode` | `--approval-mode` | ❌ | ❌ |
| `policyFiles` | `--policy` | ❌ | ❌ |
| `adminPolicyFiles` | `--admin-policy` | ❌ | ❌ |
| `extensions` | `-e` | ❌ | ❌ |
| `includeDirectories` | `--include-directories` | ❌ | ❌ |
| `allowedMcpServerNames` | `--allowed-mcp-server-names` | ❌ | ❌ |

## Codex-only optional extras

| Field | Maps to |
|---|---|
| `codexReasoningEffort` | `-c model_reasoning_effort="<v>"` |
| `codexSandbox` | `--sandbox <v>` (`read-only` / `workspace-write` / `danger-full-access`) |
| `codexNetworkAccess` | `-c sandbox_workspace_write.network_access=<bool>` |
| `codexDisablePlugins` | `--disable plugins` |
| `codexSearch` | `--search` |
| `codexEphemeral` | `--ephemeral` |
| `codexIgnoreUserConfig` | `--ignore-user-config` |
| `codexIgnoreRules` | `--ignore-rules` |
| `codexDangerouslyBypassApprovalsAndSandbox` | `--dangerously-bypass-approvals-and-sandbox` |

All Codex-only fields throw `FeatureNotSupportedError` on Claude and Gemini.

## `RunOpts`

| Field | Claude | Gemini | Codex |
|---|---|---|---|
| `signal` (AbortSignal) | ✅ | ✅ | ✅ |
| `outputSchema` | ✅ `--json-schema` | ⚠️ prompt injection | ✅ `--output-schema <tmpfile>` |
| `strictSchema: true` | ✅ | ❌ | ✅ |
| `streamPartialMessages` | ✅ `--include-partial-messages` (text deltas only; thinking deltas not surfaced) | ⚠️ ignored | ⚠️ ignored |
| `maxTurns` | ✅ `--max-turns` | n/a | ✅ `-c model_turn_limit=<n>` |

With `streamPartialMessages` on Claude, each `content_block_delta` text delta
is emitted as `{type:'message', role:'assistant', delta:true, text}`; the
final aggregated message is still emitted with `delta:false`.

## Known gaps

- **Live permission callbacks** — interactive `onPermissionRequest` is
  deferred; no CLI exposes the hook at the binary layer. `permissionPolicy`
  is the static surrogate.
- **Fork** is Claude-only (`--fork-session`); Gemini and Codex's `fork()`
  throw `FeatureNotSupportedError`.
- **Codex MCP bridge** for custom `tools` is not yet wired.
- **Long-lived bidirectional mode** (Claude `--input-format stream-json`,
  Gemini `--acp`) is a future extension.

## CLI version notes (doc drift vs. installed binary)

Cases where the SDK targets the binary's actual surface rather than the
public docs.

- **Gemini `--output-format stream-json`** is supported on `gemini ≥ 0.38.x`
  even though the public `docs/cli/headless.html` only lists `text` and
  `json`. The unified event stream depends on it.
- **Gemini `--yolo` cannot be combined with `--approval-mode`.** The SDK
  normalizes `yolo: true` into `--approval-mode yolo`. A real conflict
  (e.g. `yolo: true` plus `approvalMode: 'auto_edit'`) raises
  `FeatureNotSupportedError` at the SDK boundary.
- **Gemini MCP bridge is registered with `trust: true`** — without it, custom
  tool calls would stall on confirmation in headless mode.
- **Gemini `GEMINI_CLI_HOME`** is not in the public env-var list but is
  honored by the binary's `homedir()` lookup. `assertBridgeRegistered` in
  `src/adapters/gemini/home.ts` raises `GeminiBridgeNotLoadedError` if a
  future Gemini release ever fails to register the bridge.
- **Claude `--allowed-tools` / `--disallowed-tools`** — both kebab and camel
  forms are accepted aliases; the SDK uses kebab.
- **Codex `exec --json`** emits an evolving JSONL schema. The translator is
  tolerant of adjacent event names (`agent_message` / `message`,
  `tool_call` / `tool_use` / `exec_command_begin`, `done` / `turn_completed`
  / `completed`); see `src/adapters/codex/translate.ts`.

## Event translation reference

See `src/adapters/{claude,gemini,codex}/translate.ts`. Shared shape:
`CoderStreamEvent<P>` with `provider`, type-discriminated top-level fields,
provider-narrowed `extra`, and raw `originalItem`.

| Unified event | Claude source | Gemini source | Codex source |
|---|---|---|---|
| `init` | `system/init` | `init` | `session_configured` / `init` / `started` |
| `message` | `assistant.message.content[type:text\|thinking]` | `message` | `agent_message` / `message` (or payload `type:message`) |
| `tool_use` | `assistant.message.content[type:tool_use]` | `tool_use` | `tool_call` / `tool_use` / `exec_command_begin` / payload `type:function_call` |
| `tool_result` | `user.message.content[type:tool_result]` | `tool_result` | `tool_result` / `exec_command_end` / payload `type:function_call_output` |
| `progress` | `system/hook_*` | (unused) | (unused) |
| `usage` | `result.usage` | `result.stats` | `usage` event or `usage` field on `done` |
| `error` | `result` with `is_error:true` | `result` with `status:error` | `error` (classified via `classifyCodexError`) |
| `done` | `result` (final) | `result` (final) | `done` / `turn_completed` / `completed` (`turn_aborted` → `cancelled`) |
| `stderr` | every CLI stderr line, surfaced live before `done`; same buffer attached to `CliExitError.message` on non-zero exit | same | same |
