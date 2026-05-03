import { describe, expect, it } from 'vitest';
import { buildClaudeArgv } from '../src/adapters/claude/flags.js';
import { FeatureNotSupportedError } from '../src/errors.js';

describe('buildClaudeArgv', () => {
  it('starts every invocation with -p --output-format stream-json --verbose and leaves prompt for stdin', () => {
    const argv = buildClaudeArgv({ prompt: 'hi', opts: {} });
    expect(argv.slice(0, 4)).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
    ]);
    expect(argv).not.toContain('hi');
  });

  it('maps model / allowedTools / system prompts / budget', () => {
    const argv = buildClaudeArgv({
      prompt: 'hi',
      opts: {
        model: 'sonnet',
        allowedTools: ['Bash', 'Edit'],
        systemPrompt: 'you are X',
        appendSystemPrompt: 'also Y',
        maxBudgetUsd: 2.5,
      },
    });
    expect(argv).toContain('--model');
    expect(argv).toContain('sonnet');
    expect(argv).toContain('--allowed-tools');
    expect(argv).toContain('Bash');
    expect(argv).toContain('Edit');
    expect(argv).toContain('--system-prompt');
    expect(argv).toContain('you are X');
    expect(argv).toContain('--append-system-prompt');
    expect(argv).toContain('also Y');
    expect(argv).toContain('--max-budget-usd');
    expect(argv).toContain('2.5');
  });

  it('maps outputSchema to --json-schema <JSON string>', () => {
    const schema = {
      type: 'object' as const,
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
    };
    const argv = buildClaudeArgv({ prompt: 'hi', opts: { outputSchema: schema } });
    expect(argv).toContain('--json-schema');
    const schemaArgIdx = argv.indexOf('--json-schema') + 1;
    expect(JSON.parse(argv[schemaArgIdx]!)).toEqual(schema);
  });

  it('maps resumeId to --resume and forkSession to --fork-session', () => {
    const argv = buildClaudeArgv({
      prompt: 'hi',
      opts: { forkSession: true },
      resumeId: '6d30c353-d91a-4155-9311-ed6d695d5199',
    });
    expect(argv).toContain('--resume');
    expect(argv).toContain('6d30c353-d91a-4155-9311-ed6d695d5199');
    expect(argv).toContain('--fork-session');
  });

  it('maps continueLatest to --continue', () => {
    const argv = buildClaudeArgv({
      prompt: 'hi',
      opts: {},
      continueLatest: true,
    });
    expect(argv).toContain('--continue');
    expect(argv).not.toContain('--resume');
  });

  it('maps mcpConfigPath to --mcp-config and --strict-mcp-config', () => {
    const argv = buildClaudeArgv({
      prompt: 'hi',
      opts: {},
      mcpConfigPath: '/tmp/mcp.json',
    });
    expect(argv).toContain('--mcp-config');
    expect(argv).toContain('/tmp/mcp.json');
    expect(argv).toContain('--strict-mcp-config');
  });

  it('maps permissionPolicy bypass → --permission-mode bypassPermissions + allow/deny', () => {
    const argv = buildClaudeArgv({
      prompt: 'hi',
      opts: {
        permissionPolicy: {
          mode: 'bypass',
          allow: ['Bash'],
          deny: ['Edit'],
        },
      },
    });
    expect(argv).toContain('--permission-mode');
    expect(argv).toContain('bypassPermissions');
    expect(argv).toContain('--allowed-tools');
    expect(argv).toContain('Bash');
    expect(argv).toContain('--disallowed-tools');
    expect(argv).toContain('Edit');
  });

  it('throws FeatureNotSupportedError for Gemini-only fields', () => {
    for (const field of [
      'yolo',
      'sandbox',
      'approvalMode',
      'policyFiles',
      'adminPolicyFiles',
      'extensions',
      'includeDirectories',
      'allowedMcpServerNames',
    ] as const) {
      expect(() =>
        buildClaudeArgv({ prompt: 'hi', opts: { [field]: 'x' as never } }),
      ).toThrowError(FeatureNotSupportedError);
    }
  });

  it('maps streamPartialMessages to --include-partial-messages', () => {
    const argv = buildClaudeArgv({
      prompt: 'hi',
      opts: { streamPartialMessages: true },
    });
    expect(argv).toContain('--include-partial-messages');
  });

  it('maps maxTurns to --max-turns <n>', () => {
    const argv = buildClaudeArgv({ prompt: 'hi', opts: { maxTurns: 3 } });
    expect(argv).toContain('--max-turns');
    const idx = argv.indexOf('--max-turns');
    expect(argv[idx + 1]).toBe('3');
  });
});
