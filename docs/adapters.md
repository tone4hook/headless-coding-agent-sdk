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

## CLI version notes (doc drift vs. installed binary)

A few SDK choices differ from the public docs of each CLI but match
the actually-shipped binaries we target. Recorded here so reviewers can
verify the divergence is intentional.

- **Gemini `--output-format stream-json`** is supported on the installed
  Gemini binary (`gemini --help` lists choices `text | json | stream-json`
  on `≥ 0.38.x`). The public `docs/cli/headless.html` page only lists
  `text` and `json`; the SDK depends on the binary's actual surface and
  uses `stream-json` to deliver the unified event stream.
- **Gemini `--yolo` cannot be combined with `--approval-mode`.** The
  installed binary errors out at startup with
  *"Cannot use both --yolo (-y) and --approval-mode together. Use
  --approval-mode=yolo instead."* — so the SDK normalizes
  `yolo: true` into `--approval-mode yolo` and never emits `-y`. A real
  conflict (e.g. `yolo: true` plus `approvalMode: 'auto_edit'`) raises
  `FeatureNotSupportedError` at the SDK boundary instead of at process
  spawn.
- **Gemini MCP bridge is registered with `trust: true`.** Per
  `tools/mcp-server.html`, `trust` defaults to `false` and means tool
  calls require user confirmation. The SDK-owned localhost bridge is by
  construction trusted — without `trust: true`, custom tools could stall
  on confirmation in headless mode.
- **Gemini `GEMINI_CLI_HOME` is not in the public env-var list** but is
  honored by the installed binary's `homedir()` lookup. The SDK relies
  on this for non-mutating per-thread config injection. A defensive
  smoke-check (see `assertBridgeRegistered` in `src/adapters/gemini/home.ts`)
  raises `GeminiBridgeNotLoadedError` if the merged settings file ever
  fails to register the bridge, so a future Gemini change gets caught
  loudly instead of silently disabling custom tools.
- **Claude `--allowed-tools` / `--disallowed-tools` (kebab-case).** The
  installed `claude --help` documents both `--allowedTools, --allowed-tools`
  and `--disallowedTools, --disallowed-tools` as aliases of the same
  flag. The SDK uses the kebab form intentionally; either casing is
  accepted.

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
