/**
 * Classify a Codex CLI error into a CoderErrorCode.
 */

import type { CoderErrorCode } from '../../types.js';
import {
  classifyExitCode,
  classifyStderrPatterns,
  type Classification,
} from '../shared/classify.js';

export interface CodexErrorInput {
  message?: string;
  /** Raw `code` or `type` from the Codex JSON error payload. */
  rawCode?: string;
}

export function classifyCodexError(input: CodexErrorInput): Classification {
  const { message, rawCode } = input;

  if (rawCode) {
    const lc = rawCode.toLowerCase();
    if (lc.includes('rate') || lc.includes('overload') || lc.includes('429')) {
      return { code: 'rate_limit', retryable: true };
    }
    if (lc.includes('auth') || lc.includes('401') || lc.includes('403')) {
      return { code: 'auth_expired', retryable: false };
    }
    if (lc.includes('context') || lc.includes('token_limit')) {
      return { code: 'context_too_large', retryable: false };
    }
    if (lc.includes('network') || lc.includes('connection')) {
      return { code: 'network_error', retryable: true };
    }
    if (lc.includes('timeout') || lc.includes('deadline')) {
      return { code: 'timeout', retryable: true };
    }
    if (lc.includes('protocol') || lc.includes('parse')) {
      return { code: 'protocol_error', retryable: false };
    }
  }

  const fromPatterns = classifyStderrPatterns(message ?? '');
  if (fromPatterns) return fromPatterns;

  return { code: 'unknown' };
}

export function classifyCodexExit(
  exitCode: number | null,
  stderr: string,
): { code: CoderErrorCode; retryable?: boolean } | undefined {
  const fromExit = classifyExitCode(exitCode);
  if (fromExit) return fromExit;
  return classifyStderrPatterns(stderr);
}
