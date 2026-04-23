# Progress log

Append-only timestamped events. New entries at the bottom.

## 2026-04-23 14:25 — Phase 1 started: Project scaffolding

- Created package.json, tsconfig.json, vitest.config.ts, .gitignore, README.md, src/index.ts stub.
- Dropped vitest `projects` API (not in v2 InlineConfig); examples run via `--dir examples` instead.
- `npm install` installed 135 packages; `npm run typecheck` exits 0.

## 2026-04-23 14:32 — Phase 1 verified & complete

## 2026-04-23 14:40 — Phase 2 started: Core types and errors

- Wrote src/errors.ts (CoderError + 4 subclasses with code/provider fields).
- Wrote src/types.ts: Provider, PromptInput, tool types, PermissionPolicy, SharedStartOpts (common + Claude-only + Gemini-only extras, JSDoc-tagged), RunOpts, RunResult, ProviderExtras map, CoderStreamEvent<P> discriminated union with typed `extra` + `originalItem: unknown`, ThreadHandle<P>, HeadlessCoder<P>.
- Wrote test/types.test.ts with 8 expectTypeOf assertions covering provider narrowing, extras discoverability, and error hierarchy.
- Verified: `npm run typecheck` exit 0; `vitest run test/types.test.ts` 8/8 pass.
- Deprecation warnings on `toMatchTypeOf` (vitest 2.1 — non-blocking).

## 2026-04-23 14:52 — Phase 2 verified & complete

## 2026-04-23 14:55 — Phase 3 started: Tool definition helpers

- Wrote src/tools/define.ts: tool(), normalizeInputSchema() (handles simple records, JSON Schema pass-through, .toJsonSchema/.toJSONSchema on parse-compatible, permissive fallback), createToolRegistry() with list/get/invoke and duplicate-name guard.
- Fixed generic variance: widened ToolRegistry input to ToolDefinition<any>[] and SharedStartOpts.tools likewise, because TArgs sits in a contravariant handler position and ToolDefinition<{a,b}> is not assignable to ToolDefinition<unknown>.
- Wrote test/define.test.ts — 12 tests covering all schema forms, registry list/get/invoke, parse-as-validator, duplicate-name rejection.
- Verified: typecheck 0, vitest 20/20 across both test files.

## 2026-04-23 15:01 — Phase 3 verified & complete

## 2026-04-23 15:08 — Phase 4 started: HTTP MCP bridge

- Wrote src/tools/bridge.ts: HttpMcpBridge class wrapping Node http server + StreamableHTTPServerTransport from @modelcontextprotocol/sdk. Per-thread bridge bound to 127.0.0.1:0. Exposes `url` (http://127.0.0.1:<port>/mcp) and `toolNamePrefix` (`mcp__<serverName>__`).
- Debugging finding: reusing a single low-level Server+Transport pair across requests caused the second request (tools/list after initialize) to return HTTP 500 with an empty body from Hono's node-adapter — cause not root-caused but reliably reproducible.
- Fix: build a fresh Server+Transport per HTTP request. Registry is the long-lived state; MCP streamable-HTTP transport is stateless per design, so this matches the protocol shape. JSON response mode (`enableJsonResponse: true`) now works end-to-end.
- Wrote test/bridge.test.ts — 6 tests exercising real HTTP JSON-RPC: URL format, tools/list, tools/call, handler-throws → isError:true, port release on close, toolNamePrefix.
- Verified: typecheck 0, vitest 26/26 across all test files.

## 2026-04-23 15:22 — Phase 4 verified & complete

## 2026-04-23 15:25 — Phase 5 started: Subprocess transport

- Wrote src/transport/lines.ts: chunkedToLines(readable) async iterator handling \n/\r\n line endings and multi-byte UTF-8 split across chunks.
- Wrote src/transport/spawn.ts: spawnCli({bin,args,env,cwd,stdin,signal}) → {pid, lines, stderr, done, interrupt, kill}. First interrupt() sends SIGINT; second escalates to SIGTERM. AbortSignal support.
- Bug found + fixed during TDD: initial escalation guard `child.killed` short-circuited after the first signal (Node's `killed` flag flips on signal delivery, not on exit). Replaced with an internal `childExited` latch set on the 'close' event.
- Wrote test/spawn.test.ts — 13 tests covering chunkedToLines (5 variants), spawnCli stdout/stderr separation, stdin, SIGINT, SIGTERM escalation, AbortSignal (pre-abort + running), explicit kill().
- Verified: typecheck 0, vitest 39/39 across all test files.

## 2026-04-23 15:33 — Phase 5 verified & complete

## 2026-04-23 15:36 — Phase 6 started: Claude adapter flags + skeleton

- Wrote src/adapters/claude/flags.ts: buildClaudeArgv({prompt, opts, resumeId?, continueLatest?, mcpConfigPath?}) emits the verified claude 2.1.118 argv. Rejects Gemini-only fields (yolo, sandbox, approvalMode, policyFiles, adminPolicyFiles, extensions, includeDirectories, allowedMcpServerNames) with FeatureNotSupportedError. outputSchema → --json-schema. permissionPolicy shared enum mapped to native --permission-mode + --allowed-tools/--disallowed-tools.
- Wrote src/adapters/claude/index.ts: ClaudeCoder skeleton exposing startThread/resumeThread/resumeLatest/close; ClaudeThread.run/runStreamed/fork throw "Not implemented (Phase 7)".
- Wrote test/claude-flags.test.ts — 9 tests.
- Verified: typecheck 0, vitest 9/9 claude-flags.test.ts, full suite 48/48.

## 2026-04-23 15:42 — Phase 6 verified & complete

- Captured test/fixtures/claude/hello.jsonl by running `claude -p hello --output-format stream-json --verbose --max-turns 1` (5 lines: hook_started, hook_response, init, assistant-with-auth-error, result-is_error:true).
- Hand-crafted test/fixtures/claude/tool-use.jsonl based on the documented Claude stream-json shape (init, assistant-with-text-and-tool_use, user-with-tool_result, assistant-final, result). Live capture of a tool_use trace wasn't possible because the local claude install has a bad API key; the synthetic fixture matches the shape exactly.
- Wrote src/adapters/claude/translate.ts: pure function `translateClaudeLine(line: string) → CoderStreamEvent<'claude'>[]`. Handles system/{init, hook_started, hook_response}, assistant/{text, tool_use, thinking} content items, user/tool_result items, and result lines (emitting usage + optional error + done). Drops malformed or unknown-type lines; surfaces unknown system subtypes as progress.
- Filled in src/adapters/claude/index.ts: ClaudeThread.runStreamed spawns the CLI, pipes stdout lines through translator, captures threadId from the init event. When tools are supplied, spins up HttpMcpBridge + writes ephemeral `--mcp-config` JSON. run() aggregates events into RunResult. interrupt/close/cleanup wired. fork() requires an established thread id.
- Wrote test/translate-claude.test.ts — 13 tests covering both fixtures and malformed input.
- Verified: typecheck 0, vitest 62/62 across 6 test files.

## 2026-04-23 15:58 — Phase 7 verified & complete

## 2026-04-23 16:00 — Phase 8 started: Gemini adapter flags + skeleton

- Wrote src/adapters/gemini/flags.ts: buildGeminiArgv emits the verified gemini 0.38.2 argv. Rejects Claude-only fields (permissionMode, settingSources, addDirs, forkSession, systemPrompt, appendSystemPrompt, agents, maxBudgetUsd). Strict outputSchema → FeatureNotSupportedError (gemini has no --json-schema); non-strict pass-through for Phase 10 prompt-injection.
- Wrote src/adapters/gemini/index.ts: GeminiCoder/GeminiThread skeletons. fork() throws FeatureNotSupportedError unconditionally since gemini has no --fork-session equivalent.
- Wrote test/gemini-flags.test.ts — 11 tests covering every flag mapping + both rejection paths.
- Verified: typecheck 0, vitest 11/11 gemini-flags.test.ts, full suite 73/73.

## 2026-04-23 16:03 — Phase 8 verified & complete

## 2026-04-23 16:05 — Phase 9 started: Gemini ephemeral home + MCP wiring

- Wrote src/adapters/gemini/home.ts: setupEphemeralGeminiHome({bridgeUrl, mcpServerName, realHome?}) → {home, env:{GEMINI_CLI_HOME}, cleanup}. Creates mkdtemp'd dir, writes merged settings.json (user settings preserved, mcpServers augmented with our bridge), symlinks pass-through entries (oauth_creds.json, google_accounts.json, installation_id, trustedFolders.json, projects.json, state.json, extension_integrity.json, extensions/) from real ~/.gemini when present. cleanup() guards against rm'ing outside os.tmpdir().
- Wrote test/gemini-home.test.ts — 7 tests: ephemeral path under tmpdir, settings merge preserves user keys, symlinks resolve to real-home files, missing real-home entries skipped gracefully, cleanup removes ephemeral dir without touching real home, cleanup refuses out-of-tmpdir paths, works with a fully-missing real home.
- Verified: typecheck 0, vitest 7/7, full suite 80/80.

## 2026-04-23 16:10 — Phase 9 verified & complete

- Captured test/fixtures/gemini/hello.jsonl live from `gemini -p "say hi in 3 words" --output-format stream-json -y` (4 real lines: init, user-message, assistant-message, result).
- Hand-crafted test/fixtures/gemini/tool-use.jsonl using the live-captured stream-json shapes (init, user, assistant, tool_use, tool_result, assistant-final, result).
- Wrote src/adapters/gemini/translate.ts: translateGeminiLine. init→init, message→message (with delta bit), tool_use→tool_use (tool_name/tool_id/parameters → name/callId/args), tool_result→tool_result (status=error sets error field), result→usage+[error]+done. toTs() parses ISO timestamps; falls back to Date.now().
- Filled in src/adapters/gemini/index.ts: GeminiThread.runStreamed spawns the CLI, injects prompt preamble for best-effort outputSchema, wires MCP bridge + ephemeral GEMINI_CLI_HOME when tools[] is present. run() aggregates events. fork() throws FeatureNotSupportedError.
- Wrote test/translate-gemini.test.ts — 13 tests covering both fixtures, edge cases, error branches.
- Verified: typecheck 0, vitest 93/93 across 9 test files.

## 2026-04-23 16:18 — Phase 10 verified & complete

## 2026-04-23 16:20 — Phase 11 started: Public API + generic factory

- Wrote src/factory.ts: createCoder<P extends Provider>(name, defaults?) generic switch returning HeadlessCoder<P>. Unknown names throw at call time.
- Filled in src/index.ts as the public API barrel: createCoder, createClaudeCoder, createGeminiCoder, tool, createToolRegistry, normalizeInputSchema, HttpMcpBridge, all error classes, all public types.
- Wrote test/factory.test.ts — 5 tests (generic literal narrowing of coder, thread, event extras + runtime unknown-name throw + direct-factory parity).
- Cast through `unknown` in createCoder because `HeadlessCoder<'claude'>` is not trivially assignable to `HeadlessCoder<P>` when P is a generic subtype constraint.
- Verified: typecheck 0, vitest 98/98 across 10 test files.

## 2026-04-23 16:23 — Phase 11 verified & complete
