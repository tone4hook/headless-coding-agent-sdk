import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { translateClaudeLine } from '../src/adapters/claude/translate.js';
import type { CoderStreamEvent } from '../src/types.js';

function translateFixture(path: string): CoderStreamEvent<'claude'>[] {
  const text = readFileSync(path, 'utf-8');
  const events: CoderStreamEvent<'claude'>[] = [];
  for (const line of text.split('\n')) {
    events.push(...translateClaudeLine(line));
  }
  return events;
}

describe('translateClaudeLine — hello fixture (authenticated error)', () => {
  const path = 'test/fixtures/claude/hello.jsonl';
  const events = translateFixture(path);

  it('produces the expected event type sequence', () => {
    const types = events.map((e) => e.type);
    // hook_started → progress, hook_response → progress, init → init,
    // assistant with text+error → message + error,
    // result is_error:true → usage + error + done
    expect(types).toEqual([
      'progress',
      'progress',
      'init',
      'message',
      'error',
      'usage',
      'error',
      'done',
    ]);
  });

  it('populates init threadId from session_id', () => {
    const init = events.find((e) => e.type === 'init') as Extract<
      CoderStreamEvent<'claude'>,
      { type: 'init' }
    >;
    expect(init.threadId).toBe('9876a169-f79b-4b22-baa1-f7b807f2ed3b');
    expect(init.model).toBe('claude-opus-4-7[1m]');
    expect(init.extra?.claudeCodeVersion).toBe('2.1.118');
    expect(init.extra?.permissionMode).toBe('auto');
  });

  it('emits an error event with apiErrorStatus from the result line', () => {
    const errEvents = events.filter((e) => e.type === 'error');
    expect(errEvents.length).toBeGreaterThanOrEqual(1);
    const last = errEvents.at(-1) as Extract<
      CoderStreamEvent<'claude'>,
      { type: 'error' }
    >;
    expect(last.message).toMatch(/Invalid API key/);
    expect(last.extra?.apiErrorStatus).toBe(401);
  });

  it('every event carries originalItem', () => {
    for (const ev of events) expect(ev.originalItem).toBeDefined();
  });
});

describe('translateClaudeLine — tool-use fixture (synthesized)', () => {
  const path = 'test/fixtures/claude/tool-use.jsonl';
  const events = translateFixture(path);

  it('produces init → message → tool_use → tool_result → message → usage → done', () => {
    expect(events.map((e) => e.type)).toEqual([
      'init',
      'message',
      'tool_use',
      'tool_result',
      'message',
      'usage',
      'done',
    ]);
  });

  it('translates tool_use with name, callId, args', () => {
    const t = events.find((e) => e.type === 'tool_use') as Extract<
      CoderStreamEvent<'claude'>,
      { type: 'tool_use' }
    >;
    expect(t.name).toBe('Bash');
    expect(t.callId).toBe('toolu_01ABC');
    expect(t.args).toEqual({ command: 'ls -la' });
    expect(t.extra?.parentToolUseId).toBeNull();
  });

  it('translates tool_result with callId and result', () => {
    const tr = events.find((e) => e.type === 'tool_result') as Extract<
      CoderStreamEvent<'claude'>,
      { type: 'tool_result' }
    >;
    expect(tr.callId).toBe('toolu_01ABC');
    expect(tr.result).toMatch(/total 8/);
    expect(tr.error).toBeUndefined();
  });

  it('usage event carries token counts and cost', () => {
    const u = events.find((e) => e.type === 'usage') as Extract<
      CoderStreamEvent<'claude'>,
      { type: 'usage' }
    >;
    expect(u.stats?.inputTokens).toBe(30);
    expect(u.stats?.outputTokens).toBe(13);
    expect(u.stats?.costUsd).toBe(0.001);
    expect(u.stats?.durationMs).toBe(1234);
    expect(u.stats?.numTurns).toBe(2);
  });

  it('done event carries terminalReason and permissionDenials', () => {
    const d = events.find((e) => e.type === 'done') as Extract<
      CoderStreamEvent<'claude'>,
      { type: 'done' }
    >;
    expect(d.extra?.terminalReason).toBe('completed');
    expect(d.extra?.permissionDenials).toEqual([]);
    expect(d.extra?.numTurns).toBe(2);
  });
});

describe('translateClaudeLine — malformed input', () => {
  it('drops empty lines', () => {
    expect(translateClaudeLine('')).toEqual([]);
    expect(translateClaudeLine('   ')).toEqual([]);
  });

  it('drops non-JSON lines', () => {
    expect(translateClaudeLine('not json at all')).toEqual([]);
  });

  it('drops unknown top-level types', () => {
    expect(translateClaudeLine(JSON.stringify({ type: 'weird' }))).toEqual([]);
  });

  it('surfaces unknown system subtypes as progress with originalItem', () => {
    const ev = translateClaudeLine(
      JSON.stringify({ type: 'system', subtype: 'some_future_event', foo: 1 }),
    );
    expect(ev).toHaveLength(1);
    expect(ev[0]!.type).toBe('progress');
    expect(ev[0]!.originalItem).toMatchObject({ subtype: 'some_future_event' });
  });
});

describe('translateClaudeLine — partial-messages fixture', () => {
  const events = translateFixture('test/fixtures/claude/partial-messages.jsonl');

  it('emits init, three delta:true messages, final aggregate, usage, done', () => {
    const types = events.map((e) => e.type);
    expect(types).toEqual([
      'init',
      'message',
      'message',
      'message',
      'message',
      'usage',
      'done',
    ]);
  });

  it('first three messages are delta:true text chunks in order', () => {
    const messages = events.filter((e) => e.type === 'message');
    expect(messages).toHaveLength(4);
    const deltas = messages.slice(0, 3) as Array<
      Extract<CoderStreamEvent<'claude'>, { type: 'message' }>
    >;
    expect(deltas.map((m) => m.text)).toEqual(['He', 'llo', ' world']);
    expect(deltas.every((m) => m.delta === true)).toBe(true);
    expect(deltas.every((m) => m.role === 'assistant')).toBe(true);
  });

  it('fourth message is the final delta:false aggregate', () => {
    const messages = events.filter((e) => e.type === 'message') as Array<
      Extract<CoderStreamEvent<'claude'>, { type: 'message' }>
    >;
    const finalMsg = messages[3]!;
    expect(finalMsg.text).toBe('Hello world');
    expect(finalMsg.delta).toBe(false);
  });

  it('drops non-text-delta stream_event subtypes', () => {
    // message_start / content_block_start/stop / message_delta / message_stop
    // are all stream_events but yield zero events.
    expect(
      translateClaudeLine(
        JSON.stringify({ type: 'stream_event', event: { type: 'message_start' } }),
      ),
    ).toEqual([]);
    expect(
      translateClaudeLine(
        JSON.stringify({
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'x' } },
        }),
      ),
    ).toEqual([]);
  });

  it('drops empty-string text_delta', () => {
    expect(
      translateClaudeLine(
        JSON.stringify({
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '' } },
        }),
      ),
    ).toEqual([]);
  });
});
