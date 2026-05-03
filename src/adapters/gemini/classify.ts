/**
 * Classify a Gemini CLI error/result into a CoderErrorCode.
 */

import type { CoderErrorCode } from '../../types.js';
import {
  classifyExitCode,
  classifyStderrPatterns,
  type Classification,
} from '../shared/classify.js';

export interface GeminiErrorInput {
  message?: string;
  /** Status string from a Gemini `result` event, if any. */
  status?: string;
  /** `error.type` from a structured Gemini error payload. */
  errorType?: string;
}

export function classifyGeminiError(input: GeminiErrorInput): Classification {
  const { message, errorType } = input;

  if (errorType) {
    const lc = errorType.toLowerCase();
    if (lc.includes('rate') || lc.includes('quota') || lc.includes('overload')) {
      return { code: 'rate_limit', retryable: true };
    }
    if (lc.includes('auth') || lc.includes('permission')) {
      return { code: 'auth_expired', retryable: false };
    }
    if (lc.includes('context') || lc.includes('token')) {
      return { code: 'context_too_large', retryable: false };
    }
    if (lc.includes('network') || lc.includes('fetch')) {
      return { code: 'network_error', retryable: true };
    }
    if (lc.includes('timeout') || lc.includes('deadline')) {
      return { code: 'timeout', retryable: true };
    }
  }

  const fromPatterns = classifyStderrPatterns(message ?? '');
  if (fromPatterns) return fromPatterns;

  return { code: 'unknown' };
}

export function classifyGeminiExit(
  exitCode: number | null,
  stderr: string,
): { code: CoderErrorCode; retryable?: boolean } | undefined {
  const fromExit = classifyExitCode(exitCode);
  if (fromExit) return fromExit;
  return classifyStderrPatterns(stderr);
}
