# Changelog

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
