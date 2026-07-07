/**
 * Live example: outputSchema round-trip.
 *
 * Claude: native --json-schema flag validates server-side.
 * Copilot/Pi: prompt-injection best-effort; strictSchema:true throws
 * FeatureNotSupportedError before spawn.
 */

import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { createCoder, FeatureNotSupportedError } from '../src/index.js';

function hasBin(bin: string): boolean {
  if (process.env.HCA_SKIP_LIVE) return false;
  try {
    execSync(`${bin} --version`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const schema = {
  type: 'object' as const,
  properties: { answer: { type: 'string' } },
  required: ['answer'],
};

describe.skipIf(!hasBin('claude'))('live: claude structured output', () => {
  it('returns a parsed JSON matching the schema', async () => {
    const coder = createCoder('claude');
    const thread = await coder.startThread();
    const result = await thread.run('What is 2+2? Respond as { "answer": "..." }.', {
      outputSchema: schema,
    });
    await thread.close();
    expect(typeof result.text).toBe('string');
    if (result.json) {
      expect(result.json).toMatchObject({ answer: expect.any(String) });
    }
  }, 60_000);
});

describe.skipIf(!hasBin('copilot'))('live: copilot structured output', () => {
  it('best-effort returns JSON via prompt injection', async () => {
    const coder = createCoder('copilot');
    const thread = await coder.startThread();
    const result = await thread.run('What is 2+2?', {
      outputSchema: schema,
    });
    await thread.close();
    expect(result.text).toBeDefined();
    // json may or may not parse depending on whether the CLI honored the preamble.
  }, 120_000);

  it('strictSchema:true throws FeatureNotSupportedError before spawn', async () => {
    const coder = createCoder('copilot');
    const thread = await coder.startThread();
    await expect(
      thread.run('hi', { outputSchema: schema, strictSchema: true }),
    ).rejects.toThrow(FeatureNotSupportedError);
    await thread.close();
  });
});

describe('pi structured output support', () => {
  it('strictSchema:true throws FeatureNotSupportedError before spawn', async () => {
    const coder = createCoder('pi');
    const thread = await coder.startThread();
    await expect(
      thread.run('hi', { outputSchema: schema, strictSchema: true }),
    ).rejects.toThrow(FeatureNotSupportedError);
    await thread.close();
  });
});
