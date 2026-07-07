import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  createClaudeCoder,
  createCoder,
  createCodexCoder,
  createCopilotCoder,
  createPiCoder,
} from '../src/index.js';
import type {
  CoderStreamEvent,
  HeadlessCoder,
  ThreadHandle,
} from '../src/index.js';

describe('createCoder', () => {
  it('returns an adapter-typed HeadlessCoder for each provider literal', () => {
    const claude = createCoder('claude');
    const codex = createCoder('codex');
    const copilot = createCoder('copilot');
    const pi = createCoder('pi');
    expect(claude.provider).toBe('claude');
    expect(codex.provider).toBe('codex');
    expect(copilot.provider).toBe('copilot');
    expect(pi.provider).toBe('pi');
    expectTypeOf(claude).toEqualTypeOf<HeadlessCoder<'claude'>>();
    expectTypeOf(codex).toEqualTypeOf<HeadlessCoder<'codex'>>();
    expectTypeOf(copilot).toEqualTypeOf<HeadlessCoder<'copilot'>>();
    expectTypeOf(pi).toEqualTypeOf<HeadlessCoder<'pi'>>();
  });

  it('narrows provider literal on thread handles', () => {
    type ClaudeThread = Awaited<
      ReturnType<HeadlessCoder<'claude'>['startThread']>
    >;
    type CopilotThread = Awaited<
      ReturnType<HeadlessCoder<'copilot'>['startThread']>
    >;
    expectTypeOf<ClaudeThread['provider']>().toEqualTypeOf<'claude'>();
    expectTypeOf<CopilotThread['provider']>().toEqualTypeOf<'copilot'>();
    expectTypeOf<ClaudeThread>().toMatchTypeOf<ThreadHandle<'claude'>>();
    expectTypeOf<CopilotThread>().toMatchTypeOf<ThreadHandle<'copilot'>>();
  });

  it('narrows event extras per provider literal', () => {
    type ClaudeInit = Extract<
      CoderStreamEvent<'claude'>,
      { type: 'init' }
    >;
    expectTypeOf<ClaudeInit['extra']>().toMatchTypeOf<
      { claudeCodeVersion?: string } | undefined
    >();

    type PiInit = Extract<CoderStreamEvent<'pi'>, { type: 'init' }>;
    expectTypeOf<PiInit['extra']>().toMatchTypeOf<
      { version?: number; timestamp?: string } | undefined
    >();
  });

  it('throws on an unknown provider at call time', () => {
    expect(() => createCoder('zzz' as never)).toThrowError(/Unknown provider/);
  });

  it('direct factory exports match the generic entry', () => {
    expect(createClaudeCoder().provider).toBe(createCoder('claude').provider);
    expect(createCodexCoder().provider).toBe(createCoder('codex').provider);
    expect(createCopilotCoder().provider).toBe(createCoder('copilot').provider);
    expect(createPiCoder().provider).toBe(createCoder('pi').provider);
  });
});
