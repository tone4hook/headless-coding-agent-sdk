import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { translateCodexLine } from '../src/adapters/codex/translate.js';
import type { CoderStreamEvent } from '../src/types.js';

function translateFixture(path: string): CoderStreamEvent<'codex'>[] {
  return readFileSync(path, 'utf-8')
    .trim()
    .split('\n')
    .flatMap((line) => translateCodexLine(line));
}

describe('translateCodexLine', () => {
  it('normalizes init events', () => {
    const [event] = translateCodexLine(JSON.stringify({
      type: 'session_configured',
      session_id: 'sess-1',
      model: 'gpt-5.3-codex',
    }));
    expect(event).toMatchObject({
      provider: 'codex',
      type: 'init',
      threadId: 'sess-1',
      model: 'gpt-5.3-codex',
    });
    expect(event.originalItem).toBeTruthy();
  });

  it('normalizes completed assistant messages', () => {
    const [event] = translateCodexLine(JSON.stringify({
      type: 'message',
      item: { type: 'message', role: 'assistant', content: [{ text: 'done' }] },
    }));
    expect(event).toMatchObject({ type: 'message', role: 'assistant', text: 'done' });
  });

  it('normalizes tool use and result events', () => {
    const [tool] = translateCodexLine(JSON.stringify({
      type: 'tool_call',
      item: { id: 'call-1', name: 'shell', arguments: { cmd: 'npm test' } },
    }));
    const [result] = translateCodexLine(JSON.stringify({
      type: 'tool_result',
      item: { id: 'call-1', output: 'ok', status: 'success' },
    }));
    expect(tool).toMatchObject({ type: 'tool_use', name: 'shell', callId: 'call-1' });
    expect(result).toMatchObject({ type: 'tool_result', callId: 'call-1', result: 'ok' });
  });

  it('normalizes usage, error, and done events', () => {
    expect(translateCodexLine(JSON.stringify({
      type: 'usage',
      input_tokens: 3,
      output_tokens: 4,
    }))[0]).toMatchObject({ type: 'usage', stats: { inputTokens: 3, outputTokens: 4 } });
    expect(translateCodexLine(JSON.stringify({
      type: 'error',
      message: 'nope',
    }))[0]).toMatchObject({ type: 'error', message: 'nope' });
    expect(translateCodexLine(JSON.stringify({
      type: 'done',
      reason: 'success',
    }))[0]).toMatchObject({ type: 'done' });
  });

  it('normalizes current dotted Codex JSONL events from fixture', () => {
    const events = translateFixture('test/fixtures/codex/current.jsonl');
    expect(events.map((event) => event.type)).toEqual([
      'init',
      'progress',
      'tool_use',
      'tool_result',
      'message',
      'usage',
      'done',
    ]);
    expect(events[0]).toMatchObject({
      type: 'init',
      threadId: 'codex-thread-1',
      model: 'gpt-5-codex',
    });
    expect(events[2]).toMatchObject({
      type: 'tool_use',
      name: 'command_execution',
      callId: 'cmd-1',
      args: { command: 'npm test' },
    });
    expect(events[4]).toMatchObject({
      type: 'message',
      role: 'assistant',
      text: 'Done.',
    });
    expect(events[5]).toMatchObject({
      type: 'usage',
      stats: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });
  });
});
