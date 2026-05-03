import { describe, expect, it } from 'vitest';
import { estimateCostUsd } from '../src/pricing.js';

describe('estimateCostUsd', () => {
  it('returns undefined for unknown model', () => {
    expect(
      estimateCostUsd('mystery-model-x', { inputTokens: 100, outputTokens: 50 }),
    ).toBeUndefined();
  });

  it('returns undefined when model is undefined', () => {
    expect(
      estimateCostUsd(undefined, { inputTokens: 100, outputTokens: 50 }),
    ).toBeUndefined();
  });

  it('computes cost for a known Claude model', () => {
    const cost = estimateCostUsd('claude-sonnet-4', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    // 1M*$3 + 1M*$15 = $18
    expect(cost).toBeCloseTo(18, 4);
  });

  it('matches by prefix (date-suffixed model id)', () => {
    const cost = estimateCostUsd('claude-sonnet-4-20250514', {
      inputTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(3, 4);
  });

  it('honors cache pricing when present', () => {
    const cost = estimateCostUsd('claude-sonnet-4', {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(0.3, 4);
  });

  it('falls back to output rate for reasoning when no reasoning rate', () => {
    const cost = estimateCostUsd('gpt-5', {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 1_000_000,
    });
    // gpt-5 outputPerMTok = 10
    expect(cost).toBeCloseTo(10, 4);
  });
});
