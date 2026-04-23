/**
 * Live example: stream a Claude run end-to-end.
 *
 * Runs only when the `claude` CLI is installed and `HCA_SKIP_LIVE` is not
 * set. Run with `npx vitest run --dir examples`.
 */

import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { createCoder } from '../src/index.js';

function hasClaude(): boolean {
  if (process.env.HCA_SKIP_LIVE) return false;
  try {
    execSync('claude --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!hasClaude())('live: claude stream', () => {
  it('streams a full event sequence for a simple prompt', async () => {
    const coder = createCoder('claude');
    const thread = await coder.startThread();
    const types: string[] = [];
    for await (const ev of thread.runStreamed('Say hi in three words.', {
      maxTurns: 1,
    })) {
      types.push(ev.type);
    }
    await thread.close();
    expect(types[0]).toMatch(/init|progress/);
    expect(types.at(-1)).toBe('done');
  }, 60_000);
});
