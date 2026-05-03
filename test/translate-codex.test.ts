import { describe, expect, it } from 'vitest';
import { translateCodexLine } from '../src/adapters/codex/translate.js';

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
});
