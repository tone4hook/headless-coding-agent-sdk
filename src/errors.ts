/**
 * Error types thrown by the SDK.
 *
 * All errors extend CoderError so callers can branch on
 * `err instanceof CoderError` to reliably distinguish SDK-originated
 * failures from unrelated runtime errors. Each subclass pins `code` to
 * a literal in `ErrorCode`, so `if (err.code === 'CLI_EXIT') …` narrows
 * with autocomplete.
 */

import type { Provider } from './types.js';

export type ErrorCode =
  | 'CLI_NOT_FOUND'
  | 'CLI_VERSION'
  | 'FEATURE_NOT_SUPPORTED'
  | 'GEMINI_BRIDGE_NOT_LOADED'
  | 'CLI_EXIT'
  | 'UNKNOWN_PROVIDER';

export class CoderError extends Error {
  readonly code: ErrorCode;
  readonly provider?: Provider;

  constructor(code: ErrorCode, message: string, provider?: Provider) {
    super(message);
    this.name = 'CoderError';
    this.code = code;
    this.provider = provider;
  }
}

/** Thrown when the configured CLI binary cannot be located on PATH. */
export class CliNotFoundError extends CoderError {
  readonly code = 'CLI_NOT_FOUND' as const;

  constructor(bin: string, provider: Provider) {
    super('CLI_NOT_FOUND', `${bin} binary not found on PATH`, provider);
    this.name = 'CliNotFoundError';
  }
}

/** Thrown when the installed CLI version is below the supported floor. */
export class CliVersionError extends CoderError {
  readonly code = 'CLI_VERSION' as const;
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
  readonly code = 'FEATURE_NOT_SUPPORTED' as const;
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

/**
 * Thrown when the SDK-owned MCP bridge is configured but cannot be confirmed
 * to be loaded by the Gemini CLI (e.g. a future Gemini build dropping the
 * undocumented `GEMINI_CLI_HOME` env override that the adapter relies on for
 * non-mutating settings injection). Surfaces fast instead of letting custom
 * tools silently disappear.
 */
export class GeminiBridgeNotLoadedError extends CoderError {
  readonly code = 'GEMINI_BRIDGE_NOT_LOADED' as const;
  readonly mcpServerName: string;

  constructor(mcpServerName: string, hint?: string) {
    super(
      'GEMINI_BRIDGE_NOT_LOADED',
      `Gemini MCP bridge "${mcpServerName}" was not detected after setup${hint ? `: ${hint}` : ''}`,
      'gemini',
    );
    this.name = 'GeminiBridgeNotLoadedError';
    this.mcpServerName = mcpServerName;
  }
}

/** Thrown when the CLI subprocess exits with a non-zero code. */
export class CliExitError extends CoderError {
  readonly code = 'CLI_EXIT' as const;
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
