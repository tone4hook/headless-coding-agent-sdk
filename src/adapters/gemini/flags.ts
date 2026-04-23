/**
 * Maps shared StartOpts + RunOpts to `gemini` CLI argv.
 *
 * Verified against gemini CLI 0.38.2 (`gemini --help`). Claude-only
 * fields throw FeatureNotSupportedError.
 */

import { FeatureNotSupportedError } from '../../errors.js';
import type { PermissionPolicy, RunOpts, SharedStartOpts } from '../../types.js';

export interface BuildGeminiArgvInput {
  prompt: string;
  opts: SharedStartOpts & RunOpts;
  resumeId?: string;
  /** Resume the most recent session. Maps to `--resume latest`. */
  resumeLatest?: boolean;
}

const CLAUDE_ONLY_FIELDS = [
  'permissionMode',
  'settingSources',
  'addDirs',
  'forkSession',
  'systemPrompt',
  'appendSystemPrompt',
  'agents',
  'maxBudgetUsd',
] as const;

export function buildGeminiArgv(input: BuildGeminiArgvInput): string[] {
  const { opts, prompt, resumeId, resumeLatest } = input;

  for (const field of CLAUDE_ONLY_FIELDS) {
    if ((opts as Record<string, unknown>)[field] !== undefined) {
      throw new FeatureNotSupportedError(
        'gemini',
        field,
        `Field "${field}" is a Claude-only option; use the claude adapter or remove it.`,
      );
    }
  }

  if (opts.outputSchema !== undefined && opts.strictSchema === true) {
    throw new FeatureNotSupportedError(
      'gemini',
      'outputSchema (strict)',
      'Gemini CLI has no --json-schema flag. Set strictSchema:false for prompt-injected best-effort, or use the claude adapter.',
    );
  }

  const argv: string[] = ['-p', prompt, '--output-format', 'stream-json'];

  if (opts.model) argv.push('-m', opts.model);

  if (opts.yolo) argv.push('-y');
  if (opts.sandbox) argv.push('-s');

  if (opts.approvalMode) argv.push('--approval-mode', opts.approvalMode);

  if (opts.permissionPolicy) applyPermissionPolicy(argv, opts.permissionPolicy);

  if (opts.policyFiles && opts.policyFiles.length > 0) {
    for (const f of opts.policyFiles) argv.push('--policy', f);
  }
  if (opts.adminPolicyFiles && opts.adminPolicyFiles.length > 0) {
    for (const f of opts.adminPolicyFiles) argv.push('--admin-policy', f);
  }

  if (opts.allowedTools && opts.allowedTools.length > 0) {
    // Deprecated in favor of the policy engine but still accepted.
    argv.push('--allowed-tools', opts.allowedTools.join(','));
  }

  if (opts.extensions && opts.extensions.length > 0) {
    argv.push('-e', opts.extensions.join(','));
  }

  if (opts.includeDirectories && opts.includeDirectories.length > 0) {
    argv.push('--include-directories', opts.includeDirectories.join(','));
  }

  if (opts.allowedMcpServerNames && opts.allowedMcpServerNames.length > 0) {
    argv.push('--allowed-mcp-server-names', opts.allowedMcpServerNames.join(','));
  }

  if (resumeId) {
    argv.push('--resume', resumeId);
  } else if (resumeLatest) {
    argv.push('--resume', 'latest');
  }

  return argv;
}

function applyPermissionPolicy(argv: string[], policy: PermissionPolicy): void {
  // Precedence: an explicit approvalMode wins; this fills in when the caller
  // only set the shared policy.
  if (argv.includes('--approval-mode')) return;
  switch (policy.mode) {
    case 'accept-edits':
      argv.push('--approval-mode', 'auto_edit');
      break;
    case 'plan':
      argv.push('--approval-mode', 'plan');
      break;
    case 'bypass':
      argv.push('--approval-mode', 'yolo');
      break;
    default:
      break;
  }
  // Gemini has no tool-name deny list at the CLI layer; policy.deny is
  // silently ignored here and a progress warning is emitted at runtime.
}
