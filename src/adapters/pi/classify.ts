/**
 * Classify a Pi coding-agent error into a CoderErrorCode.
 */

import type { CoderErrorCode } from '../../types.js';
import {
  classifyExitCode,
  classifyStderrPatterns,
  type Classification,
} from '../shared/classify.js';

export interface PiErrorInput {
  message?: string;
  rawCode?: string;
}

export function classifyPiError(input: PiErrorInput): Classification {
  const { message, rawCode } = input;

  if (rawCode) {
    const lc = rawCode.toLowerCase();
    if (lc.includes('rate') || lc.includes('quota') || lc.includes('429')) {
      return { code: 'rate_limit', retryable: true };
    }
    if (lc.includes('auth') || lc.includes('api_key') || lc.includes('401')) {
      return { code: 'auth_expired', retryable: false };
    }
    if (lc.includes('context') || lc.includes('token')) {
      return { code: 'context_too_large', retryable: false };
    }
    if (lc.includes('network') || lc.includes('connection')) {
      return { code: 'network_error', retryable: true };
    }
    if (lc.includes('timeout')) {
      return { code: 'timeout', retryable: true };
    }
  }

  const fromPatterns = classifyStderrPatterns(message ?? '');
  if (fromPatterns) return fromPatterns;

  return { code: 'unknown' };
}

export function classifyPiExit(
  exitCode: number | null,
  stderr: string,
): { code: CoderErrorCode; retryable?: boolean } | undefined {
  const fromExit = classifyExitCode(exitCode);
  if (fromExit) return fromExit;
  return classifyStderrPatterns(stderr);
}
