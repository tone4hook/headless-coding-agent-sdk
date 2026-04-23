/**
 * Pure translator from claude CLI stream-json lines to unified
 * CoderStreamEvent<'claude'>.
 *
 * One raw line can produce 0-N events (e.g. an assistant message with
 * multiple content items emits one event per item; a result line emits
 * `usage` + `done`; an error result emits `error` before `done`).
 *
 * Invalid JSON lines are dropped (returned as []).
 */

import type { CoderStreamEvent } from '../../types.js';

type ClaudeEvent = CoderStreamEvent<'claude'>;

export function translateClaudeLine(line: string): ClaudeEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return [];
  }

  const ts = Date.now();
  const type = raw.type;

  if (type === 'system') return handleSystem(raw, ts);
  if (type === 'assistant') return handleAssistant(raw, ts);
  if (type === 'user') return handleUser(raw, ts);
  if (type === 'result') return handleResult(raw, ts);

  return [];
}

function handleSystem(raw: Record<string, unknown>, ts: number): ClaudeEvent[] {
  const subtype = raw.subtype as string | undefined;

  if (subtype === 'init') {
    return [
      {
        type: 'init',
        provider: 'claude',
        threadId: raw.session_id as string | undefined,
        model: raw.model as string | undefined,
        ts,
        extra: {
          cwd: raw.cwd as string | undefined,
          apiKeySource: raw.apiKeySource as string | undefined,
          claudeCodeVersion: raw.claude_code_version as string | undefined,
          permissionMode: raw.permissionMode as string | undefined,
          outputStyle: raw.output_style as string | undefined,
          agents: raw.agents as string[] | undefined,
          skills: raw.skills as string[] | undefined,
          plugins: raw.plugins as Array<{ name: string; path: string; source: string }> | undefined,
          mcpServers: raw.mcp_servers as Array<{ name: string; status: string }> | undefined,
        },
        originalItem: raw,
      },
    ];
  }

  if (subtype === 'hook_started' || subtype === 'hook_response') {
    return [
      {
        type: 'progress',
        provider: 'claude',
        label: raw.hook_name as string | undefined,
        detail: subtype,
        ts,
        extra: {
          subtype,
          hookName: raw.hook_name as string | undefined,
          hookId: raw.hook_id as string | undefined,
          hookEvent: raw.hook_event as string | undefined,
          exitCode: raw.exit_code as number | undefined,
          outcome: raw.outcome as string | undefined,
        },
        originalItem: raw,
      },
    ];
  }

  // Unknown system subtype — surface as a generic progress event so nothing
  // is silently lost; clients can inspect originalItem for detail.
  return [
    {
      type: 'progress',
      provider: 'claude',
      label: `system:${subtype ?? 'unknown'}`,
      ts,
      extra: { subtype },
      originalItem: raw,
    },
  ];
}

interface AssistantContentItem {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  thinking?: string;
  [key: string]: unknown;
}

function handleAssistant(raw: Record<string, unknown>, ts: number): ClaudeEvent[] {
  const msg = raw.message as Record<string, unknown> | undefined;
  if (!msg) return [];
  const content = (msg.content as AssistantContentItem[] | undefined) ?? [];
  const events: ClaudeEvent[] = [];
  const parentToolUseId = (raw.parent_tool_use_id as string | null | undefined) ?? null;
  const eventUuid = raw.uuid as string | undefined;

  for (const item of content) {
    if (item.type === 'text' && typeof item.text === 'string') {
      events.push({
        type: 'message',
        provider: 'claude',
        role: 'assistant',
        text: item.text,
        delta: false,
        ts,
        extra: {
          stopReason: msg.stop_reason as string | undefined,
          eventUuid,
          parentToolUseId,
        },
        originalItem: raw,
      });
    } else if (item.type === 'tool_use') {
      events.push({
        type: 'tool_use',
        provider: 'claude',
        name: item.name ?? '',
        callId: item.id,
        args: item.input,
        ts,
        extra: { parentToolUseId, eventUuid },
        originalItem: raw,
      });
    } else if (item.type === 'thinking' && typeof item.thinking === 'string') {
      events.push({
        type: 'message',
        provider: 'claude',
        role: 'assistant',
        text: item.thinking,
        delta: false,
        ts,
        extra: { thinking: item.thinking, eventUuid, parentToolUseId },
        originalItem: raw,
      });
    }
  }

  // Surface authentication/other top-level errors on the assistant line
  // (they show up as `"error":"..."` alongside the message).
  if (typeof raw.error === 'string') {
    events.push({
      type: 'error',
      provider: 'claude',
      message: raw.error,
      code: raw.error,
      ts,
      originalItem: raw,
    });
  }

  return events;
}

interface UserContentItem {
  type: string;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
  [key: string]: unknown;
}

function handleUser(raw: Record<string, unknown>, ts: number): ClaudeEvent[] {
  const msg = raw.message as Record<string, unknown> | undefined;
  if (!msg) return [];
  const content = (msg.content as UserContentItem[] | undefined) ?? [];
  const events: ClaudeEvent[] = [];
  const parentToolUseId = (raw.parent_tool_use_id as string | null | undefined) ?? null;

  for (const item of content) {
    if (item.type === 'tool_result') {
      events.push({
        type: 'tool_result',
        provider: 'claude',
        callId: item.tool_use_id,
        result: item.content,
        error: item.is_error ? item.content : undefined,
        ts,
        extra: { parentToolUseId },
        originalItem: raw,
      });
    }
  }

  return events;
}

function handleResult(raw: Record<string, unknown>, ts: number): ClaudeEvent[] {
  const events: ClaudeEvent[] = [];
  const usage = raw.usage as Record<string, unknown> | undefined;

  if (usage) {
    events.push({
      type: 'usage',
      provider: 'claude',
      stats: {
        inputTokens: usage.input_tokens as number | undefined,
        outputTokens: usage.output_tokens as number | undefined,
        cacheCreationTokens: usage.cache_creation_input_tokens as number | undefined,
        cacheReadTokens: usage.cache_read_input_tokens as number | undefined,
        costUsd: raw.total_cost_usd as number | undefined,
        durationMs: raw.duration_ms as number | undefined,
        numTurns: raw.num_turns as number | undefined,
        raw: usage,
      },
      ts,
      extra: {
        modelUsage: raw.modelUsage as Record<string, unknown> | undefined,
        cacheCreationTokens: usage.cache_creation_input_tokens as number | undefined,
        cacheReadTokens: usage.cache_read_input_tokens as number | undefined,
      },
      originalItem: raw,
    });
  }

  if (raw.is_error === true) {
    events.push({
      type: 'error',
      provider: 'claude',
      message: (raw.result as string | undefined) ?? 'CLI reported error',
      code: raw.subtype as string | undefined,
      ts,
      extra: { apiErrorStatus: raw.api_error_status as number | undefined },
      originalItem: raw,
    });
  }

  events.push({
    type: 'done',
    provider: 'claude',
    ts,
    extra: {
      numTurns: raw.num_turns as number | undefined,
      totalCostUsd: raw.total_cost_usd as number | undefined,
      permissionDenials: raw.permission_denials as unknown[] | undefined,
      terminalReason: raw.terminal_reason as string | undefined,
      apiErrorStatus: raw.api_error_status as number | undefined,
    },
    originalItem: raw,
  });

  return events;
}
