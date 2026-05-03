/**
 * Maps shared StartOpts + RunOpts to `claude` CLI argv.
 *
 * Verified against claude CLI 2.1.118 (`claude --help`). Gemini-only
 * fields throw FeatureNotSupportedError rather than silently dropping —
 * callers learn at call time which adapter they're actually on.
 */

import { FeatureNotSupportedError } from '../../errors.js';
import type { RunOpts, SharedStartOpts } from '../../types.js';
import {
  applyPermissionPolicy,
  type ProviderPolicyTranslation,
} from '../shared/policy.js';

const CLAUDE_POLICY_TABLE: ProviderPolicyTranslation = {
  modeFlag: '--permission-mode',
  modeValues: {
    'accept-edits': 'acceptEdits',
    plan: 'plan',
    bypass: 'bypassPermissions',
  },
  allowFlag: { name: '--allowed-tools', format: 'multi' },
  denyFlag: { name: '--disallowed-tools', format: 'multi' },
};

export interface BuildClaudeArgvInput {
  prompt: string;
  opts: SharedStartOpts & RunOpts;
  /** Resume an existing session by id. */
  resumeId?: string;
  /** Resume the most recent session for this cwd. */
  continueLatest?: boolean;
  /** Path to the ephemeral MCP config pointing at our bridge. */
  mcpConfigPath?: string;
}

const GEMINI_ONLY_FIELDS = [
  'yolo',
  'sandbox',
  'approvalMode',
  'policyFiles',
  'adminPolicyFiles',
  'extensions',
  'includeDirectories',
  'allowedMcpServerNames',
] as const;

export function buildClaudeArgv(input: BuildClaudeArgvInput): string[] {
  const { opts, prompt, resumeId, continueLatest, mcpConfigPath } = input;

  // Reject Gemini-only fields up front.
  for (const field of GEMINI_ONLY_FIELDS) {
    if ((opts as Record<string, unknown>)[field] !== undefined) {
      throw new FeatureNotSupportedError(
        'claude',
        field,
        `Field "${field}" is a Gemini-only option; use the gemini adapter or remove it.`,
      );
    }
  }

  const argv: string[] = [
    '-p',
    prompt,
    '--output-format',
    'stream-json',
    '--verbose',
  ];

  if (opts.model) argv.push('--model', opts.model);

  if (opts.allowedTools && opts.allowedTools.length > 0) {
    argv.push('--allowed-tools', ...opts.allowedTools);
  }

  if (opts.permissionMode) argv.push('--permission-mode', opts.permissionMode);

  // Shared permissionPolicy → claude native flags.
  if (opts.permissionPolicy) {
    applyPermissionPolicy(argv, opts.permissionPolicy, 'claude', CLAUDE_POLICY_TABLE);
  }

  if (opts.settingSources && opts.settingSources.length > 0) {
    argv.push('--setting-sources', opts.settingSources.join(','));
  }

  if (opts.addDirs) argv.push('--add-dir', ...opts.addDirs);

  if (opts.systemPrompt) argv.push('--system-prompt', opts.systemPrompt);
  if (opts.appendSystemPrompt)
    argv.push('--append-system-prompt', opts.appendSystemPrompt);

  if (opts.agents) argv.push('--agents', JSON.stringify(opts.agents));

  if (opts.maxBudgetUsd !== undefined)
    argv.push('--max-budget-usd', String(opts.maxBudgetUsd));

  if (opts.outputSchema) {
    argv.push('--json-schema', JSON.stringify(opts.outputSchema));
    // --json-schema + --output-format=stream-json coexist; claude emits a
    // structured `result.result` string conforming to the schema.
  }

  if (resumeId) {
    argv.push('--resume', resumeId);
    if (opts.forkSession) argv.push('--fork-session');
  } else if (continueLatest) {
    argv.push('--continue');
    if (opts.forkSession) argv.push('--fork-session');
  }

  if (mcpConfigPath) {
    argv.push('--mcp-config', mcpConfigPath, '--strict-mcp-config');
  }

  if (opts.streamPartialMessages) argv.push('--include-partial-messages');

  if (opts.maxTurns !== undefined) argv.push('--max-turns', String(opts.maxTurns));

  return argv;
}

