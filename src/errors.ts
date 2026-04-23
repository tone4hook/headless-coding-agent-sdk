/**
 * Error types thrown by the SDK.
 *
 * All errors extend CoderError so callers can branch on
 * `err instanceof CoderError` to reliably distinguish SDK-originated
 * failures from unrelated runtime errors.
 */

import type { Provider } from './types.js';

export class CoderError extends Error {
  readonly code: string;
  readonly provider?: Provider;

  constructor(code: string, message: string, provider?: Provider) {
    super(message);
    this.name = 'CoderError';
    this.code = code;
    this.provider = provider;
  }
}

/** Thrown when the configured CLI binary cannot be located on PATH. */
export class CliNotFoundError extends CoderError {
  constructor(bin: string, provider: Provider) {
    super('CLI_NOT_FOUND', `${bin} binary not found on PATH`, provider);
    this.name = 'CliNotFoundError';
  }
}

/** Thrown when the installed CLI version is below the supported floor. */
export class CliVersionError extends CoderError {
  readonly installed: string;
  readonly required: string;

  constructor(provider: Provider, installed: string, required: string) {
    super(
      'CLI_VERSION',
      `${provider} CLI version ${installed} is below required ${required}`,
      provider,
    );
    this.name = 'CliVersionError';
    this.installed = installed;
    this.required = required;
  }
}

/** Thrown when a caller requests a feature the target adapter does not support. */
export class FeatureNotSupportedError extends CoderError {
  readonly feature: string;

  constructor(provider: Provider, feature: string, hint?: string) {
    super(
      'FEATURE_NOT_SUPPORTED',
      `Feature "${feature}" is not supported by the ${provider} adapter${hint ? `: ${hint}` : ''}`,
      provider,
    );
    this.name = 'FeatureNotSupportedError';
    this.feature = feature;
  }
}

/** Thrown when the CLI subprocess exits with a non-zero code. */
export class CliExitError extends CoderError {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;

  constructor(
    provider: Provider,
    exitCode: number | null,
    signal: NodeJS.Signals | null,
    stderr: string,
  ) {
    const tail = stderr.trim().split('\n').slice(-3).join('\n');
    super(
      'CLI_EXIT',
      `${provider} CLI exited ${exitCode ?? 'null'}${signal ? ` (signal ${signal})` : ''}${tail ? `: ${tail}` : ''}`,
      provider,
    );
    this.name = 'CliExitError';
    this.exitCode = exitCode;
    this.signal = signal;
    this.stderr = stderr;
  }
}
