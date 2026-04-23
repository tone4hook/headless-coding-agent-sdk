/**
 * Live example: register a custom tool and verify the CLI calls it.
 *
 * Note: Claude CLI requires the tool's mcp-qualified name in `allowedTools`
 * or permissionMode=bypassPermissions. Gemini with `-y` bypasses approval.
 */

import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { createCoder, tool } from '../src/index.js';

function hasBin(bin: string): boolean {
  if (process.env.HCA_SKIP_LIVE) return false;
  try {
    execSync(`${bin} --version`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const addTool = tool({
  name: 'add',
  description: 'add two numbers',
  inputSchema: { a: 'number', b: 'number' },
  handler: async ({ a, b }: { a: number; b: number }) => ({
    content: [{ type: 'text', text: String(a + b) }],
  }),
});

describe.skipIf(!hasBin('claude'))('live: claude custom tools', () => {
  it('invokes the registered `add` tool', async () => {
    const coder = createCoder('claude', {
      tools: [addTool],
      permissionMode: 'bypassPermissions',
    });
    const thread = await coder.startThread();
    let toolInvoked = false;
    for await (const ev of thread.runStreamed('Use the add tool to compute 17 + 25.')) {
      if (ev.type === 'tool_use' && ev.name.endsWith('add')) toolInvoked = true;
    }
    await thread.close();
    expect(toolInvoked).toBe(true);
  }, 120_000);
});

describe.skipIf(!hasBin('gemini'))('live: gemini custom tools', () => {
  it('invokes the registered `add` tool', async () => {
    const coder = createCoder('gemini', { tools: [addTool], yolo: true });
    const thread = await coder.startThread();
    let toolInvoked = false;
    for await (const ev of thread.runStreamed('Use the add tool to compute 17 + 25.')) {
      if (ev.type === 'tool_use' && ev.name.includes('add')) toolInvoked = true;
    }
    await thread.close();
    expect(toolInvoked).toBe(true);
  }, 180_000);
});
