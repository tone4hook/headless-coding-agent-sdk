# Changelog

## 0.2.0 — UX-parity additions

Three additive features that close the parity gap with a hand-rolled
`HeadlessSession`-style integration: env-var stripping, live stderr
surfacing, and Claude partial-message deltas.

### Added
- `SharedStartOpts.unsetEnv?: string[]` — env vars to delete from the spawn env after `extraEnv` is merged. Empty-string values in `extraEnv` are preserved as legitimate values, so stripping requires this explicit list. Common use: remove stale `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `CLAUDE_CODE_USE_BEDROCK` / `CLAUDE_CODE_USE_VERTEX` to force the CLI's OAuth / keychain fallback.
- New `CoderStreamEvent` variant `{ type: 'stderr'; line: string }` — every stderr line from the CLI subprocess is surfaced live as an event before `done`. The stderr buffer attached to `CliExitError` on non-zero exit is preserved unchanged.
- Claude `RunOpts.streamPartialMessages` is now wired end-to-end. With it set, Claude is invoked with `--include-partial-messages`, and `content_block_delta` text deltas are translated into `{ type: 'message', role: 'assistant', text: <chunk>, delta: true }` events. The final aggregated message at `message_stop` continues to be emitted as `delta: false`. `RunResult.text` filters out `delta: true` chunks to avoid double-counting. Gemini silently ignores `streamPartialMessages`. Thinking deltas are skipped in this version.

### Internal
- `composeEnv(parentEnv, extraEnv?, unsetEnv?)` helper exported from `src/transport/spawn.ts` — single source of truth for child-env composition; both adapter index files route through it.
- `mergeStdoutStderr(stdout, stderr)` async generator added in `src/transport/lines.ts` — merges two `AsyncIterable<string>` into a tagged `{ src, line }` stream preserving arrival order.

### Verified against
- `claude 2.1.118`
- `gemini 0.38.2`

### Still deferred
- Interactive permission callback (`interactivePermissions` on `RunOpts`) — needs CLI prompt-protocol work.
- Long-lived single-subprocess thread mode (`--input-format stream-json` over stdin) — optional perf win.

## 0.1.0 — initial MVP

First release. Ships a unified TypeScript SDK wrapping the `claude`
(Claude Code) and `gemini` (Gemini CLI) binaries in headless mode. No
vendor JS SDK dependencies.

### Added
- `createCoder<P>(name, defaults)` factory with compile-time provider-literal narrowing.
- Direct entry points: `createClaudeCoder`, `createGeminiCoder`. Subpath imports via `/claude` and `/gemini`.
- `ThreadHandle<P>` surface: `run`, `runStreamed`, `interrupt`, `close`, `fork?`.
- `HeadlessCoder<P>`: `startThread`, `resumeThread(id)`, `resumeLatest`, `close`.
- Unified `CoderStreamEvent<P>` discriminated union with three-layer envelope (universal fields + typed `extra` + raw `originalItem: unknown`).
- Custom tools via `tool()` + in-process HTTP MCP bridge (wired per-thread to each CLI — `--mcp-config` on Claude, ephemeral `GEMINI_CLI_HOME` on Gemini).
- `permissionPolicy` shared enum mapped to each CLI's native flags.
- Structured output via `outputSchema` (Claude `--json-schema`, Gemini best-effort prompt injection; `strictSchema: true` to enforce Claude-only).
- `SIGINT`-based `interrupt()` with `SIGTERM` escalation; `AbortSignal` support.
- `CoderError` hierarchy: `CliNotFoundError`, `CliVersionError`, `FeatureNotSupportedError`, `CliExitError`.
- 98 unit tests across 10 files; 7 gated live examples.

### Verified against
- `claude 2.1.118`
- `gemini 0.38.2`

### Known gaps
- Live interactive permission callbacks (deferred; neither CLI exposes the hook at the binary layer today).
- CLI version detection at `startThread` time (`claude --version` / `gemini --version`).
- Bidirectional long-lived subprocess mode (future extension).
