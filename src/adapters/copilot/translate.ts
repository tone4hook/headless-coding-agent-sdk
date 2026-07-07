/**
 * GitHub Copilot CLI JSONL translator.
 *
 * The documented programmatic mode emits JSONL when invoked with
 * `--output-format json`. Keep this tolerant because minor keys differ
 * between prompt, tool, and terminal-result records.
 */

import type { CoderStreamEvent, UsageStats } from '../../types.js';
import { estimateCostUsd } from '../../pricing.js';
import { classifyCopilotError } from './classify.js';

type CopilotEvent = Record<string, unknown>;

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

function textFromContent(value: unknown): string | undefined {
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
  const reasoningTokens = num(obj.reasoning_tokens ?? obj.reasoningTokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    reasoningTokens,
    raw: value,
  };
}

export function translateCopilotLine(line: string): CoderStreamEvent<'copilot'>[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  let raw: CopilotEvent;
  try {
    raw = JSON.parse(trimmed) as CopilotEvent;
  } catch {
    return [
      {
        provider: 'copilot',
        type: 'stderr',
        line,
        ts: Date.now(),
      },
    ];
  }

  const ts = Date.now();
  const type = asString(raw.type) ?? asString(raw.event) ?? '';
  const payload = asObject(raw.item) ?? asObject(raw.message) ?? asObject(raw.payload) ?? raw;
  const sessionId =
    asString(raw.session_id) ??
    asString(raw.sessionId) ??
    asString(payload.session_id) ??
    asString(payload.sessionId);

  if (type === 'session' || type === 'init' || type === 'thread.started') {
    return [
      {
        provider: 'copilot',
        type: 'init',
        threadId: sessionId,
        model: asString(raw.model) ?? asString(payload.model),
        ts,
        originalItem: raw,
        extra: {
          sessionId,
          cwd: asString(raw.cwd) ?? asString(payload.cwd),
        },
      },
    ];
  }

  if (
    type === 'message_delta' ||
    type === 'assistant_message_delta' ||
    type === 'output_text_delta'
  ) {
    return [
      {
        provider: 'copilot',
        type: 'message',
        role: 'assistant',
        text: asString(raw.delta) ?? asString(payload.delta) ?? asString(payload.text) ?? '',
        delta: true,
        ts,
        originalItem: raw,
        extra: { sessionId },
      },
    ];
  }

  const role = asString(payload.role) ?? asString(raw.role);
  if (
    type === 'message' ||
    type === 'assistant_message' ||
    type === 'response' ||
    role === 'assistant'
  ) {
    const text =
      asString(raw.text) ??
      asString(payload.text) ??
      textFromContent(payload.content) ??
      textFromContent(raw.content);
    return text
      ? [
          {
            provider: 'copilot',
            type: 'message',
            role: role === 'user' || role === 'system' ? role : 'assistant',
            text,
            ts,
            originalItem: raw,
            extra: { sessionId },
          },
        ]
      : [];
  }

  if (
    type === 'tool_call' ||
    type === 'tool_use' ||
    type === 'tool_execution_start'
  ) {
    return [
      {
        provider: 'copilot',
        type: 'tool_use',
        name:
          asString(payload.name) ??
          asString(payload.tool) ??
          asString(raw.name) ??
          'tool',
        callId:
          asString(payload.call_id) ??
          asString(payload.callId) ??
          asString(payload.id) ??
          asString(raw.id),
        args: payload.arguments ?? payload.args ?? payload.input,
        ts,
        originalItem: raw,
        extra: { sessionId },
      },
    ];
  }

  if (
    type === 'tool_result' ||
    type === 'tool_execution_end' ||
    type === 'function_call_output'
  ) {
    return [
      {
        provider: 'copilot',
        type: 'tool_result',
        name: asString(payload.name) ?? asString(payload.tool) ?? asString(raw.name),
        callId:
          asString(payload.call_id) ??
          asString(payload.callId) ??
          asString(payload.id) ??
          asString(raw.id),
        result: payload.output ?? payload.result ?? payload.content ?? payload,
        error: payload.error,
        ts,
        originalItem: raw,
        extra: {
          sessionId,
          status: asString(payload.status),
        },
      },
    ];
  }

  if (
    (type === 'usage' || payload.usage) &&
    type !== 'done' &&
    type !== 'turn_end' &&
    type !== 'result'
  ) {
    const stats = usageFrom(payload.usage ?? payload);
    if (stats && stats.costUsd === undefined) {
      stats.costUsd = estimateCostUsd(asString(raw.model) ?? asString(payload.model), stats);
    }
    return [
      {
        provider: 'copilot',
        type: 'usage',
        stats,
        ts,
        originalItem: raw,
        extra: { raw: payload.usage ?? payload },
      },
    ];
  }

  if (type === 'error') {
    const message =
      asString(raw.message) ??
      asString(payload.message) ??
      asString(payload.error) ??
      'Copilot CLI error';
    const c = classifyCopilotError({
      message,
      rawCode:
        asString(raw.code) ??
        asString(payload.code) ??
        asString(payload.type),
    });
    return [
      {
        provider: 'copilot',
        type: 'error',
        code: c.code,
        retryable: c.retryable,
        message,
        ts,
        originalItem: raw,
      },
    ];
  }

  if (type === 'done' || type === 'turn_end' || type === 'result') {
    const events: CoderStreamEvent<'copilot'>[] = [];
    const text =
      asString(raw.text) ??
      asString(payload.text) ??
      asString(raw.result) ??
      asString(payload.result);
    if (text) {
      events.push({
        provider: 'copilot',
        type: 'message',
        role: 'assistant',
        text,
        ts,
        originalItem: raw,
        extra: { sessionId },
      });
    }
    const usage = usageFrom(raw.usage ?? payload.usage);
    if (usage) {
      usage.costUsd = usage.costUsd ?? estimateCostUsd(asString(raw.model), usage);
      events.push({
        provider: 'copilot',
        type: 'usage',
        stats: usage,
        ts,
        originalItem: raw,
        extra: { raw: raw.usage ?? payload.usage },
      });
    }
    events.push({
      provider: 'copilot',
      type: 'done',
      ts,
      originalItem: raw,
      extra: {
        terminalReason:
          asString(raw.reason) ?? asString(payload.reason) ?? 'success',
      },
    });
    return events;
  }

  if (type) {
    return [
      {
        provider: 'copilot',
        type: 'progress',
        label: type,
        ts,
        originalItem: raw,
        extra: { label: type, rawType: type },
      },
    ];
  }

  return [];
}
