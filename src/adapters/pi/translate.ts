/**
 * Pi coding-agent JSON mode translator.
 */

import type { CoderStreamEvent, UsageStats } from '../../types.js';
import { estimateCostUsd } from '../../pricing.js';
import { classifyPiError } from './classify.js';

type PiEvent = Record<string, unknown>;

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function num(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function textFrom(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return undefined;
  const text = value
    .map((part) => {
      if (typeof part === 'string') return part;
      const obj = asObject(part);
      return asString(obj?.text) ?? asString(obj?.content);
    })
    .filter((part): part is string => Boolean(part))
    .join('');
  return text || undefined;
}

function usageFrom(value: unknown): UsageStats | undefined {
  const obj = asObject(value);
  if (!obj) return undefined;
  const inputTokens = num(obj.input_tokens ?? obj.inputTokens ?? obj.prompt_tokens);
  const outputTokens = num(
    obj.output_tokens ?? obj.outputTokens ?? obj.completion_tokens,
  );
  let totalTokens = num(obj.total_tokens ?? obj.totalTokens);
  if (totalTokens === undefined && inputTokens !== undefined && outputTokens !== undefined) {
    totalTokens = inputTokens + outputTokens;
  }
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    raw: value,
  };
}

function messageText(raw: PiEvent, payload: Record<string, unknown>): string | undefined {
  return (
    asString(raw.text) ??
    asString(payload.text) ??
    asString(raw.delta) ??
    asString(payload.delta) ??
    textFrom(payload.content) ??
    textFrom(raw.content)
  );
}

export function translatePiLine(line: string): CoderStreamEvent<'pi'>[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  let raw: PiEvent;
  try {
    raw = JSON.parse(trimmed) as PiEvent;
  } catch {
    return [
      {
        provider: 'pi',
        type: 'stderr',
        line,
        ts: Date.now(),
      },
    ];
  }

  const ts = Date.now();
  const type = asString(raw.type) ?? '';
  const payload = asObject(raw.message) ?? asObject(raw.tool) ?? asObject(raw.payload) ?? raw;
  const timestamp = asString(raw.timestamp) ?? asString(payload.timestamp);
  const messageId =
    asString(raw.message_id) ??
    asString(raw.messageId) ??
    asString(payload.message_id) ??
    asString(payload.messageId) ??
    asString(raw.id) ??
    asString(payload.id);

  if (type === 'session') {
    return [
      {
        provider: 'pi',
        type: 'init',
        threadId: asString(raw.id) ?? asString(raw.session_id),
        model: asString(raw.model),
        ts,
        originalItem: raw,
        extra: {
          version: num(raw.version),
          cwd: asString(raw.cwd),
          timestamp,
        },
      },
    ];
  }

  if (type === 'agent_start' || type === 'turn_start') {
    return [
      {
        provider: 'pi',
        type: 'progress',
        label: type,
        ts,
        originalItem: raw,
        extra: { timestamp, rawType: type },
      },
    ];
  }

  if (type === 'message_update' || type === 'message_end') {
    const text = messageText(raw, payload);
    return text
      ? [
          {
            provider: 'pi',
            type: 'message',
            role: 'assistant',
            text,
            delta: type === 'message_update',
            ts,
            originalItem: raw,
            extra: { timestamp, messageId },
          },
        ]
      : [];
  }

  if (type === 'tool_execution_start') {
    return [
      {
        provider: 'pi',
        type: 'tool_use',
        name:
          asString(raw.name) ??
          asString(payload.name) ??
          asString(raw.tool_name) ??
          asString(payload.tool_name) ??
          'tool',
        callId: messageId,
        args: raw.input ?? payload.input ?? raw.arguments ?? payload.arguments,
        ts,
        originalItem: raw,
        extra: { timestamp, messageId },
      },
    ];
  }

  if (type === 'tool_execution_update') {
    return [
      {
        provider: 'pi',
        type: 'progress',
        label:
          asString(raw.name) ??
          asString(payload.name) ??
          'tool_execution_update',
        detail: messageText(raw, payload),
        ts,
        originalItem: raw,
        extra: { timestamp, rawType: type },
      },
    ];
  }

  if (type === 'tool_execution_end') {
    return [
      {
        provider: 'pi',
        type: 'tool_result',
        name:
          asString(raw.name) ??
          asString(payload.name) ??
          asString(raw.tool_name) ??
          asString(payload.tool_name),
        callId: messageId,
        result: raw.output ?? payload.output ?? raw.result ?? payload.result ?? payload,
        error: raw.error ?? payload.error,
        ts,
        originalItem: raw,
        extra: {
          timestamp,
          messageId,
          status: asString(raw.status) ?? asString(payload.status),
        },
      },
    ];
  }

  if (type === 'turn_end') {
    const usage = usageFrom(raw.usage ?? payload.usage);
    if (!usage) {
      return [
        {
          provider: 'pi',
          type: 'progress',
          label: 'turn_end',
          ts,
          originalItem: raw,
          extra: { timestamp, rawType: type },
        },
      ];
    }
    usage.costUsd = usage.costUsd ?? estimateCostUsd(asString(raw.model), usage);
    return [
      {
        provider: 'pi',
        type: 'usage',
        stats: usage,
        ts,
        originalItem: raw,
        extra: { raw: raw.usage ?? payload.usage },
      },
    ];
  }

  if (type === 'agent_end') {
    return [
      {
        provider: 'pi',
        type: 'done',
        ts,
        originalItem: raw,
        extra: {
          terminalReason:
            asString(raw.reason) ?? asString(raw.status) ?? 'success',
        },
      },
    ];
  }

  if (type === 'error') {
    const message =
      asString(raw.message) ??
      asString(payload.message) ??
      asString(raw.error) ??
      asString(payload.error) ??
      'Pi coding-agent error';
    const c = classifyPiError({
      message,
      rawCode:
        asString(raw.code) ??
        asString(payload.code) ??
        asString(raw.error_type) ??
        asString(payload.error_type),
    });
    return [
      {
        provider: 'pi',
        type: 'error',
        code: c.code,
        retryable: c.retryable,
        message,
        ts,
        originalItem: raw,
      },
    ];
  }

  return type
    ? [
        {
          provider: 'pi',
          type: 'progress',
          label: type,
          ts,
          originalItem: raw,
          extra: { timestamp, rawType: type },
        },
      ]
    : [];
}
