/**
 * Maps shared StartOpts + RunOpts to `codex exec` argv.
 */

import { FeatureNotSupportedError } from '../../errors.js';
import type { RunOpts, SharedStartOpts } from '../../types.js';

export interface BuildCodexArgvInput {
  opts: SharedStartOpts & RunOpts;
  outputSchemaPath?: string;
}

const CLAUDE_ONLY_FIELDS = [
  'permissionMode',
  'settingSources',
  'forkSession',
  'systemPrompt',
  'appendSystemPrompt',
  'agents',
  'maxBudgetUsd',
] as const;

const GEMINI_ONLY_FIELDS = [
  'approvalMode',
  'yolo',
  'sandbox',
  'policyFiles',
  'adminPolicyFiles',
  'extensions',
  'includeDirectories',
  'allowedMcpServerNames',
] as const;

function tomlString(value: string): string {
  return JSON.stringify(value);
}

export function buildCodexArgv(input: BuildCodexArgvInput): string[] {
  const { opts, outputSchemaPath } = input;

  for (const field of [...CLAUDE_ONLY_FIELDS, ...GEMINI_ONLY_FIELDS]) {
    if ((opts as Record<string, unknown>)[field] !== undefined) {
      throw new FeatureNotSupportedError(
        'codex',
        field,
        `Field "${field}" is not supported by the codex adapter.`,
      );
    }
  }

  if (opts.tools && opts.tools.length > 0) {
    throw new FeatureNotSupportedError(
      'codex',
      'tools',
      'Codex exec does not support the SDK MCP bridge in this adapter yet.',
    );
  }

  if (opts.allowedTools && opts.allowedTools.length > 0) {
    throw new FeatureNotSupportedError(
      'codex',
      'allowedTools',
      'Codex CLI does not expose a compatible per-tool allow list flag.',
    );
  }

  if (opts.permissionPolicy?.allow?.length) {
    throw new FeatureNotSupportedError(
      'codex',
      'permissionPolicy.allow',
      'Codex CLI does not expose a compatible per-tool allow list flag.',
    );
  }

  if (opts.permissionPolicy?.deny?.length) {
    throw new FeatureNotSupportedError(
      'codex',
      'permissionPolicy.deny',
      'Codex CLI does not expose a compatible per-tool deny list flag.',
    );
  }

  const argv = ['exec', '--json', '--skip-git-repo-check'];

  if (opts.model) argv.push('--model', opts.model);
  if (opts.workingDirectory) argv.push('-C', opts.workingDirectory);
  if (opts.addDirs && opts.addDirs.length > 0) {
    for (const dir of opts.addDirs) argv.push('--add-dir', dir);
  }

  if (
    opts.codexDangerouslyBypassApprovalsAndSandbox ||
    opts.permissionPolicy?.mode === 'bypass'
  ) {
    argv.push('--dangerously-bypass-approvals-and-sandbox');
  } else {
    argv.push('--full-auto');
  }

  if (opts.permissionPolicy?.mode === 'plan') {
    argv.push('--sandbox', 'read-only');
  } else if (opts.codexSandbox) {
    argv.push('--sandbox', opts.codexSandbox);
  }

  if (opts.codexDisablePlugins) argv.push('--disable', 'plugins');
  if (opts.codexSearch) argv.push('--search');
  if (opts.codexEphemeral) argv.push('--ephemeral');
  if (opts.codexIgnoreUserConfig) argv.push('--ignore-user-config');
  if (opts.codexIgnoreRules) argv.push('--ignore-rules');

  if (opts.codexReasoningEffort) {
    argv.push('-c', `model_reasoning_effort=${tomlString(opts.codexReasoningEffort)}`);
  }

  if (opts.codexNetworkAccess !== undefined) {
    argv.push(
      '-c',
      `sandbox_workspace_write.network_access=${String(opts.codexNetworkAccess)}`,
    );
  }

  if (outputSchemaPath) argv.push('--output-schema', outputSchemaPath);
  if (opts.maxTurns !== undefined) argv.push('-c', `model_turn_limit=${opts.maxTurns}`);

  argv.push('-');
  return argv;
}
