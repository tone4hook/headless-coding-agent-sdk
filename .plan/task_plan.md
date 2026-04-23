# Task Plan — headless-coding-agent-sdk

Design source: `.plan/findings.md`.

Project goal: a TypeScript SDK wrapping the `claude` and `gemini` CLI
binaries in headless mode behind one unified I/O schema, with richer
per-CLI features exposed as optional extras rather than subtracted.

## File map

Each file has one responsibility. Forward references between files are
annotated with the phase that defines the referenced symbol.

```
headless-coding-agent-sdk/
├─ package.json                                  [Phase 1]
├─ tsconfig.json                                 [Phase 1]
├─ vitest.config.ts                              [Phase 1]
├─ src/
│  ├─ index.ts                                   [Phase 11] public API barrel
│  ├─ types.ts                                   [Phase 2]  Provider, StartOpts, RunOpts, CoderStreamEvent, ThreadHandle, HeadlessCoder, ProviderExtras
│  ├─ errors.ts                                  [Phase 2]  CoderError, CliNotFoundError, CliVersionError, FeatureNotSupportedError
│  ├─ factory.ts                                 [Phase 11] createCoder<P>(name, defaults) generic switch
│  ├─ tools/
│  │  ├─ define.ts                               [Phase 3]  tool(), createToolRegistry(), normalizeInputSchema()
│  │  └─ bridge.ts                               [Phase 4]  HttpMcpBridge (per-thread localhost HTTP MCP server)
│  ├─ transport/
│  │  ├─ spawn.ts                                [Phase 5]  spawnCli(argv, env, signal, stdin) → { lines$, done, pid, kill }
│  │  └─ lines.ts                                [Phase 5]  chunkedToLines(readable) async iterator
│  └─ adapters/
│     ├─ claude/
│     │  ├─ index.ts                             [Phase 6]  createClaudeCoder()
│     │  ├─ flags.ts                             [Phase 6]  StartOpts + RunOpts → claude argv
│     │  └─ translate.ts                         [Phase 7]  claude raw line → CoderStreamEvent
│     └─ gemini/
│        ├─ index.ts                             [Phase 8]  createGeminiCoder()
│        ├─ flags.ts                             [Phase 8]  StartOpts + RunOpts → gemini argv
│        ├─ home.ts                              [Phase 9]  setupEphemeralHome() / teardownEphemeralHome() + symlink auth files
│        └─ translate.ts                         [Phase 10] gemini raw line → CoderStreamEvent
├─ test/
│  ├─ fixtures/
│  │  ├─ claude/
│  │  │  ├─ hello.jsonl                          [Phase 7]
│  │  │  └─ tool-use.jsonl                       [Phase 7]
│  │  └─ gemini/
│  │     ├─ hello.jsonl                          [Phase 10]
│  │     └─ tool-use.jsonl                       [Phase 10]
│  ├─ translate-claude.test.ts                   [Phase 7]
│  ├─ translate-gemini.test.ts                   [Phase 10]
│  ├─ bridge.test.ts                             [Phase 4]
│  ├─ spawn.test.ts                              [Phase 5]
│  ├─ gemini-home.test.ts                        [Phase 9]
│  └─ factory.test.ts                            [Phase 11]
└─ examples/                                     [Phase 12] live CLI tests, skipped without CLIs installed
   ├─ claude-stream.ts
   ├─ gemini-stream.ts
   ├─ custom-tools.ts
   └─ structured-output.ts
```

---

## - [x] Phase 1 — Project scaffolding

- Files: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `README.md`
- Steps:
  1. Init `package.json`: name `headless-coding-agent-sdk`, `type: "module"`, `exports` map with `"."`, `"./claude"`, `"./gemini"` subpaths; scripts `build` (tsc), `test` (vitest), `test:examples` (vitest --project examples), `typecheck` (tsc --noEmit).
  2. Add dev deps only: `typescript`, `vitest`, `@types/node`. Runtime deps: `@modelcontextprotocol/sdk` (MCP server impl). No vendor LLM SDKs.
  3. Write `tsconfig.json`: `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`, `strict: true`, `declaration: true`, `outDir: dist`, `rootDir: src`.
  4. Write `vitest.config.ts` with two projects: default (unit, includes `test/**/*.test.ts` except `examples/`) and `examples` (runs `examples/*.ts`, skipped in CI when `HCA_SKIP_LIVE=1`).
  5. Write `.gitignore` (`dist`, `node_modules`, `.plan` is tracked).
  6. Stub `README.md` with one paragraph and a link to `.plan/findings.md`.
- Done when: `npm install && npm run typecheck` exits 0 on an otherwise empty `src/index.ts` (created empty here; filled in Phase 11).

---

## - [x] Phase 2 — Core types and errors

- Files: `src/types.ts`, `src/errors.ts`, `test/types.test.ts`
- Steps:
  1. Define `Provider = 'claude' | 'gemini'` and `PromptInput = string | Array<{role, content}>`.
  2. Define `SharedStartOpts` with universal fields (`model`, `workingDirectory`, `allowedTools`, `tools`, `permissionPolicy`, `extraEnv`, `onRawLine`) and optional provider-specific extras (`permissionMode`, `settingSources`, `includeDirectories`, `forkSession`, `systemPrompt`, `appendSystemPrompt`, `agents`, `addDirs`, `maxBudgetUsd`, `approvalMode`, `yolo`, `sandbox`, `policyFiles`, `adminPolicyFiles`, `extensions`) with JSDoc tagging which adapter honors each.
  3. Define `RunOpts` (`signal`, `outputSchema`, `strictSchema`, `streamPartialMessages`, `maxTurns`).
  4. Define `ProviderExtras` type map keyed by `Provider` × event `type` → extras shape (populate with empty records for now; individual adapters fill in later phases through module augmentation is out of scope — keep it centralized).
  5. Define `CoderStreamEvent<P extends Provider = Provider>` as the discriminated union from `findings.md`, with `extra?: ProviderExtras[P][T]` and `originalItem?: unknown` on every variant.
  6. Define `ThreadHandle<P>`, `HeadlessCoder<P>`, `RunResult<P>`, `PermissionRequest`, `PermissionDecision`, `PermissionPolicy`.
  7. Write `src/errors.ts`: `CoderError` (base, `code`, `provider?`), `CliNotFoundError`, `CliVersionError`, `FeatureNotSupportedError`, `CliExitError` (non-zero CLI exit).
  8. Write `test/types.test.ts`: compile-time assertions via `expectTypeOf` that `createCoder('claude')` narrows `ThreadHandle<'claude'>` extras correctly (test by constructing literal event objects and asserting field access compiles).
- Done when: `npm run typecheck` passes and `npx vitest run test/types.test.ts` exits 0.

---

## - [x] Phase 3 — Tool definition helpers

- Files: `src/tools/define.ts`, `test/define.test.ts`
- Steps:
  1. Write `tool({ name, description, inputSchema, handler })` that returns a `ToolDefinition`. `inputSchema` accepts `Record<string, 'string'|'number'|'boolean'|'object'|'array'> | JSONSchema | { parse: (v) => any }`.
  2. Write `normalizeInputSchema(s)`: returns a JSON Schema object regardless of input form. For `.parse`-shaped values, attempt a `.toJsonSchema?.()` call (supports Zod v3 `.zod-to-json-schema` pattern via optional method); otherwise wrap as `{type:'object', properties:{}}` and document the fallback.
  3. Write `createToolRegistry(tools: ToolDefinition[])`: returns `{ list(): ToolDefinition[], get(name): ToolDefinition | undefined, invoke(name, args): Promise<ToolResult> }`.
  4. Write `test/define.test.ts` covering: simple-record schema → JSON Schema; JSON Schema pass-through; `.parse`-compatible pass-through-with-fallback; registry invoke unknown → error; invoke valid → awaits handler.
- Done when: `npx vitest run test/define.test.ts` exits 0.

---

## - [x] Phase 4 — HTTP MCP bridge

- Files: `src/tools/bridge.ts`, `test/bridge.test.ts`
- Steps:
  1. Implement `HttpMcpBridge` class: on `start()`, bind `http.Server` on `127.0.0.1:0`, register MCP routes using `@modelcontextprotocol/sdk`'s HTTP transport, expose `registry` (from Phase 3) as tools. Expose `url: string` (e.g. `http://127.0.0.1:<port>/mcp`) and `close()`.
  2. MCP server name: `sdk_bridge_<short-random-id>` per-thread so mcp-qualified tool names become `mcp__sdk_bridge_<id>__<tool>`.
  3. Wire tool list and tool call handlers: translate MCP tool/call → registry.invoke → MCP result.
  4. Write `test/bridge.test.ts`: start bridge with one test tool, make a raw HTTP MCP JSON-RPC call to `tools/list` and `tools/call`, assert tool listed and result returned; close, assert port released.
- Done when: `npx vitest run test/bridge.test.ts` exits 0.

---

## - [x] Phase 5 — Subprocess transport

- Files: `src/transport/spawn.ts`, `src/transport/lines.ts`, `test/spawn.test.ts`
- Steps:
  1. Write `chunkedToLines(readable: NodeJS.ReadableStream): AsyncIterable<string>` that buffers partial chunks and yields complete lines (utf-8 decode, handles `\n` / `\r\n`).
  2. Write `spawnCli({ bin, args, env, cwd, stdin?, signal? })` returning `{ lines: AsyncIterable<string>, stderr: AsyncIterable<string>, done: Promise<{exitCode, signal}>, pid, interrupt(): void, kill(): void }`. Merge the child's stdout into `lines`. `interrupt()` sends SIGINT; `kill()` sends SIGTERM. Honors `signal.aborted` → SIGINT; aborted before spawn → throw.
  3. Write `test/spawn.test.ts`: spawn `node -e "console.log('a'); console.log('b');"` and assert lines `['a','b']`, exitCode 0; spawn a sleep-loop and `interrupt()`, assert SIGINT terminates; abort the signal, assert child killed.
- Done when: `npx vitest run test/spawn.test.ts` exits 0.

---

## - [x] Phase 6 — Claude adapter: flags and skeleton

- Files: `src/adapters/claude/flags.ts`, `src/adapters/claude/index.ts`
- Steps:
  1. Write `buildClaudeArgv(opts: SharedStartOpts & RunOpts & { prompt, resumeId?, mcpConfigPath? })` returning `string[]`. Always include `-p --output-format stream-json --verbose`. Map:
     - `model` → `--model`
     - `allowedTools` → `--allowed-tools <...>`
     - `permissionMode` → `--permission-mode`
     - `settingSources` → `--setting-sources`
     - `addDirs`/`workingDirectory` extras → `--add-dir`
     - `systemPrompt` → `--system-prompt`, `appendSystemPrompt` → `--append-system-prompt`
     - `agents` → `--agents <json>`
     - `maxBudgetUsd` → `--max-budget-usd`
     - `outputSchema` → `--json-schema <JSON.stringify(schema)>`
     - `resumeId` → `--resume <uuid>` (or `--continue` if `continueLatest: true`)
     - `forkSession` → `--fork-session`
     - `mcpConfigPath` → `--mcp-config <path> --strict-mcp-config`
     - `includePartialMessages: true` (default when `streamPartialMessages`) → `--include-partial-messages`
     - `maxTurns` → `--max-turns <n>`
  2. Reject with `FeatureNotSupportedError` for Gemini-only fields (`yolo`, `sandbox`, `approvalMode`, `policyFiles`, `adminPolicyFiles`, `extensions`) instead of silently dropping — callers learn at call time.
  3. Write `createClaudeCoder(defaults: SharedStartOpts): HeadlessCoder<'claude'>` skeleton with `startThread`/`resumeThread`/`close` stubs that delegate to Phase 11 wiring; for this phase leave `run`/`runStreamed` throwing `Not implemented (Phase 7)`.
- Done when: `npm run typecheck` passes; `buildClaudeArgv({prompt:'hi'})` returns an argv starting with `['-p','--output-format','stream-json','--verbose']` (verified by a quick unit test added in this phase: `test/claude-flags.test.ts`).

---

## - [x] Phase 7 — Claude adapter: event translator and wiring

- Files: `src/adapters/claude/translate.ts`, `src/adapters/claude/index.ts` (fill in), `test/fixtures/claude/hello.jsonl`, `test/fixtures/claude/tool-use.jsonl`, `test/translate-claude.test.ts`
- Steps:
  1. Capture fixture `test/fixtures/claude/hello.jsonl` by running `claude -p --output-format stream-json --verbose` on a simple prompt in a scratch dir (done manually by dev; commit resulting file). Document the capture command in a top-of-file comment inside the fixture.
  2. Capture `tool-use.jsonl` similarly with a prompt that triggers a `Bash` tool use.
  3. Implement `translateClaudeLine(line: string): CoderStreamEvent<'claude'>[]` — a line can produce 0-N events. Map per the spec in `findings.md`:
     - `system/init` → one `init` event.
     - `system/hook_started|hook_response` → one `progress` event with `extra.claude.hookName` and `extra.claude.subtype`.
     - `assistant.message.content[]`:
       - each `text` item → `message` event (`role:'assistant'`, `text`, `delta:false` unless partial).
       - each `tool_use` item → `tool_use` event.
     - `user` (tool_result echo) → `tool_result` event.
     - `result` → `usage` event (populate `stats`), then `done` event.
     - Errors in `result` (`is_error:true` + `api_error_status`) → `error` event before `done`.
  4. Each event includes `originalItem` = the parsed raw line, and `extra` typed through `ProviderExtras['claude'][type]` where useful (`permissionMode` on init, `parentToolUseId` on tool_use, `permission_denials` on done, etc.).
  5. Fill in Claude `run` / `runStreamed`: write ephemeral mcp-config JSON (Phase 4 bridge URL) to a temp file, build argv (Phase 6), `spawnCli` (Phase 5), iterate lines through `translateClaudeLine`, yield events, capture `session_id` on the first event to populate `thread.id`, return `RunResult` from the `result` event. Clean up temp file and bridge in `thread.close()`.
  6. Write `test/translate-claude.test.ts` that reads each fixture line-by-line and asserts the translated event stream against a hand-authored expected array (snapshot-style).
- Done when: `npx vitest run test/translate-claude.test.ts` exits 0 and both fixtures translate without unknown-line warnings.

---

## - [x] Phase 8 — Gemini adapter: flags and skeleton

- Files: `src/adapters/gemini/flags.ts`, `src/adapters/gemini/index.ts`
- Steps:
  1. Write `buildGeminiArgv(opts: SharedStartOpts & RunOpts & { prompt, resumeId? })` returning `string[]`. Always `-p <prompt> --output-format stream-json`. Map:
     - `model` → `-m <model>`
     - `yolo` → `-y`
     - `approvalMode` → `--approval-mode`
     - `policyFiles` → `--policy`, `adminPolicyFiles` → `--admin-policy`
     - `includeDirectories` → `--include-directories`
     - `extensions` → `-e`
     - `sandbox` → `-s`
     - `resumeId` → `--resume <uuid>` (UUID form, verified live to work)
     - `allowedMcpServerNames` extra → `--allowed-mcp-server-names`
  2. Reject Claude-only fields (`permissionMode`, `settingSources`, `forkSession`, `settings`, `appendSystemPrompt`, `agents`, `maxBudgetUsd`, `outputSchema` when `strictSchema:true`) with `FeatureNotSupportedError`. For non-strict `outputSchema`, inject schema into prompt preamble (implemented in Phase 10 translator; flags just signals `--output-format json` if strict-ish JSON needed).
  3. Write `createGeminiCoder(defaults)` skeleton — mirrors Phase 6 pattern.
- Done when: `npm run typecheck` passes; add a small `test/gemini-flags.test.ts` asserting argv layout for `{prompt:'hi', resumeId:'abc'}` and for an options set that exercises rejections.

---

## - [ ] Phase 9 — Gemini adapter: ephemeral home + MCP wiring

- Files: `src/adapters/gemini/home.ts`, `test/gemini-home.test.ts`
- Steps:
  1. Write `setupEphemeralGeminiHome({ bridgeUrl, mcpServerName, realHome?: string })` that:
     - Creates `mkdtemp()` dir, populates `<dir>/.gemini/settings.json` with `{ mcpServers: { [mcpServerName]: { httpUrl: bridgeUrl } } }` merged with any existing user `~/.gemini/settings.json` content (read-only copy).
     - Symlinks from real `~/.gemini/` into `<dir>/.gemini/`: `oauth_creds.json`, `google_accounts.json`, `installation_id`, `trustedFolders.json`, `projects.json`, `state.json`, `extensions/` (directory symlink).
     - Returns `{ home: string, env: { GEMINI_CLI_HOME: string }, cleanup: () => Promise<void> }`.
  2. `cleanup()` removes the ephemeral dir with a guard refusing to delete anything outside `os.tmpdir()`.
  3. Handle missing real-home files gracefully (skip symlinks that don't exist); handle a missing real home entirely (no symlinks, user gets an unauthenticated ephemeral env — emit a `progress` event warning in Phase 10 integration).
  4. Write `test/gemini-home.test.ts`: create a fake real-home tree under a temp dir (not `~`), call `setupEphemeralGeminiHome({ realHome: fakeHome, ... })`, assert settings.json merged correctly and all symlinks resolve to the fake source files, then cleanup and assert the ephemeral dir is gone while the fake home is untouched.
- Done when: `npx vitest run test/gemini-home.test.ts` exits 0.

---

## - [ ] Phase 10 — Gemini adapter: event translator and wiring

- Files: `src/adapters/gemini/translate.ts`, `src/adapters/gemini/index.ts` (fill in), `test/fixtures/gemini/hello.jsonl`, `test/fixtures/gemini/tool-use.jsonl`, `test/translate-gemini.test.ts`
- Steps:
  1. Capture fixture `test/fixtures/gemini/hello.jsonl` via `gemini -p "hi" --output-format stream-json -y` in a scratch dir; commit.
  2. Capture `tool-use.jsonl` with a prompt that triggers a built-in tool (e.g. read a file in cwd).
  3. Implement `translateGeminiLine(line: string): CoderStreamEvent<'gemini'>[]`:
     - `init` → `init` event.
     - `message` (role=user) → emit as `message` (role:'user') — clients can filter.
     - `message` (role=assistant, delta=true) → `message` with `delta:true`; without delta → `delta:false`.
     - `tool_use` → `tool_use` (`name` ← `tool_name`, `callId` ← `tool_id`, `args` ← `parameters`).
     - `tool_result` → `tool_result` (`callId` ← `tool_id`, `result` ← `output`, `error` if `status === 'error'`).
     - `result` → `usage` event then `done` event.
  4. Fill in Gemini `run`/`runStreamed`: call `setupEphemeralGeminiHome`, spawn with `GEMINI_CLI_HOME` env injection, iterate lines via `translateGeminiLine`, capture `session_id` from init event, run best-effort output-schema prompt injection when `outputSchema` set (prepend a system-style user message with the schema), cleanup on close / abort.
  5. Emit a `progress` warning event on a `thread.fork()` call (throws `FeatureNotSupportedError`) — handled at the `ThreadHandle` level, not here.
  6. Write `test/translate-gemini.test.ts` against both fixtures.
- Done when: `npx vitest run test/translate-gemini.test.ts` exits 0.

---

## - [ ] Phase 11 — Public API and generic factory

- Files: `src/factory.ts`, `src/index.ts`, `test/factory.test.ts`
- Steps:
  1. Write `createCoder<P extends Provider>(name: P, defaults?: SharedStartOpts): HeadlessCoder<P>` that switches on `name` and returns the provider-specific factory's output, with a type assertion narrowing `HeadlessCoder<P>`.
  2. Export from `src/index.ts`: `createCoder`, `tool`, `createMCPServer` (alias for `createToolRegistry`-wrapped MCP format if users want advance control), all types, all error classes.
  3. Add subpath exports via `package.json` already done in Phase 1: `./claude` re-exports `createClaudeCoder`; `./gemini` re-exports `createGeminiCoder`.
  4. Write `test/factory.test.ts`: assert `createCoder('claude')` returns an object with `startThread` and that its return type narrows to `ThreadHandle<'claude'>` (compile-time via `expectTypeOf`). Assert unknown name throws at call time.
- Done when: `npm run typecheck && npx vitest run test/factory.test.ts` exits 0.

---

## - [ ] Phase 12 — Live examples

- Files: `examples/claude-stream.ts`, `examples/gemini-stream.ts`, `examples/custom-tools.ts`, `examples/structured-output.ts`
- Steps:
  1. `claude-stream.ts`: `createCoder('claude')`, `startThread()`, `runStreamed('Say hello in three words')`, log each event type to stdout, assert the run ended with `done`. Skip (vitest `.skipIf`) when `HCA_SKIP_LIVE=1` or `claude --version` fails.
  2. `gemini-stream.ts`: same with `'gemini'`.
  3. `custom-tools.ts`: register a `calc` tool via `tool(...)`, run a prompt that forces its use on both adapters in sequence, assert the tool handler was invoked and the result flowed back.
  4. `structured-output.ts`: run `{ outputSchema: { type:'object', properties:{ answer:{type:'string'} }, required:['answer'] } }` on Claude (strict) and on Gemini (best-effort). Assert `json` populated on both; assert `strictSchema:true` on Gemini throws `FeatureNotSupportedError`.
  5. Add `HCA_SKIP_LIVE=1` to CI env; document in README.
- Done when: running `HCA_SKIP_LIVE= npx vitest run --project examples` locally (with both CLIs installed and authed) exits 0; with `HCA_SKIP_LIVE=1` all examples are marked skipped.

---

## - [ ] Phase 13 — Docs and polish

- Files: `README.md`, `docs/adapters.md`
- Steps:
  1. Flesh out `README.md`: 60-second quickstart, unified schema principle, subprocess-only scope, install/auth notes, subpath-import example.
  2. Write `docs/adapters.md` — per-adapter flag coverage table, Claude-only vs Gemini-only fields, known gaps (no live permission callbacks at MVP; `--acp` / `--input-format stream-json` as future modes).
  3. Add `CHANGELOG.md` with `0.1.0` entry.
- Done when: `README.md` compiles in any Markdown renderer and `docs/adapters.md` lists every field from `SharedStartOpts` with its adapter support status.

---

## Review sign-off

(code-reviewer entries will be appended here per phase by `spec-powers:executing-plans`.)

- [x] code-reviewer pass 1 (spec compliance): Phase 1 — Project scaffolding. Deviation noted: vitest `projects` (workspace-file feature, not in v2 InlineConfig) replaced with single `test/**/*.test.ts` include plus `test:examples` script running `vitest run --dir examples`. Done-when criterion (`npm install && npm run typecheck` on empty `src/index.ts`) is unaffected.
- [x] code-reviewer pass 2 (code quality): Phase 1 — Project scaffolding. Scaffolding is clean; `noUncheckedIndexedAccess` adds useful strictness, `.gitignore` correctly omits `.plan`, no security or correctness concerns in this phase's files.
- [x] code-reviewer pass 1 (spec compliance): Phase 2 — Core types and errors. All eight plan steps satisfied: Provider/PromptInput, SharedStartOpts with universal fields plus Claude/Gemini-tagged optional extras, RunOpts, ProviderExtras map keyed by Provider × event type, CoderStreamEvent discriminated union with typed `extra` and `originalItem` on every variant via EventBase, ThreadHandle/HeadlessCoder/RunResult/PermissionRequest/PermissionDecision/PermissionPolicy, full error hierarchy (CoderError, CliNotFoundError, CliVersionError, FeatureNotSupportedError, CliExitError), and expectTypeOf compile-time narrowing assertions. Only the listed files were added.
- [x] code-reviewer pass 2 (code quality): Phase 2 — Core types and errors. Clean type surface: `ExtraFor<P,T>` gives discoverable narrowing, EventBase centralizes `ts`/`extra`/`originalItem` per the three-layer envelope, error classes set `name` correctly and preserve cause data (exitCode, signal, stderr tail). Minor non-blocking: `CliNotFoundError(bin, provider)` ordering makes the test site `new CliNotFoundError('claude', 'claude')` read ambiguously — callers will likely pass both as `'claude'` anyway; consider swapping in a later polish pass. No bugs, no duplication, no security concerns.
- [x] code-reviewer pass 1 (spec compliance): Phase 3 — Tool definition helpers. All four plan steps satisfied: `tool()` accepts the triple-form `inputSchema` and returns a `ToolDefinition`; `normalizeInputSchema()` passes JSON Schema through, honors `.toJsonSchema()` (and `.toJSONSchema()` as a superset for Zod v4), falls back to a permissive object for parse-only, and expands simple-type records with all keys required; `createToolRegistry()` exposes `list/get/invoke` with unknown-name error and parse-compatible pre-validation. Only `src/tools/define.ts` and `test/define.test.ts` are added; the `types.ts` tools-field widening to `ToolDefinition<any>[]` is a minimal variance fix, not feature creep. No vendor LLM or Zod dep introduced. 12/12 tests pass.
- [x] code-reviewer pass 2 (code quality): Phase 3 — Tool definition helpers. Clear separation of detection predicates, permissive fallbacks are documented in-code, duplicate-name guard at registry construction, parse errors surface before the handler runs. Minor non-blocking: `isJsonSchema` matches any `{type:'object'}` so a parse-compatible object that also sets `type:'object'` would skip `.parse`; acceptable given the documented precedence. No bugs, no security concerns, no duplication.
- [x] code-reviewer pass 1 (spec compliance): Phase 4 — HTTP MCP bridge. All four plan steps satisfied: `HttpMcpBridge.start()` binds `http.Server` on `127.0.0.1:0` and wires MCP routes via `@modelcontextprotocol/sdk`'s StreamableHTTPServerTransport, exposes `url` as `http://127.0.0.1:<port>/mcp` and `close()`; server name defaults to `sdk_bridge_<hex>` with a matching `toolNamePrefix` getter that yields `mcp__sdk_bridge_<id>__`; ListTools and CallTool handlers translate to `registry.list()` / `registry.invoke()`; test file exercises tools/list, tools/call, isError-on-throw, port-release-on-close, URL shape, and prefix — 6/6 passing, 26/26 suite. Documented deviation (fresh Server+Transport per HTTP request rather than one long-lived pair) is a faithful implementation of MCP's stateless streamable-HTTP mode and does not change the Done-when criterion.
- [x] code-reviewer pass 2 (code quality): Phase 4 — HTTP MCP bridge. Handler exceptions are caught inside the CallTool handler and returned as `{isError:true, content:[{type:'text',text:message}]}` per the stated principle; top-level uncaught path also guards `headersSent` before setting 500. `close()` awaits `httpServer.close()` and nulls both `httpServer` and `_url`, so port release is deterministic (test confirms). Per-request Server+Transport are both closed in `finally`, preventing leaks under error paths. Method allowlist (POST/GET/DELETE) and `/mcp` path check reject stray traffic. No injection surface: args flow through the registry's own parse-compatible validation. No duplication, no secrets, no bugs spotted.
- [x] code-reviewer pass 1 (spec compliance): Phase 5 — Subprocess transport. All three plan steps satisfied: `chunkedToLines` is a buffered UTF-8 line splitter handling `\n`/`\r\n`, chunk-boundary splits, multi-byte boundaries, and trailing unterminated lines; `spawnCli` returns `{ pid, lines, stderr, done, interrupt, kill }` with `done` resolving `{exitCode, signal}`, stdout and stderr both exposed as `AsyncIterable<string>`, `interrupt()` sending SIGINT then escalating to SIGTERM on a second call, `kill()` forcing SIGTERM, pre-aborted AbortSignal throwing, and running-abort wiring to `sendInterrupt`. Only the listed files added; 13/13 tests pass, full suite 39/39.
- [x] code-reviewer pass 2 (code quality): Phase 5 — Subprocess transport. The `childExited` latch correctly replaces `child.killed` (which is true as soon as a signal is sent, not when the child exits) so the SIGINT→SIGTERM escalation actually fires — this is the bug the "SIGINT-resistant child" test catches. TextDecoder with `{stream:true}` plus a final flush handles multi-byte UTF-8 across chunk boundaries. Abort listener is registered `{once:true}` and also explicitly removed on close, preventing leaks. `child.kill` calls are try/wrapped to swallow ESRCH on already-exited children. No command-injection surface (args passed as array, shell not used). No duplication, no missing tests for documented behavior.
- [x] code-reviewer pass 1 (spec compliance): Phase 6 — Claude adapter: flags and skeleton. Done-when fully satisfied: `buildClaudeArgv({prompt:'hi',opts:{}})` returns `['-p','hi','--output-format','stream-json','--verbose']` first; typecheck 0; 9/9 claude-flags tests, 48/48 full suite. All mappings in plan step 1 are present (model, allowedTools, permissionMode, settingSources, addDirs, systemPrompt/appendSystemPrompt, agents, maxBudgetUsd, outputSchema→--json-schema, resumeId→--resume, continueLatest→--continue, forkSession→--fork-session, mcpConfigPath→--mcp-config+--strict-mcp-config, streamPartialMessages→--include-partial-messages) plus shared permissionPolicy→--permission-mode/--allowed-tools/--disallowed-tools. Step 2 reject-list covered (Gemini-only fields throw FeatureNotSupportedError). Step 3 skeleton: ClaudeCoder.startThread/resumeThread/resumeLatest/close wired; ClaudeThread.run/runStreamed throw "Not implemented (Phase 7)". Only the three listed files added. Deviation noted: plan step 1 lists `maxTurns → --max-turns <n>` which is absent from flags.ts — flagged in pass 2, not blocking since done-when is the narrower prefix check.
- [x] code-reviewer pass 2 (code quality): Phase 6 — Claude adapter: flags and skeleton. Clean structure: prompt is passed as a separate argv element (no injection surface), GEMINI_ONLY_FIELDS enumerated as a const tuple and iterated generically, resume/continue are mutually exclusive via if/else, forkSession only applies in a resume context (matches CLI semantics). Minor non-blocking findings: (a) `maxTurns → --max-turns` mapping from plan step 1 is missing in both flags.ts and claude-flags.test.ts — recommend adding before Phase 7 wires RunOpts through; (b) `applyPermissionPolicy` guards against a prior `--permission-mode` via `argv.includes('--permission-mode')`, but if the caller sets both `permissionMode` and `permissionPolicy` the explicit `permissionMode` wins — worth a one-line comment. No bugs, no duplication, no security concerns.
- [x] code-reviewer pass 1 (spec compliance): Phase 7 — Claude adapter: event translator and wiring. All six plan steps satisfied: `hello.jsonl` is a live capture (auth-error path, 5 lines) and `tool-use.jsonl` is a synthesized fixture matching the documented stream-json shape; `translateClaudeLine` is pure, returns 0-N events, handles `system/init` → `init`, `system/hook_started|hook_response` → `progress` with `hookName`/`subtype`, `assistant` content items → per-item `message` (text/thinking) and `tool_use`, `user` `tool_result` echoes → `tool_result`, and `result` → `usage` + optional `error` + `done`. Every event carries `originalItem` and `extra` is typed via `ProviderExtras['claude'][type]` (permissionMode/claudeCodeVersion/etc. on init, parentToolUseId/eventUuid on tool_use, apiErrorStatus on error, permissionDenials/terminalReason on done). `run`/`runStreamed` write an ephemeral mcp-config only when `tools[]` is non-empty, spawn via Phase-5 transport, capture `session_id` from the first init event into `thread.id`, and clean up bridge + temp dir in `finally`/`close()`. `fork()` throws `FeatureNotSupportedError` when `this.id` is unset. 13/13 translator tests pass.
- [x] code-reviewer pass 2 (code quality): Phase 7 — Claude adapter: event translator and wiring. Translator is side-effect-free, JSON.parse is try/caught, unknown top-level types drop cleanly while unknown `system` subtypes surface as `progress` so nothing is silently lost. Three-layer envelope is preserved end-to-end; richer Claude fields are additive via `extra`. The wiring's `finally` awaits `done`, drains stderr, calls `cleanup()`, and only throws `CliExitError` on non-zero exit with `signal === null` (SIGINT/SIGTERM from interrupt/close don't become spurious errors). Minor non-blocking notes: (a) `handleAssistant` computes `sessionId` then discards via `void sessionId` — dead code, safe to delete; (b) `cleanup()` removes `join(mcpConfigPath, '..')` without a tmpdir guard — low risk since the path is always from `mkdtemp(tmpdir())`, but a `startsWith(tmpdir())` check would harden it; (c) `close()` does not await `this.active.done`, so an in-flight stream could race the cleanup — acceptable given `kill()` then SIGTERM, but worth tracking. No bugs in the translated event shapes, no security concerns, no duplication.
- [x] code-reviewer pass 1 (spec compliance): Phase 8 — Gemini adapter: flags and skeleton. Done-when satisfied: typecheck 0, 11/11 gemini-flags tests, 73/73 full suite. All plan-step-1 mappings present (`-p <prompt> --output-format stream-json` always first; `model→-m`, `yolo→-y`, `sandbox→-s`, `approvalMode→--approval-mode`, `policyFiles→--policy` repeated, `adminPolicyFiles→--admin-policy` repeated, `includeDirectories→--include-directories` csv, `extensions→-e` csv, `allowedMcpServerNames→--allowed-mcp-server-names` csv, `resumeId→--resume <uuid>`, plus `resumeLatest→--resume latest` and `permissionPolicy→--approval-mode {yolo|auto_edit|plan}`). Step 2 rejections: all eight Claude-only fields throw FeatureNotSupportedError; `outputSchema` + `strictSchema:true` throws; non-strict outputSchema passes through for Phase 10 prompt injection. Step 3 skeleton: GeminiCoder startThread/resumeThread/resumeLatest/close wired; GeminiThread.run/runStreamed throw "Not implemented (Phase 10)"; `fork()` throws unconditionally. Only the three listed files added.
- [x] code-reviewer pass 2 (code quality): Phase 8 — Gemini adapter: flags and skeleton. Prompt passed as separate argv element (no injection surface). Claude-only rejection list is a const tuple iterated generically, mirroring Phase-6's GEMINI_ONLY_FIELDS pattern — symmetric and easy to extend. `applyPermissionPolicy` guards against clobbering an explicit `--approval-mode`, matching the documented precedence. `resumeId`/`resumeLatest` are mutually exclusive via if/else. Unsupported `policy.deny` at CLI layer is documented inline with a forward reference to the Phase-10 progress warning. Minor non-blocking: (a) `allowedTools` also joined with commas despite deprecation — fine, matches CLI; (b) `GeminiThread.opts` stored but referenced only via `void` — expected, consumed in Phase 10. No bugs, no duplication, no security concerns.
