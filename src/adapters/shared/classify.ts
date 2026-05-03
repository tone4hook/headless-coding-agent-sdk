/**
 * Shared classification helpers. Each adapter exposes its own classify.ts
 * with provider-specific knowledge; common patterns (stderr regexes, exit
 * codes that mean the same thing everywhere) live here.
 */

import type { CoderErrorCode } from '../../types.js';

export interface ClassifyInput {
  message?: string;
  /** Raw provider error code/subtype, if any. */
  rawCode?: string;
  /** Optional structured payload returned by the CLI. */
  payload?: unknown;
  /** Process exit code, if exit-time classification. */
  exitCode?: number | null;
  /** Aggregated stderr tail. */
  stderr?: string;
}

export interface Classification {
  code: CoderErrorCode;
  retryable?: boolean;
}

const RATE_LIMIT_RE =
  /\b(rate[ _-]?limit|429|too many requests|quota exceeded|overloaded)\b/i;
const AUTH_RE =
  /\b(unauthori[sz]ed|401|403|invalid api key|authentication failed|could not authenticate|auth(?:_| )?expired|token expired)\b/i;
const CONTEXT_RE =
  /\b(context (?:length|size|window) (?:exceeded|too large)|too many tokens|maximum context|prompt is too long)\b/i;
const NETWORK_RE =
  /\b(network|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|fetch failed|socket hang up|connection refused)\b/i;
const TIMEOUT_RE = /\b(timed out|timeout|deadline exceeded)\b/i;
const TOOL_CRASH_RE = /\b(tool crash|tool failed|tool execution failed)\b/i;

export function classifyStderrPatterns(haystack: string): Classification | undefined {
  if (!haystack) return undefined;
  if (RATE_LIMIT_RE.test(haystack)) return { code: 'rate_limit', retryable: true };
  if (AUTH_RE.test(haystack)) return { code: 'auth_expired', retryable: false };
  if (CONTEXT_RE.test(haystack)) return { code: 'context_too_large', retryable: false };
  if (NETWORK_RE.test(haystack)) return { code: 'network_error', retryable: true };
  if (TIMEOUT_RE.test(haystack)) return { code: 'timeout', retryable: true };
  if (TOOL_CRASH_RE.test(haystack)) return { code: 'tool_crash', retryable: false };
  return undefined;
}

export function classifyExitCode(code: number | null | undefined): Classification | undefined {
  if (code === undefined || code === null) return undefined;
  if (code === 124) return { code: 'timeout', retryable: true };
  if (code === 127) return { code: 'binary_not_found', retryable: false };
  return undefined;
}
