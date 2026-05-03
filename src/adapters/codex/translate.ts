/**
 * Codex JSONL translator.
 *
 * The CLI has used a few adjacent names for streamed turn/item events. Keep
 * this normalizer tolerant and preserve the raw item for callers that want the
 * provider-native shape.
 */

import type { CoderStreamEvent, UsageStats } from '../../types.js';

type CodexEvent = Record<string, unknown>;

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function textFromContent(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return undefined;
  const parts = value
    .map((part) => {
      if (typeof part === 'string') return part;
      const obj = asObject(part);
      return asString(obj?.text) ?? asString(obj?.content);
    })
    .filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join('') : undefined;
}

function usageFrom(value: unknown): UsageStats | undefined {
  const obj = asObject(value);
  if (!obj) return undefined;
  const inputTokens = Number(obj.input_tokens ?? obj.inputTokens ?? obj.prompt_tokens);
  const outputTokens = Number(
    obj.output_tokens ?? obj.outputTokens ?? obj.completion_tokens,
  );
  const totalTokens = Number(obj.total_tokens ?? obj.totalTokens);
  return {
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : undefined,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : undefined,
    totalTokens: Number.isFinite(totalTokens) ? totalTokens : undefined,
    raw: value,
  };
}

export function translateCodexLine(line: string): CoderStreamEvent<'codex'>[] {
  let item: CodexEvent;
  try {
    item = JSON.parse(line) as CodexEvent;
  } catch {
    return [
      {
        provider: 'codex',
        type: 'stderr',
        line,
        ts: Date.now(),
      },
    ];
  }

  const ts = Date.now();
  const type = asString(item.type) ?? asString(item.event) ?? '';
  const payload = asObject(item.item) ?? asObject(item.payload) ?? item;
  const sessionId =
    asString(item.session_id) ??
    asString(item.sessionId) ??
    asString(payload.session_id) ??
    asString(payload.sessionId);

  if (type === 'session_configured' || type === 'init' || type === 'started') {
    return [
      {
        provider: 'codex',
        type: 'init',
        threadId: sessionId,
        model: asString(item.model) ?? asString(payload.model),
        ts,
        originalItem: item,
        extra: {
          sessionId,
          cwd: asString(item.cwd) ?? asString(payload.cwd),
        },
      },
    ];
  }

  if (
    type === 'agent_message_delta' ||
    type === 'message_delta' ||
    type === 'output_text_delta'
  ) {
    return [
      {
        provider: 'codex',
        type: 'message',
        role: 'assistant',
        text: asString(item.delta) ?? asString(payload.delta) ?? '',
        delta: true,
        ts,
        originalItem: item,
        extra: { sessionId },
      },
    ];
  }

  const payloadType = asString(payload.type);
  if (
    type === 'agent_message' ||
    type === 'message' ||
    payloadType === 'message'
  ) {
    const role = asString(payload.role) === 'user' ? 'user' : 'assistant';
    const text =
      asString(item.text) ??
      asString(payload.text) ??
      textFromContent(payload.content) ??
      textFromContent(item.content);
    return text
      ? [
          {
            provider: 'codex',
            type: 'message',
            role,
            text,
            ts,
            originalItem: item,
            extra: { sessionId },
          },
        ]
      : [];
  }

  if (
    type === 'tool_call' ||
    type === 'tool_use' ||
    type === 'exec_command_begin' ||
    payloadType === 'function_call'
  ) {
    return [
      {
        provider: 'codex',
        type: 'tool_use',
        name:
          asString(payload.name) ??
          asString(payload.command) ??
          asString(item.name) ??
          'tool',
        callId: asString(payload.call_id) ?? asString(payload.callId) ?? asString(payload.id),
        args: payload.arguments ?? payload.args ?? payload.input ?? payload.command,
        ts,
        originalItem: item,
        extra: { sessionId },
      },
    ];
  }

  if (
    type === 'tool_result' ||
    type === 'exec_command_end' ||
    payloadType === 'function_call_output'
  ) {
    return [
      {
        provider: 'codex',
        type: 'tool_result',
        name: asString(payload.name) ?? asString(item.name),
        callId: asString(payload.call_id) ?? asString(payload.callId) ?? asString(payload.id),
        result: payload.output ?? payload.result ?? payload,
        error: payload.error,
        ts,
        originalItem: item,
        extra: {
          sessionId,
          status: asString(payload.status),
        },
      },
    ];
  }

  if (type === 'usage' || payload.usage) {
    return [
      {
        provider: 'codex',
        type: 'usage',
        stats: usageFrom(payload.usage ?? payload),
        ts,
        originalItem: item,
        extra: { raw: payload.usage ?? payload },
      },
    ];
  }

  if (type === 'error') {
    return [
      {
        provider: 'codex',
        type: 'error',
        code: asString(item.code) ?? asString(payload.code),
        message:
          asString(item.message) ??
          asString(payload.message) ??
          asString(payload.error) ??
          'Codex CLI error',
        ts,
        originalItem: item,
      },
    ];
  }

  if (
    type === 'done' ||
    type === 'turn_completed' ||
    type === 'completed' ||
    type === 'turn_aborted'
  ) {
    const events: CoderStreamEvent<'codex'>[] = [];
    const usage = usageFrom(item.usage ?? payload.usage);
    if (usage) {
      events.push({
        provider: 'codex',
        type: 'usage',
        stats: usage,
        ts,
        originalItem: item,
        extra: { raw: item.usage ?? payload.usage },
      });
    }
    events.push({
      provider: 'codex',
      type: type === 'turn_aborted' ? 'cancelled' : 'done',
      ts,
      originalItem: item,
      extra:
        type === 'turn_aborted'
          ? undefined
          : {
              terminalReason:
                asString(item.reason) ?? asString(payload.reason) ?? 'success',
            },
    } as CoderStreamEvent<'codex'>);
    return events;
  }

  if (type === 'turn_started' || type === 'item_started' || type === 'item_completed') {
    return [];
  }

  return [];
}
