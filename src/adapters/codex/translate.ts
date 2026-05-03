/**
 * Codex JSONL translator.
 *
 * The CLI has used a few adjacent names for streamed turn/item events. Keep
 * this normalizer tolerant and preserve the raw item for callers that want the
 * provider-native shape.
 */

import type { CoderStreamEvent, UsageStats } from '../../types.js';
import { estimateCostUsd } from '../../pricing.js';
import { classifyCodexError } from './classify.js';

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

function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function usageFrom(value: unknown): UsageStats | undefined {
  const obj = asObject(value);
  if (!obj) return undefined;
  const inputTokens = num(
    obj.input_tokens ?? obj.inputTokens ?? obj.prompt_tokens,
  );
  const outputTokens = num(
    obj.output_tokens ?? obj.outputTokens ?? obj.completion_tokens,
  );
  let totalTokens = num(obj.total_tokens ?? obj.totalTokens);
  if (totalTokens === undefined && inputTokens !== undefined && outputTokens !== undefined) {
    totalTokens = inputTokens + outputTokens;
  }

  // Cached input tokens (cache hits).
  const tokenDetails = asObject(obj.input_tokens_details ?? obj.inputTokensDetails);
  const cacheReadTokens =
    num(obj.cache_read_input_tokens) ??
    num(obj.cached_input_tokens) ??
    num(tokenDetails?.cached_tokens);

  // Reasoning tokens (o-series style breakdown).
  const outputDetails = asObject(
    obj.output_tokens_details ?? obj.outputTokensDetails,
  );
  const reasoningTokens =
    num(obj.reasoning_tokens) ??
    num(obj.reasoningTokens) ??
    num(outputDetails?.reasoning_tokens);

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cacheReadTokens,
    reasoningTokens,
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
    const stats = usageFrom(payload.usage ?? payload);
    if (stats && stats.costUsd === undefined) {
      stats.costUsd = estimateCostUsd(asString(item.model) ?? asString(payload.model), stats);
    }
    return [
      {
        provider: 'codex',
        type: 'usage',
        stats,
        ts,
        originalItem: item,
        extra: { raw: payload.usage ?? payload },
      },
    ];
  }

  if (type === 'error') {
    const message =
      asString(item.message) ??
      asString(payload.message) ??
      asString(payload.error) ??
      'Codex CLI error';
    const rawCode =
      asString(item.code) ??
      asString(payload.code) ??
      asString(payload.type);
    const c = classifyCodexError({ message, rawCode });
    return [
      {
        provider: 'codex',
        type: 'error',
        code: c.code,
        retryable: c.retryable,
        message,
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
      if (usage.costUsd === undefined) {
        usage.costUsd = estimateCostUsd(
          asString(item.model) ?? asString(payload.model),
          usage,
        );
      }
      events.push({
        provider: 'codex',
        type: 'usage',
        stats: usage,
        ts,
        originalItem: item,
        extra: { raw: item.usage ?? payload.usage },
      });
    }
    if (type === 'turn_aborted') {
      events.push({
        provider: 'codex',
        type: 'cancelled',
        code: 'interrupted',
        ts,
        originalItem: item,
      });
    } else {
      events.push({
        provider: 'codex',
        type: 'done',
        ts,
        originalItem: item,
        extra: {
          terminalReason:
            asString(item.reason) ?? asString(payload.reason) ?? 'success',
        },
      });
    }
    return events;
  }

  if (type === 'turn_started' || type === 'item_started' || type === 'item_completed') {
    return [];
  }

  return [];
}
