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
