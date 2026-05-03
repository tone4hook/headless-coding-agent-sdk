import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  CliExitError,
  CliNotFoundError,
  CliVersionError,
  CoderError,
  FeatureNotSupportedError,
  GeminiBridgeNotLoadedError,
  type ErrorCode,
} from '../src/errors.js';

describe('errors taxonomy', () => {
  it('CliNotFoundError pins code and carries provider + message', () => {
    const err = new CliNotFoundError('claude', 'claude');
    expect(err).toBeInstanceOf(CoderError);
    expect(err.code).toBe('CLI_NOT_FOUND');
    expect(err.provider).toBe('claude');
    expect(err.message).toContain('claude');
    expect(err.name).toBe('CliNotFoundError');
  });

  it('CliVersionError exposes installed/required', () => {
    const err = new CliVersionError('gemini', '0.10.0', '0.38.0');
    expect(err.code).toBe('CLI_VERSION');
    expect(err.installed).toBe('0.10.0');
    expect(err.required).toBe('0.38.0');
    expect(err.message).toContain('0.10.0');
    expect(err.message).toContain('0.38.0');
  });

  it('FeatureNotSupportedError carries feature and optional hint', () => {
    const bare = new FeatureNotSupportedError('claude', 'yolo');
    expect(bare.code).toBe('FEATURE_NOT_SUPPORTED');
    expect(bare.feature).toBe('yolo');
    expect(bare.message).toContain('yolo');
    expect(bare.message).not.toMatch(/: $/);

    const hinted = new FeatureNotSupportedError('claude', 'yolo', 'use gemini');
    expect(hinted.message).toContain('use gemini');
  });

  it('GeminiBridgeNotLoadedError pins provider to gemini', () => {
    const err = new GeminiBridgeNotLoadedError('hca-bridge', 'home dropped');
    expect(err.code).toBe('GEMINI_BRIDGE_NOT_LOADED');
    expect(err.provider).toBe('gemini');
    expect(err.mcpServerName).toBe('hca-bridge');
    expect(err.message).toContain('home dropped');
  });

  it('CliExitError captures exitCode, signal, stderr; truncates tail to 3 lines', () => {
    const stderr = ['l1', 'l2', 'l3', 'l4', 'l5'].join('\n');
    const err = new CliExitError('claude', 2, null, stderr);
    expect(err.code).toBe('CLI_EXIT');
    expect(err.exitCode).toBe(2);
    expect(err.signal).toBeNull();
    expect(err.stderr).toBe(stderr);
    expect(err.message).toContain('l3');
    expect(err.message).toContain('l4');
    expect(err.message).toContain('l5');
    expect(err.message).not.toContain('l1');
    expect(err.message).not.toContain('l2');
  });

  it('CliExitError handles signal-only exits without crashing', () => {
    const err = new CliExitError('gemini', null, 'SIGTERM', '');
    expect(err.exitCode).toBeNull();
    expect(err.signal).toBe('SIGTERM');
    expect(err.message).toContain('SIGTERM');
  });

  it('all subclasses are instanceof CoderError', () => {
    const errs: CoderError[] = [
      new CliNotFoundError('claude', 'claude'),
      new CliVersionError('claude', '0', '1'),
      new FeatureNotSupportedError('claude', 'x'),
      new GeminiBridgeNotLoadedError('hca-bridge'),
      new CliExitError('claude', 1, null, ''),
    ];
    for (const e of errs) expect(e).toBeInstanceOf(CoderError);
  });

  it('ErrorCode union is the exhaustive set of codes', () => {
    const codes: ErrorCode[] = [
      'CLI_NOT_FOUND',
      'CLI_VERSION',
      'FEATURE_NOT_SUPPORTED',
      'GEMINI_BRIDGE_NOT_LOADED',
      'CLI_EXIT',
      'UNKNOWN_PROVIDER',
    ];
    expect(new Set(codes).size).toBe(6);
    expectTypeOf<ErrorCode>().toEqualTypeOf<
      | 'CLI_NOT_FOUND'
      | 'CLI_VERSION'
      | 'FEATURE_NOT_SUPPORTED'
      | 'GEMINI_BRIDGE_NOT_LOADED'
      | 'CLI_EXIT'
      | 'UNKNOWN_PROVIDER'
    >();
  });

  it('subclass code fields narrow to literals', () => {
    const err = new CliExitError('claude', 1, null, '');
    // Narrowed literal — non-matching string would be a TS error.
    expectTypeOf(err.code).toEqualTypeOf<'CLI_EXIT'>();
    if (err.code === 'CLI_EXIT') {
      expect(err.exitCode).toBe(1);
    }
  });
});
