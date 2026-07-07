/**
 * Maps shared StartOpts + RunOpts to `copilot` CLI argv.
 *
 * Verified against GitHub Copilot CLI 1.0.68 (`copilot --help`).
 */

import { FeatureNotSupportedError } from '../../errors.js';
import type { RunOpts, SharedStartOpts } from '../../types.js';

export interface BuildCopilotArgvInput {
  prompt: string;
  opts: SharedStartOpts & RunOpts;
  /** Resume an existing Copilot session by id. */
  resumeId?: string;
  /** Resume the latest Copilot session for this cwd. */
  resumeLatest?: boolean;
}

const CLAUDE_ONLY_FIELDS = [
  'permissionMode',
  'settingSources',
  'isolation',
  'forkSession',
  'systemPrompt',
  'appendSystemPrompt',
  'agents',
  'maxBudgetUsd',
  'claudeBare',
  'claudeNoSessionPersistence',
] as const;

const CODEX_ONLY_FIELDS = [
  'codexReasoningEffort',
  'codexDisablePlugins',
  'codexSandbox',
  'codexNetworkAccess',
  'codexSearch',
  'codexEphemeral',
  'codexIgnoreUserConfig',
  'codexIgnoreRules',
  'codexDangerouslyBypassApprovalsAndSandbox',
] as const;

const PI_ONLY_FIELDS = [
  'piProvider',
  'piModels',
  'piNoSession',
  'piSessionDir',
  'piNoContextFiles',
  'piNoExtensions',
  'piNoSkills',
  'piNoPromptTemplates',
] as const;

function pushEach(argv: string[], flag: string, values: readonly string[] | undefined): void {
  if (!values || values.length === 0) return;
  for (const value of values) argv.push(flag, value);
}

function pushJoined(argv: string[], flag: string, values: readonly string[] | undefined): void {
  if (!values || values.length === 0) return;
  argv.push(flag, values.join(','));
}

export function buildCopilotArgv(input: BuildCopilotArgvInput): string[] {
  const { prompt, opts, resumeId, resumeLatest } = input;

  for (const field of [
    ...CLAUDE_ONLY_FIELDS,
    ...CODEX_ONLY_FIELDS,
    ...PI_ONLY_FIELDS,
  ]) {
    if ((opts as Record<string, unknown>)[field] !== undefined) {
      throw new FeatureNotSupportedError(
        'copilot',
        field,
        `Field "${field}" is not supported by the copilot adapter.`,
      );
    }
  }

  if (opts.outputSchema && opts.strictSchema) {
    throw new FeatureNotSupportedError(
      'copilot',
      'outputSchema',
      'Copilot CLI has no native JSON schema flag. Set strictSchema:false for prompt-injected best-effort.',
    );
  }

  if (opts.maxTurns !== undefined) {
    throw new FeatureNotSupportedError(
      'copilot',
      'maxTurns',
      'Copilot CLI does not expose a generic max-turns flag in prompt mode.',
    );
  }

  if (opts.reasoningEffort === 'minimal') {
    throw new FeatureNotSupportedError(
      'copilot',
      'reasoningEffort',
      'Copilot CLI --effort supports none, low, medium, high, xhigh, and max.',
    );
  }

  const argv = [
    '-p',
    prompt,
    '--output-format',
    'json',
    '--no-ask-user',
    '--no-auto-update',
  ];

  if (opts.model) argv.push('--model', opts.model);
  if (opts.workingDirectory) argv.push('-C', opts.workingDirectory);
  pushEach(argv, '--add-dir', opts.addDirs);

  if (opts.reasoningEffort) argv.push('--effort', opts.reasoningEffort);
  if (opts.copilotAgent) argv.push('--agent', opts.copilotAgent);

  if (opts.copilotMode) {
    argv.push('--mode', opts.copilotMode);
  } else if (opts.permissionPolicy?.mode === 'plan') {
    argv.push('--mode', 'plan');
  }

  if (opts.permissionPolicy?.mode === 'bypass') {
    argv.push('--allow-all');
  } else if (opts.permissionPolicy?.mode === 'accept-edits') {
    argv.push('--allow-tool', 'write');
  }

  pushEach(argv, '--allow-tool', opts.allowedTools);
  pushEach(argv, '--allow-tool', opts.permissionPolicy?.allow);
  pushEach(argv, '--deny-tool', opts.permissionPolicy?.deny);

  pushEach(argv, '--allow-url', opts.copilotAllowUrls);
  pushEach(argv, '--deny-url', opts.copilotDenyUrls);
  pushJoined(argv, '--available-tools', opts.copilotAvailableTools);
  pushJoined(argv, '--excluded-tools', opts.copilotExcludedTools);
  pushEach(argv, '--additional-mcp-config', opts.copilotAdditionalMcpConfig);

  if (resumeId) argv.push(`--resume=${resumeId}`);
  else if (resumeLatest) argv.push('--continue');

  return argv;
}
