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
