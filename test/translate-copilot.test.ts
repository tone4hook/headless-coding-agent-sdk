import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { translateCopilotLine } from '../src/adapters/copilot/translate.js';
import type { CoderStreamEvent } from '../src/types.js';

function translateFixture(path: string): CoderStreamEvent<'copilot'>[] {
  return readFileSync(path, 'utf-8')
    .trim()
    .split('\n')
    .flatMap((line) => translateCopilotLine(line));
}

describe('translateCopilotLine', () => {
  it('normalizes hello JSONL fixture', () => {
    const events = translateFixture('test/fixtures/copilot/hello.jsonl');
    expect(events.map((event) => event.type)).toEqual([
      'init',
      'message',
      'usage',
      'done',
    ]);
    expect(events[0]).toMatchObject({
      type: 'init',
      threadId: 'copilot-session-1',
      model: 'gpt-5.4',
    });
    expect(events[1]).toMatchObject({
      type: 'message',
      role: 'assistant',
      text: 'Hello from Copilot.',
    });
    expect(events[2]).toMatchObject({
      type: 'usage',
      stats: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
    });
  });

  it('normalizes tool-use JSONL fixture', () => {
    const events = translateFixture('test/fixtures/copilot/tool-use.jsonl');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: 'tool_use',
      name: 'shell',
      callId: 'call-1',
      args: { command: 'git status' },
    });
    expect(events[1]).toMatchObject({
      type: 'tool_result',
      name: 'shell',
      callId: 'call-1',
      result: 'clean',
    });
  });

  it('returns stderr for malformed non-empty lines', () => {
    expect(translateCopilotLine('not json')[0]).toMatchObject({
      type: 'stderr',
      line: 'not json',
    });
    expect(translateCopilotLine('')).toEqual([]);
  });
});
