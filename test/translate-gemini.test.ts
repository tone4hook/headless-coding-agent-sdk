import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { translateGeminiLine } from '../src/adapters/gemini/translate.js';
import type { CoderStreamEvent } from '../src/types.js';

function translateFixture(path: string): CoderStreamEvent<'gemini'>[] {
  const events: CoderStreamEvent<'gemini'>[] = [];
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    events.push(...translateGeminiLine(line));
  }
  return events;
}

describe('translateGeminiLine — hello fixture (live capture)', () => {
  const events = translateFixture('test/fixtures/gemini/hello.jsonl');

  it('produces init → message(user) → message(assistant) → usage → done', () => {
    expect(events.map((e) => e.type)).toEqual([
      'init',
      'message',
      'message',
      'usage',
      'done',
    ]);
  });

  it('init captures session UUID and model', () => {
    const init = events.find((e) => e.type === 'init') as Extract<
      CoderStreamEvent<'gemini'>,
      { type: 'init' }
    >;
    expect(init.threadId).toBe('33983486-b330-43dc-8f32-14c990eadeb2');
    expect(init.model).toBe('gemini-3-flash-preview');
    expect(init.extra?.timestamp).toBe('2026-04-23T15:03:39.303Z');
  });

  it('usage carries tokens and duration from stats', () => {
    const u = events.find((e) => e.type === 'usage') as Extract<
      CoderStreamEvent<'gemini'>,
      { type: 'usage' }
    >;
    expect(u.stats?.inputTokens).toBe(14439);
    expect(u.stats?.outputTokens).toBe(5);
    expect(u.stats?.totalTokens).toBe(14564);
    expect(u.stats?.durationMs).toBe(5642);
    expect(u.extra?.toolCalls).toBe(0);
  });

  it('every event carries originalItem', () => {
    for (const ev of events) expect(ev.originalItem).toBeDefined();
  });
});

describe('translateGeminiLine — tool-use fixture', () => {
  const events = translateFixture('test/fixtures/gemini/tool-use.jsonl');

  it('produces init → message(user) → message(assistant) → tool_use → tool_result → message(assistant) → usage → done', () => {
    expect(events.map((e) => e.type)).toEqual([
      'init',
      'message',
      'message',
      'tool_use',
      'tool_result',
      'message',
      'usage',
      'done',
    ]);
  });

  it('tool_use has name from tool_name, callId from tool_id, args from parameters', () => {
    const t = events.find((e) => e.type === 'tool_use') as Extract<
      CoderStreamEvent<'gemini'>,
      { type: 'tool_use' }
    >;
    expect(t.name).toBe('list_directory');
    expect(t.callId).toBe('list_directory_1000_0');
    expect(t.args).toEqual({ path: '.' });
  });

  it('tool_result has callId and output, no error on status=success', () => {
    const tr = events.find((e) => e.type === 'tool_result') as Extract<
      CoderStreamEvent<'gemini'>,
      { type: 'tool_result' }
    >;
    expect(tr.callId).toBe('list_directory_1000_0');
    expect(tr.result).toBe('a.txt\nb.txt');
    expect(tr.error).toBeUndefined();
    expect(tr.extra?.status).toBe('success');
  });

  it('assistant message emits delta:true per source line', () => {
    const assistantMessages = events.filter(
      (e) => e.type === 'message' && e.role === 'assistant',
    ) as Extract<CoderStreamEvent<'gemini'>, { type: 'message' }>[];
    expect(assistantMessages).toHaveLength(2);
    for (const m of assistantMessages) expect(m.delta).toBe(true);
  });

  it('usage reports toolCalls from stats.tool_calls', () => {
    const u = events.find((e) => e.type === 'usage') as Extract<
      CoderStreamEvent<'gemini'>,
      { type: 'usage' }
    >;
    expect(u.extra?.toolCalls).toBe(1);
  });
});

describe('translateGeminiLine — edge cases', () => {
  it('drops empty and non-JSON lines', () => {
    expect(translateGeminiLine('')).toEqual([]);
    expect(translateGeminiLine('garbage')).toEqual([]);
  });

  it('drops unknown types', () => {
    expect(translateGeminiLine(JSON.stringify({ type: 'weird' }))).toEqual([]);
  });

  it('tool_result with status=error surfaces an error field', () => {
    const ev = translateGeminiLine(
      JSON.stringify({
        type: 'tool_result',
        tool_id: 't1',
        status: 'error',
        output: 'boom',
      }),
    );
    expect(ev).toHaveLength(1);
    const tr = ev[0] as Extract<CoderStreamEvent<'gemini'>, { type: 'tool_result' }>;
    expect(tr.error).toBe('boom');
    expect(tr.extra?.status).toBe('error');
  });

  it('result with status=error emits usage + error + done', () => {
    const ev = translateGeminiLine(
      JSON.stringify({
        type: 'result',
        status: 'error',
        stats: { total_tokens: 0, input_tokens: 0, output_tokens: 0 },
      }),
    );
    expect(ev.map((e) => e.type)).toEqual(['usage', 'error', 'done']);
  });
});
