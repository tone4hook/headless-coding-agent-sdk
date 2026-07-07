# Adapter coverage

Per-field mapping of `SharedStartOpts` and `RunOpts` to each CLI, checked
against current stable docs and local binaries:

- Claude Code `2.1.202`
- Codex CLI `0.142.5`
- GitHub Copilot CLI `1.0.68`
- Pi coding agent `0.80.3`

Legend: ✅ native · ⚠️ best-effort/partial · ❌ `FeatureNotSupportedError`.

## Architecture stance

The SDK remains subprocess-only for v1. That approach is sound for this
project: `AdapterSpec` gives one real seam for argv/env/event translation,
while shared code owns process lifecycle, prompt transport, custom-tool
bridging, env hygiene, stall handling, and cleanup. Vendor SDKs, Copilot
ACP, and Pi RPC can be future transports without forcing a rewrite of the
public event schema.

## Universal fields

| Field | Claude | Codex | Copilot | Pi |
|---|---|---|---|---|
| `model` | ✅ `--model` | ✅ `--model` | ✅ `--model` | ✅ `--model` |
| `reasoningEffort` | ✅ `--effort` (`low`..`max`) | ✅ `-c model_reasoning_effort` (`none`..`xhigh`) | ✅ `--effort` (`none`, `low`..`max`) | ✅ `--thinking` (`none`→`off`, `minimal`..`xhigh`) |
| `workingDirectory` | ✅ process `cwd` | ✅ `-C` plus process `cwd` | ✅ `-C` plus process `cwd` | ✅ process `cwd` |
| `addDirs` | ✅ `--add-dir` | ✅ `--add-dir` | ✅ `--add-dir` | ❌ |
| `allowedTools` | ✅ `--allowed-tools` | ❌ | ✅ `--allow-tool` | ⚠️ `--tools` allowlist |
| `tools` custom SDK bridge | ✅ `--mcp-config` | ✅ `-c mcp_servers.*` | ✅ `--additional-mcp-config @tempfile` | ❌ |
| `permissionPolicy.mode=plan` | ✅ `--permission-mode plan` | ✅ `--sandbox read-only` | ✅ `--mode plan` | ✅ `--tools read,grep,find,ls` |
| `permissionPolicy.mode=bypass` | ✅ `--permission-mode bypassPermissions` | ✅ `--dangerously-bypass-approvals-and-sandbox` | ✅ `--allow-all` | ⚠️ no extra flag |
| `permissionPolicy.allow` | ✅ `--allowed-tools` | ❌ | ✅ `--allow-tool` | ⚠️ `--tools` |
| `permissionPolicy.deny` | ✅ `--disallowed-tools` | ❌ | ✅ `--deny-tool` | ✅ `--exclude-tools` |
| `extraEnv` / `unsetEnv` | ✅ | ✅ | ✅ | ✅ |
| `onRawLine` | ✅ | ✅ | ✅ | ✅ |

`extraEnv` empty-string values are preserved as legitimate values; use
`unsetEnv` to delete. `unsetEnv` runs after `extraEnv` is merged.

## Claude extras

| Field | Maps to |
|---|---|
| `permissionMode` | `--permission-mode` (`manual` included) |
| `settingSources` | `--setting-sources` |
| `isolation: 'strict'` | fresh `CLAUDE_CONFIG_DIR` plus empty strict MCP config |
| `forkSession` | `--fork-session` on resume |
| `systemPrompt` | `--system-prompt` |
| `appendSystemPrompt` | `--append-system-prompt` |
| `agents` | `--agents <json>` |
| `maxBudgetUsd` | `--max-budget-usd` |
| `claudeBare` | `--bare` |
| `claudeNoSessionPersistence` | `--no-session-persistence` |

Claude rejects Codex, Copilot, and Pi-only fields with
`FeatureNotSupportedError`.

## Codex extras

| Field | Maps to |
|---|---|
| `codexReasoningEffort` | `-c model_reasoning_effort="<v>"` (legacy alias; prefer `reasoningEffort`) |
| `codexSandbox` | `--sandbox <v>` (`read-only`, `workspace-write`, `danger-full-access`) |
| `codexNetworkAccess` | `-c sandbox_workspace_write.network_access=<bool>` |
| `codexDisablePlugins` | `--disable plugins` |
| `codexSearch` | `--search` |
| `codexEphemeral` | `--ephemeral` |
| `codexIgnoreUserConfig` | `--ignore-user-config` |
| `codexIgnoreRules` | `--ignore-rules` |
| `codexDangerouslyBypassApprovalsAndSandbox` | `--dangerously-bypass-approvals-and-sandbox` |

Codex defaults to explicit `--sandbox workspace-write`; deprecated
`--full-auto` is not used. Resume maps to
`codex exec resume <SESSION_ID> -` or `codex exec resume --last -`.

## Copilot extras

| Field | Maps to |
|---|---|
| `copilotMode` | `--mode interactive|plan|autopilot` |
| `copilotAgent` | `--agent` |
| `copilotAllowUrls` | `--allow-url` |
| `copilotDenyUrls` | `--deny-url` |
| `copilotAvailableTools` | `--available-tools` |
| `copilotExcludedTools` | `--excluded-tools` |
| `copilotAdditionalMcpConfig` | `--additional-mcp-config` |

Copilot headless mode uses
`copilot -p <prompt> --output-format json --no-ask-user`.

## Pi extras

| Field | Maps to |
|---|---|
| `piProvider` | `--provider` |
| `piModels` | `--models` comma list |
| `piNoSession` | `--no-session` |
| `piSessionDir` | `--session-dir` |
| `piNoContextFiles` | `--no-context-files` |
| `piNoExtensions` | `--no-extensions` |
| `piNoSkills` | `--no-skills` |
| `piNoPromptTemplates` | `--no-prompt-templates` |

Pi headless mode uses `pi --mode json --print` with prompt over stdin. The
adapter sets `PI_OFFLINE=1` by default so startup network checks do not
surprise headless runs; callers can override by passing `extraEnv.PI_OFFLINE`.

## Run options

| Field | Claude | Codex | Copilot | Pi |
|---|---|---|---|---|
| `signal` | ✅ | ✅ | ✅ | ✅ |
| `outputSchema` | ✅ `--json-schema` | ✅ `--output-schema <tmpfile>` | ⚠️ prompt injection | ⚠️ prompt injection |
| `strictSchema: true` | ✅ | ✅ | ❌ | ❌ |
| `streamPartialMessages` | ✅ `--include-partial-messages` | ⚠️ ignored | ⚠️ JSONL-dependent | ⚠️ `message_update` deltas |
| `maxTurns` | ✅ `--max-turns` | ✅ `-c model_turn_limit=<n>` | ❌ | ❌ |

## Known gaps

- Live permission callbacks remain out of scope; CLIs expose static policy
  flags, not a portable callback hook at the binary layer.
- `fork()` is implemented only for Claude. Copilot has no fork operation;
  Pi has `--fork`, but the SDK has not mapped it safely yet.
- Pi custom SDK `tools` throw `FeatureNotSupportedError` until a documented
  MCP/SDK bridge exists for its headless transport.
- Long-lived bidirectional transports are future work.

## Event translation reference

See `src/adapters/{claude,codex,copilot,pi}/translate.ts`. Shared shape:
`CoderStreamEvent<P>` with `provider`, type-discriminated top-level fields,
provider-narrowed `extra`, and raw `originalItem`.

| Unified event | Claude source | Codex source | Copilot source | Pi source |
|---|---|---|---|---|
| `init` | `system/init` | `thread.started` / `session_configured` | `session` / `init` | `session` |
| `message` | assistant text / partial deltas | `item.completed` agent message / older message events | assistant message / terminal result text | `message_update` / `message_end` |
| `tool_use` | assistant `tool_use` | `item.started` tool events / older tool events | tool execution start | `tool_execution_start` |
| `tool_result` | user `tool_result` | `item.completed` tool events / older tool results | tool execution end | `tool_execution_end` |
| `progress` | hooks / unknown system subtypes | turn/item/reasoning progress | unknown JSONL records | turn/tool progress |
| `usage` | result usage | `usage` or terminal usage | usage records or terminal usage | `turn_end` usage |
| `error` | error result | `error` / `turn.failed` | `error` | `error` |
| `done` | result | `turn.completed` / `done` | `done` / `result` | `agent_end` |
| `stderr` | every CLI stderr line, surfaced live before non-zero `CliExitError` | same | same | same |
