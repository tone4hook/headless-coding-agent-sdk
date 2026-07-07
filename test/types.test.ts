import { describe, expectTypeOf, it } from 'vitest';
import type {
  CoderStreamEvent,
  ExtraFor,
  HeadlessCoder,
  Provider,
  ProviderExtras,
  ReasoningEffort,
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
  it('narrows provider and thread literals to the supported provider set', () => {
    expectTypeOf<Provider>().toEqualTypeOf<
      'claude' | 'codex' | 'copilot' | 'pi'
    >();
    expectTypeOf<ThreadHandle<'claude'>['provider']>().toEqualTypeOf<'claude'>();
    expectTypeOf<ThreadHandle<'pi'>['provider']>().toEqualTypeOf<'pi'>();
  });

  it('exposes the shared reasoning effort levels', () => {
    expectTypeOf<ReasoningEffort>().toEqualTypeOf<
      'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    >();
  });

  it('narrows CoderStreamEvent by provider literal so extras are discoverable', () => {
    type ClaudeToolUse = Extract<
      CoderStreamEvent<'claude'>,
      { type: 'tool_use' }
    >;
    type CopilotToolUse = Extract<
      CoderStreamEvent<'copilot'>,
      { type: 'tool_use' }
    >;

    expectTypeOf<ClaudeToolUse['extra']>().toMatchTypeOf<
      | { parentToolUseId?: string | null; eventUuid?: string }
      | undefined
    >();
    expectTypeOf<CopilotToolUse['extra']>().toMatchTypeOf<
      { sessionId?: string } | undefined
    >();
  });

  it('ExtraFor helper returns correct shape per pair', () => {
    type ClaudeInit = ExtraFor<'claude', 'init'>;
    type PiInit = ExtraFor<'pi', 'init'>;
    expectTypeOf<ClaudeInit>().toEqualTypeOf<ProviderExtras['claude']['init']>();
    expectTypeOf<PiInit>().toEqualTypeOf<ProviderExtras['pi']['init']>();
  });

  it('RunResult.provider and events are narrowed by type parameter', () => {
    expectTypeOf<RunResult<'claude'>['provider']>().toEqualTypeOf<'claude'>();
    expectTypeOf<RunResult<'copilot'>['provider']>().toEqualTypeOf<'copilot'>();
    expectTypeOf<RunResult<'pi'>['events']>().toEqualTypeOf<
      CoderStreamEvent<'pi'>[]
    >();
  });

  it('HeadlessCoder.startThread returns a thread with the same provider literal', () => {
    expectTypeOf<
      Awaited<ReturnType<HeadlessCoder<'claude'>['startThread']>>['provider']
    >().toEqualTypeOf<'claude'>();
    expectTypeOf<
      Awaited<ReturnType<HeadlessCoder<'codex'>['startThread']>>['provider']
    >().toEqualTypeOf<'codex'>();
  });

  it('SharedStartOpts carries per-provider optional extras', () => {
    const _empty: SharedStartOpts = {};
    const _claudeOnly: SharedStartOpts = { permissionMode: 'manual' };
    const _copilotOnly: SharedStartOpts = { copilotMode: 'plan' };
    const _piOnly: SharedStartOpts = { piNoSkills: true };
    const _codexOnly: SharedStartOpts = { codexSandbox: 'workspace-write' };

    expectTypeOf<SharedStartOpts['permissionMode']>().toBeNullable();
    expectTypeOf<SharedStartOpts['copilotMode']>().toBeNullable();
    expectTypeOf<SharedStartOpts['piNoSkills']>().toBeNullable();
    expectTypeOf<SharedStartOpts['codexSandbox']>().toBeNullable();
  });
});

describe('error hierarchy', () => {
  it('all error classes inherit CoderError', () => {
    const errors = [
      new CliNotFoundError('claude', 'claude'),
      new CliVersionError('copilot', '0.1.0', '1.0.68'),
      new FeatureNotSupportedError('pi', 'tools', 'custom tools unavailable'),
      new CliExitError('codex', 1, null, 'boom'),
    ];
    for (const e of errors) {
      expectTypeOf(e).toMatchTypeOf<CoderError>();
    }
  });

  it('CoderError carries code and optional provider', () => {
    const e = new CoderError('UNKNOWN_PROVIDER', 'msg', 'claude');
    expectTypeOf(e.code).toEqualTypeOf<string>();
    expectTypeOf(e.provider).toEqualTypeOf<Provider | undefined>();
  });
});
