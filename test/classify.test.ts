import { describe, expect, it } from 'vitest';
import {
  classifyExitCode,
  classifyStderrPatterns,
} from '../src/adapters/shared/classify.js';
import { classifyClaudeError } from '../src/adapters/claude/classify.js';
import { classifyCodexError } from '../src/adapters/codex/classify.js';
import { classifyCopilotError } from '../src/adapters/copilot/classify.js';
import { classifyPiError } from '../src/adapters/pi/classify.js';
import type { CoderErrorCode } from '../src/types.js';

describe('shared classifyStderrPatterns', () => {
  const cases: Array<[string, CoderErrorCode]> = [
    ['Error: 429 too many requests', 'rate_limit'],
    ['anthropic: overloaded', 'rate_limit'],
    ['401 Unauthorized', 'auth_expired'],
    ['Could not authenticate with API', 'auth_expired'],
    ['Context window exceeded', 'context_too_large'],
    ['fetch failed: ECONNRESET', 'network_error'],
    ['operation timed out', 'timeout'],
    ['tool execution failed unexpectedly', 'tool_crash'],
  ];
  it.each(cases)('classifies %s', (input, expected) => {
    expect(classifyStderrPatterns(input)?.code).toBe(expected);
  });
  it('returns undefined for unrelated text', () => {
    expect(classifyStderrPatterns('all good')).toBeUndefined();
  });
});

describe('classifyExitCode', () => {
  it('124 -> timeout', () => expect(classifyExitCode(124)?.code).toBe('timeout'));
  it('127 -> binary_not_found', () =>
    expect(classifyExitCode(127)?.code).toBe('binary_not_found'));
  it('0 -> undefined', () => expect(classifyExitCode(0)).toBeUndefined());
  it('null -> undefined', () => expect(classifyExitCode(null)).toBeUndefined());
});

describe('classifyClaudeError', () => {
  it('apiErrorStatus 401 -> auth_expired', () => {
    expect(classifyClaudeError({ apiErrorStatus: 401 }).code).toBe(
      'auth_expired',
    );
  });
  it('apiErrorStatus 429 -> rate_limit (retryable)', () => {
    const c = classifyClaudeError({ apiErrorStatus: 429 });
    expect(c.code).toBe('rate_limit');
    expect(c.retryable).toBe(true);
  });
  it('subtype context_length_exceeded -> context_too_large', () => {
    expect(
      classifyClaudeError({ subtype: 'context_length_exceeded' }).code,
    ).toBe('context_too_large');
  });
  it('falls back to message regex', () => {
    expect(classifyClaudeError({ message: 'fetch failed' }).code).toBe(
      'network_error',
    );
  });
});

describe('classifyCodexError', () => {
  it('rawCode rate_limited -> rate_limit', () => {
    expect(classifyCodexError({ rawCode: 'rate_limited' }).code).toBe(
      'rate_limit',
    );
  });
  it('rawCode token_limit_exceeded -> context_too_large', () => {
    expect(
      classifyCodexError({ rawCode: 'token_limit_exceeded' }).code,
    ).toBe('context_too_large');
  });
  it('rawCode protocol_error -> protocol_error', () => {
    expect(classifyCodexError({ rawCode: 'protocol_error' }).code).toBe(
      'protocol_error',
    );
  });
});

describe('classifyCopilotError', () => {
  it('rawCode auth_required -> auth_expired', () => {
    expect(classifyCopilotError({ rawCode: 'auth_required' }).code).toBe(
      'auth_expired',
    );
  });
  it('falls back to message regex', () => {
    expect(classifyCopilotError({ message: 'rate limit hit' }).code).toBe(
      'rate_limit',
    );
  });
});

describe('classifyPiError', () => {
  it('rawCode quota_exceeded -> rate_limit', () => {
    expect(classifyPiError({ rawCode: 'quota_exceeded' }).code).toBe(
      'rate_limit',
    );
  });
  it('unknown -> unknown', () => {
    expect(classifyPiError({}).code).toBe('unknown');
  });
});
