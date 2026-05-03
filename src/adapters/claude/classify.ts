/**
 * Classify a Claude CLI error/result line into a CoderErrorCode.
 */

import type { CoderErrorCode } from '../../types.js';
import {
  classifyExitCode,
  classifyStderrPatterns,
  type Classification,
} from '../shared/classify.js';

export interface ClaudeErrorInput {
  message?: string;
  /** `subtype` from a Claude `result` event, if any. */
  subtype?: string;
  /** Numeric `api_error_status`, if any. */
  apiErrorStatus?: number;
}

export function classifyClaudeError(input: ClaudeErrorInput): Classification {
  const { message, subtype, apiErrorStatus } = input;

  if (apiErrorStatus !== undefined) {
    if (apiErrorStatus === 401 || apiErrorStatus === 403) {
      return { code: 'auth_expired', retryable: false };
    }
    if (apiErrorStatus === 429) return { code: 'rate_limit', retryable: true };
    if (apiErrorStatus >= 500) return { code: 'network_error', retryable: true };
  }

  if (subtype) {
    const lc = subtype.toLowerCase();
    if (lc.includes('overload')) return { code: 'rate_limit', retryable: true };
    if (lc.includes('auth')) return { code: 'auth_expired', retryable: false };
    if (lc.includes('context')) return { code: 'context_too_large', retryable: false };
    if (lc.includes('rate')) return { code: 'rate_limit', retryable: true };
  }

  const fromPatterns = classifyStderrPatterns(message ?? '');
  if (fromPatterns) return fromPatterns;

  return { code: 'unknown' };
}

export function classifyClaudeExit(
  exitCode: number | null,
  stderr: string,
): { code: CoderErrorCode; retryable?: boolean } | undefined {
  const fromExit = classifyExitCode(exitCode);
  if (fromExit) return fromExit;
  return classifyStderrPatterns(stderr);
}
