import { describe, it, expectTypeOf } from 'vitest';
import type {
  CoderStreamEvent,
  ExtraFor,
  HeadlessCoder,
  ProviderExtras,
  RunResult,
  SharedStartOpts,
  ThreadHandle,
} from '../src/types.js';
import {
  CliExitError,
  CliNotFoundError,
  CliVersionError,
  CoderError,
  FeatureNotSupportedError,
} from '../src/errors.js';

describe('type surface', () => {
  it('narrows ThreadHandle.provider to the literal', () => {
    type ClaudeThread = ThreadHandle<'claude'>;
    type GeminiThread = ThreadHandle<'gemini'>;
    expectTypeOf<ClaudeThread['provider']>().toEqualTypeOf<'claude'>();
    expectTypeOf<GeminiThread['provider']>().toEqualTypeOf<'gemini'>();
  });

  it('narrows CoderStreamEvent by provider literal so extras are discoverable', () => {
    type ClaudeToolUse = Extract<
      CoderStreamEvent<'claude'>,
      { type: 'tool_use' }
    >;
    type GeminiToolUse = Extract<
      CoderStreamEvent<'gemini'>,
      { type: 'tool_use' }
    >;

    // Claude extra has `parentToolUseId` per findings.md.
    expectTypeOf<ClaudeToolUse['extra']>().toMatchTypeOf<
      | { parentToolUseId?: string | null; eventUuid?: string }
      | undefined
    >();

    // Gemini extra has `timestamp`.
    expectTypeOf<GeminiToolUse['extra']>().toMatchTypeOf<
      { timestamp?: string } | undefined
    >();

    // Cross-provider assignment is a compile error in real use (no keys in common
    // means undefined | {} | undefined — we assert the shapes are distinct by
    // checking a field that only exists on one side).
    type ClaudeInitExtra = Extract<
      CoderStreamEvent<'claude'>,
      { type: 'init' }
    >['extra'];
    expectTypeOf<ClaudeInitExtra>().toMatchTypeOf<
      { claudeCodeVersion?: string } | undefined
    >();
  });

  it('ExtraFor helper returns correct shape per pair', () => {
    type ClaudeInit = ExtraFor<'claude', 'init'>;
    type GeminiInit = ExtraFor<'gemini', 'init'>;
    expectTypeOf<ClaudeInit>().toEqualTypeOf<ProviderExtras['claude']['init']>();
    expectTypeOf<GeminiInit>().toEqualTypeOf<ProviderExtras['gemini']['init']>();
  });

  it('RunResult.provider is narrowed by type parameter', () => {
    expectTypeOf<RunResult<'claude'>['provider']>().toEqualTypeOf<'claude'>();
    expectTypeOf<RunResult<'gemini'>['provider']>().toEqualTypeOf<'gemini'>();
    expectTypeOf<RunResult<'claude'>['events']>().toEqualTypeOf<
      CoderStreamEvent<'claude'>[]
    >();
  });

  it('HeadlessCoder.startThread returns a thread with the same provider literal', () => {
    expectTypeOf<
      Awaited<ReturnType<HeadlessCoder<'claude'>['startThread']>>['provider']
    >().toEqualTypeOf<'claude'>();
    expectTypeOf<
      Awaited<ReturnType<HeadlessCoder<'gemini'>['startThread']>>['provider']
    >().toEqualTypeOf<'gemini'>();
  });

  it('SharedStartOpts carries per-provider optional extras', () => {
    // All fields optional — an empty opts is valid.
    const _empty: SharedStartOpts = {};

    // Claude-only field is accepted on the shared type.
    const _claudeOnly: SharedStartOpts = { permissionMode: 'plan' };

    // Gemini-only field is accepted on the shared type.
    const _geminiOnly: SharedStartOpts = { yolo: true };

    // Adapter-level rejection of the wrong provider's field happens at runtime
    // (buildClaudeArgv / buildGeminiArgv throw FeatureNotSupportedError). The
    // schema itself unifies — do not subtract per principle.
    expectTypeOf<SharedStartOpts['permissionMode']>().toBeNullable();
    expectTypeOf<SharedStartOpts['yolo']>().toBeNullable();
  });
});

describe('error hierarchy', () => {
  it('all error classes inherit CoderError', () => {
    const errors = [
      new CliNotFoundError('claude', 'claude'),
      new CliVersionError('gemini', '0.1.0', '0.38.0'),
      new FeatureNotSupportedError('gemini', 'outputSchema', 'Claude-only'),
      new CliExitError('claude', 1, null, 'boom'),
    ];
    for (const e of errors) {
      expectTypeOf(e).toMatchTypeOf<CoderError>();
    }
  });

  it('CoderError carries code and optional provider', () => {
    const e = new CoderError('X', 'msg', 'claude');
    expectTypeOf(e.code).toEqualTypeOf<string>();
    expectTypeOf(e.provider).toEqualTypeOf<'claude' | 'gemini' | undefined>();
  });
});
