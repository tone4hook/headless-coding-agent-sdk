/**
 * Maps shared StartOpts + RunOpts to `pi` coding-agent argv.
 *
 * Verified against @earendil-works/pi-coding-agent 0.80.3 (`pi --help`).
 */

import { FeatureNotSupportedError } from '../../errors.js';
import type { ReasoningEffort, RunOpts, SharedStartOpts } from '../../types.js';

export interface BuildPiArgvInput {
  opts: SharedStartOpts & RunOpts;
  /** Resume an existing Pi session by id/path. */
  resumeId?: string;
  /** Resume the latest Pi session. */
  resumeLatest?: boolean;
}

const CLAUDE_ONLY_FIELDS = [
  'permissionMode',
  'settingSources',
  'isolation',
  'forkSession',
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

const COPILOT_ONLY_FIELDS = [
  'copilotMode',
  'copilotAgent',
  'copilotAllowUrls',
  'copilotDenyUrls',
  'copilotAvailableTools',
  'copilotExcludedTools',
  'copilotAdditionalMcpConfig',
] as const;

function mapThinking(effort: ReasoningEffort | undefined): string | undefined {
  if (!effort) return undefined;
  if (effort === 'none') return 'off';
  if (effort === 'max') {
    throw new FeatureNotSupportedError(
      'pi',
      'reasoningEffort',
      'Pi --thinking supports none/off, minimal, low, medium, high, and xhigh.',
    );
  }
  return effort;
}

function comma(values: readonly string[]): string {
  return values.join(',');
}

export function buildPiArgv(input: BuildPiArgvInput): string[] {
  const { opts, resumeId, resumeLatest } = input;

  for (const field of [
    ...CLAUDE_ONLY_FIELDS,
    ...CODEX_ONLY_FIELDS,
    ...COPILOT_ONLY_FIELDS,
  ]) {
    if ((opts as Record<string, unknown>)[field] !== undefined) {
      throw new FeatureNotSupportedError(
        'pi',
        field,
        `Field "${field}" is not supported by the pi adapter.`,
      );
    }
  }

  if (opts.tools && opts.tools.length > 0) {
    throw new FeatureNotSupportedError(
      'pi',
      'tools',
      'Pi does not expose a documented MCP/SDK bridge for custom in-process tools.',
    );
  }

  if (opts.outputSchema && opts.strictSchema) {
    throw new FeatureNotSupportedError(
      'pi',
      'outputSchema',
      'Pi has no native JSON schema flag. Set strictSchema:false for prompt-injected best-effort.',
    );
  }

  if (opts.maxTurns !== undefined) {
    throw new FeatureNotSupportedError(
      'pi',
      'maxTurns',
      'Pi does not expose a max-turns flag in --print JSON mode.',
    );
  }

  const argv = ['--mode', 'json', '--print'];

  if (opts.piProvider) argv.push('--provider', opts.piProvider);
  if (opts.model) argv.push('--model', opts.model);
  if (opts.piModels && opts.piModels.length > 0) {
    argv.push('--models', comma(opts.piModels));
  }
  if (opts.systemPrompt) argv.push('--system-prompt', opts.systemPrompt);
  if (opts.appendSystemPrompt) {
    argv.push('--append-system-prompt', opts.appendSystemPrompt);
  }

  const thinking = mapThinking(opts.reasoningEffort);
  if (thinking) argv.push('--thinking', thinking);

  if (resumeId) argv.push('--session', resumeId);
  else if (resumeLatest) argv.push('--continue');
  if (opts.piNoSession) argv.push('--no-session');
  if (opts.piSessionDir) argv.push('--session-dir', opts.piSessionDir);

  if (opts.permissionPolicy?.mode === 'plan') {
    argv.push('--tools', 'read,grep,find,ls');
  } else if (opts.allowedTools && opts.allowedTools.length > 0) {
    argv.push('--tools', comma(opts.allowedTools));
  } else if (opts.permissionPolicy?.allow?.length) {
    argv.push('--tools', comma(opts.permissionPolicy.allow));
  }

  if (opts.permissionPolicy?.deny?.length) {
    argv.push('--exclude-tools', comma(opts.permissionPolicy.deny));
  }

  if (opts.piNoContextFiles) argv.push('--no-context-files');
  if (opts.piNoExtensions) argv.push('--no-extensions');
  if (opts.piNoSkills) argv.push('--no-skills');
  if (opts.piNoPromptTemplates) argv.push('--no-prompt-templates');

  return argv;
}
