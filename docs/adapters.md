# Adapter coverage

Per-field mapping of `SharedStartOpts` and `RunOpts` to each CLI,
verified against `claude 2.1.118` and `gemini 0.38.2`.

Legend: ✅ native support · ⚠️ best-effort · ❌ `FeatureNotSupportedError`.

## `SharedStartOpts` — universal fields

| Field | Claude | Gemini | Notes |
|---|---|---|---|
| `model` | ✅ `--model` | ✅ `-m` | |
| `workingDirectory` | ✅ `cwd` | ✅ `cwd` | Applied at spawn time |
| `allowedTools` | ✅ `--allowed-tools` | ✅ `--allowed-tools` (deprecated) | Gemini prefers `policyFiles` |
| `tools` (custom) | ✅ MCP bridge via `--mcp-config` | ✅ MCP bridge via ephemeral `GEMINI_CLI_HOME` | Both spin up in-process HTTP MCP |
| `permissionPolicy.mode` | ✅ → `--permission-mode` | ✅ → `--approval-mode` | `bypass`/`accept-edits`/`plan` mapped |
| `permissionPolicy.allow` | ✅ `--allowed-tools` | ⚠️ via `--allowed-tools` | Gemini deprecated path |
| `permissionPolicy.deny` | ✅ `--disallowed-tools` | ❌ no native deny-list | Silently ignored on gemini |
| `extraEnv` | ✅ | ✅ | Merged into child env |
| `onRawLine` | ✅ | ✅ | Called per stdout line |

## Claude-only optional extras

| Field | Maps to | Rejected on gemini |
|---|---|---|
| `permissionMode` | `--permission-mode` | ❌ |
| `settingSources` | `--setting-sources` | ❌ |
| `addDirs` | `--add-dir` | ❌ |
| `forkSession` | `--fork-session` | ❌ |
| `systemPrompt` | `--system-prompt` | ❌ |
| `appendSystemPrompt` | `--append-system-prompt` | ❌ |
| `agents` | `--agents <json>` | ❌ |
| `maxBudgetUsd` | `--max-budget-usd` | ❌ |

## Gemini-only optional extras

| Field | Maps to | Rejected on claude |
|---|---|---|
| `yolo` | `-y` | ❌ |
| `sandbox` | `-s` | ❌ |
| `approvalMode` | `--approval-mode` | ❌ |
| `policyFiles` | `--policy` | ❌ |
| `adminPolicyFiles` | `--admin-policy` | ❌ |
| `extensions` | `-e` | ❌ |
| `includeDirectories` | `--include-directories` | ❌ |
| `allowedMcpServerNames` | `--allowed-mcp-server-names` | ❌ |

## `RunOpts`

| Field | Claude | Gemini |
|---|---|---|
| `signal` (AbortSignal) | ✅ | ✅ |
| `outputSchema` | ✅ `--json-schema` | ⚠️ prompt injection |
| `strictSchema: true` | ✅ (same as non-strict) | ❌ throws `FeatureNotSupportedError` |
| `streamPartialMessages` | ✅ `--include-partial-messages` | n/a |
| `maxTurns` | ✅ `--max-turns` | n/a |

## Known gaps (MVP)

- **Live permission callbacks** (interactive `onPermissionRequest`) are
  deferred. Neither CLI exposes the hook at the binary layer today.
  Static `permissionPolicy` is the MVP surrogate.
- **Fork** is Claude-only (`--fork-session`); Gemini's `fork()` throws
  `FeatureNotSupportedError` unconditionally.
- **Long-lived bidirectional mode** is a future extension (Claude
  `--input-format stream-json`, Gemini `--acp`).

## Event translation reference

See `src/adapters/claude/translate.ts` and `src/adapters/gemini/translate.ts`.
Shared shape: `CoderStreamEvent<P>` with `provider`, type-discriminated
top-level fields, provider-narrowed `extra`, and raw `originalItem`.

| Unified event | Claude source | Gemini source |
|---|---|---|
| `init` | `system/init` | `init` |
| `message` | `assistant.message.content[type:text\|thinking]` | `message` |
| `tool_use` | `assistant.message.content[type:tool_use]` | `tool_use` |
| `tool_result` | `user.message.content[type:tool_result]` | `tool_result` |
| `progress` | `system/hook_*` | (unused) |
| `usage` | `result.usage` | `result.stats` |
| `error` | `result` with `is_error:true` | `result` with `status:error` |
| `done` | `result` (final) | `result` (final) |
