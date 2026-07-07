import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { translatePiLine } from '../src/adapters/pi/translate.js';
import type { CoderStreamEvent } from '../src/types.js';

function translateFixture(path: string): CoderStreamEvent<'pi'>[] {
  return readFileSync(path, 'utf-8')
    .trim()
    .split('\n')
    .flatMap((line) => translatePiLine(line));
}

describe('translatePiLine', () => {
  it('normalizes hello JSONL fixture', () => {
    const events = translateFixture('test/fixtures/pi/hello.jsonl');
    expect(events.map((event) => event.type)).toEqual([
      'init',
      'message',
      'message',
      'usage',
      'done',
    ]);
    expect(events[0]).toMatchObject({
      type: 'init',
      threadId: 'pi-session-1',
      model: 'sonnet',
      extra: { version: 3 },
    });
    expect(events[1]).toMatchObject({
      type: 'message',
      text: 'Hel',
      delta: true,
    });
    expect(events[2]).toMatchObject({
      type: 'message',
      text: 'Hello from Pi.',
      delta: false,
    });
    expect(events[3]).toMatchObject({
      type: 'usage',
      stats: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
    });
  });

  it('normalizes tool-use JSONL fixture', () => {
    const events = translateFixture('test/fixtures/pi/tool-use.jsonl');
    expect(events.map((event) => event.type)).toEqual([
      'tool_use',
      'progress',
      'tool_result',
    ]);
    expect(events[0]).toMatchObject({
      type: 'tool_use',
      name: 'read',
      callId: 'tool-1',
      args: { path: 'package.json' },
    });
    expect(events[2]).toMatchObject({
      type: 'tool_result',
      name: 'read',
      callId: 'tool-1',
      result: '{}',
    });
  });

  it('returns stderr for malformed non-empty lines', () => {
    expect(translatePiLine('not json')[0]).toMatchObject({
      type: 'stderr',
      line: 'not json',
    });
    expect(translatePiLine('')).toEqual([]);
  });
});
