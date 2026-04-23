import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  createCoder,
  createClaudeCoder,
  createGeminiCoder,
} from '../src/index.js';
import type {
  HeadlessCoder,
  ThreadHandle,
  CoderStreamEvent,
} from '../src/index.js';

describe('createCoder', () => {
  it('returns an adapter-typed HeadlessCoder for each provider literal', () => {
    const claude = createCoder('claude');
    const gemini = createCoder('gemini');
    expect(claude.provider).toBe('claude');
    expect(gemini.provider).toBe('gemini');
    expectTypeOf(claude).toEqualTypeOf<HeadlessCoder<'claude'>>();
    expectTypeOf(gemini).toEqualTypeOf<HeadlessCoder<'gemini'>>();
  });

  it('narrows provider literal so ThreadHandle.fork is claude-only-callable at compile time', () => {
    type ClaudeThread = Awaited<
      ReturnType<HeadlessCoder<'claude'>['startThread']>
    >;
    type GeminiThread = Awaited<
      ReturnType<HeadlessCoder<'gemini'>['startThread']>
    >;
    // Both expose fork? (interface marks it optional); both have provider narrowed.
    expectTypeOf<ClaudeThread['provider']>().toEqualTypeOf<'claude'>();
    expectTypeOf<GeminiThread['provider']>().toEqualTypeOf<'gemini'>();
    expectTypeOf<ClaudeThread>().toMatchTypeOf<ThreadHandle<'claude'>>();
    expectTypeOf<GeminiThread>().toMatchTypeOf<ThreadHandle<'gemini'>>();
  });

  it('narrows event extras per provider literal', () => {
    // Accessing a claude-specific extras field on the claude variant is fine.
    type ClaudeInit = Extract<
      CoderStreamEvent<'claude'>,
      { type: 'init' }
    >;
    expectTypeOf<ClaudeInit['extra']>().toMatchTypeOf<
      { claudeCodeVersion?: string } | undefined
    >();
    // Gemini init has timestamp, not claudeCodeVersion.
    type GeminiInit = Extract<
      CoderStreamEvent<'gemini'>,
      { type: 'init' }
    >;
    expectTypeOf<GeminiInit['extra']>().toMatchTypeOf<
      { timestamp?: string } | undefined
    >();
  });

  it('throws on an unknown provider at call time', () => {
    expect(() => createCoder('zzz' as never)).toThrowError(/Unknown provider/);
  });

  it('direct factory exports match the generic entry', () => {
    const a = createClaudeCoder();
    const b = createCoder('claude');
    expect(a.provider).toBe(b.provider);
    const c = createGeminiCoder();
    const d = createCoder('gemini');
    expect(c.provider).toBe(d.provider);
  });
});
