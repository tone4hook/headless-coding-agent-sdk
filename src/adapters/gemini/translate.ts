/**
 * Pure translator from gemini CLI stream-json lines to unified
 * CoderStreamEvent<'gemini'>.
 *
 * Shapes captured live from gemini 0.38.2 output-format=stream-json:
 *   init         → {type, timestamp, session_id, model}
 *   message      → {type, timestamp, role, content, delta?}
 *   tool_use     → {type, timestamp, tool_name, tool_id, parameters}
 *   tool_result  → {type, timestamp, tool_id, status, output}
 *   result       → {type, timestamp, status, stats}
 */

import type { CoderStreamEvent, UsageStats } from '../../types.js';

type GeminiEvent = CoderStreamEvent<'gemini'>;

export function translateGeminiLine(line: string): GeminiEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return [];
  }

  const ts = toTs(raw.timestamp);
  const type = raw.type;

  if (type === 'init') {
    return [
      {
        type: 'init',
        provider: 'gemini',
        threadId: raw.session_id as string | undefined,
        model: raw.model as string | undefined,
        ts,
        extra: { timestamp: raw.timestamp as string | undefined },
        originalItem: raw,
      },
    ];
  }

  if (type === 'message') {
    const role = raw.role as 'user' | 'assistant' | 'system' | undefined;
    if (!role) return [];
    const text = typeof raw.content === 'string' ? (raw.content as string) : undefined;
    return [
      {
        type: 'message',
        provider: 'gemini',
        role,
        text,
        delta: raw.delta === true,
        ts,
        extra: { timestamp: raw.timestamp as string | undefined },
        originalItem: raw,
      },
    ];
  }

  if (type === 'tool_use') {
    return [
      {
        type: 'tool_use',
        provider: 'gemini',
        name: (raw.tool_name as string | undefined) ?? '',
        callId: raw.tool_id as string | undefined,
        args: raw.parameters,
        ts,
        extra: { timestamp: raw.timestamp as string | undefined },
        originalItem: raw,
      },
    ];
  }

  if (type === 'tool_result') {
    const status = raw.status as 'success' | 'error' | undefined;
    return [
      {
        type: 'tool_result',
        provider: 'gemini',
        callId: raw.tool_id as string | undefined,
        result: raw.output,
        error: status === 'error' ? raw.output : undefined,
        ts,
        extra: {
          timestamp: raw.timestamp as string | undefined,
          status,
        },
        originalItem: raw,
      },
    ];
  }

  if (type === 'result') {
    const events: GeminiEvent[] = [];
    const stats = (raw.stats as Record<string, unknown> | undefined) ?? {};
    const usage: UsageStats = {
      inputTokens: stats.input_tokens as number | undefined,
      outputTokens: stats.output_tokens as number | undefined,
      totalTokens: stats.total_tokens as number | undefined,
      durationMs: stats.duration_ms as number | undefined,
      raw: stats,
    };
    events.push({
      type: 'usage',
      provider: 'gemini',
      stats: usage,
      ts,
      extra: {
        cached: stats.cached as number | undefined,
        toolCalls: stats.tool_calls as number | undefined,
        models: stats.models as Record<string, UsageStats> | undefined,
      },
      originalItem: raw,
    });

    const status = raw.status as string | undefined;
    if (status === 'error') {
      events.push({
        type: 'error',
        provider: 'gemini',
        message: 'Gemini CLI reported an error result',
        code: status,
        ts,
        originalItem: raw,
      });
    }

    events.push({
      type: 'done',
      provider: 'gemini',
      ts,
      extra: { terminalReason: status },
      originalItem: raw,
    });
    return events;
  }

  return [];
}

function toTs(v: unknown): number {
  if (typeof v === 'string') {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
  }
  return Date.now();
}
