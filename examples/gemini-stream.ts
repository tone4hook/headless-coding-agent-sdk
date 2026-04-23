/**
 * Live example: stream a Gemini run end-to-end.
 */

import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { createCoder } from '../src/index.js';

function hasGemini(): boolean {
  if (process.env.HCA_SKIP_LIVE) return false;
  try {
    execSync('gemini --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!hasGemini())('live: gemini stream', () => {
  it('streams a full event sequence for a simple prompt', async () => {
    const coder = createCoder('gemini');
    const thread = await coder.startThread({ yolo: true });
    const types: string[] = [];
    for await (const ev of thread.runStreamed('Say hi in three words.')) {
      types.push(ev.type);
    }
    await thread.close();
    expect(types[0]).toBe('init');
    expect(types.at(-1)).toBe('done');
    expect(thread.id).toBeDefined();
  }, 120_000);
});
