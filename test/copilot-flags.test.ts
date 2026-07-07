import { describe, expect, it } from 'vitest';
import { buildCopilotArgv } from '../src/adapters/copilot/flags.js';
import { FeatureNotSupportedError } from '../src/errors.js';

describe('buildCopilotArgv', () => {
  it('uses documented non-interactive JSON mode', () => {
    const argv = buildCopilotArgv({ prompt: 'hi', opts: {} });
    expect(argv.slice(0, 6)).toEqual([
      '-p',
      'hi',
      '--output-format',
      'json',
      '--no-ask-user',
      '--no-auto-update',
    ]);
  });

  it('maps model, cwd, add dirs, reasoning, mode, agent, and permissions', () => {
    const argv = buildCopilotArgv({
      prompt: 'hi',
      opts: {
        model: 'gpt-5.4',
        workingDirectory: '/repo',
        addDirs: ['/tmp/sidecar'],
        reasoningEffort: 'max',
        copilotMode: 'autopilot',
        copilotAgent: 'reviewer',
        allowedTools: ['shell(git:*)'],
        permissionPolicy: {
          mode: 'bypass',
          allow: ['write'],
          deny: ['shell(git push)'],
        },
        copilotAllowUrls: ['github.com'],
        copilotDenyUrls: ['example.com'],
        copilotAvailableTools: ['shell', 'write'],
        copilotExcludedTools: ['ask_user'],
        copilotAdditionalMcpConfig: ['@/tmp/mcp.json'],
      },
    });
    expect(argv).toContain('--model');
    expect(argv).toContain('gpt-5.4');
    expect(argv).toContain('-C');
    expect(argv).toContain('/repo');
    expect(argv).toContain('--add-dir');
    expect(argv).toContain('/tmp/sidecar');
    expect(argv).toContain('--effort');
    expect(argv).toContain('max');
    expect(argv).toContain('--mode');
    expect(argv).toContain('autopilot');
    expect(argv).toContain('--agent');
    expect(argv).toContain('reviewer');
    expect(argv).toContain('--allow-all');
    expect(argv).toContain('--allow-tool');
    expect(argv).toContain('shell(git:*)');
    expect(argv).toContain('write');
    expect(argv).toContain('--deny-tool');
    expect(argv).toContain('shell(git push)');
    expect(argv).toContain('--allow-url');
    expect(argv).toContain('github.com');
    expect(argv).toContain('--deny-url');
    expect(argv).toContain('example.com');
    expect(argv).toContain('--available-tools');
    expect(argv).toContain('shell,write');
    expect(argv).toContain('--excluded-tools');
    expect(argv).toContain('ask_user');
    expect(argv).toContain('--additional-mcp-config');
    expect(argv).toContain('@/tmp/mcp.json');
  });

  it('maps plan policy and resume flags', () => {
    expect(
      buildCopilotArgv({
        prompt: 'hi',
        opts: { permissionPolicy: { mode: 'plan' } },
      }),
    ).toEqual(expect.arrayContaining(['--mode', 'plan']));
    expect(
      buildCopilotArgv({ prompt: 'hi', opts: {}, resumeId: 'sess-1' }),
    ).toContain('--resume=sess-1');
    expect(
      buildCopilotArgv({ prompt: 'hi', opts: {}, resumeLatest: true }),
    ).toContain('--continue');
  });

  it('rejects strict schema, maxTurns, minimal reasoning, and other-adapter fields', () => {
    expect(() =>
      buildCopilotArgv({
        prompt: 'hi',
        opts: { outputSchema: { type: 'object' }, strictSchema: true },
      }),
    ).toThrow(FeatureNotSupportedError);
    expect(() =>
      buildCopilotArgv({ prompt: 'hi', opts: { maxTurns: 2 } }),
    ).toThrow(FeatureNotSupportedError);
    expect(() =>
      buildCopilotArgv({ prompt: 'hi', opts: { reasoningEffort: 'minimal' } }),
    ).toThrow(FeatureNotSupportedError);
    expect(() =>
      buildCopilotArgv({ prompt: 'hi', opts: { piProvider: 'openai' } }),
    ).toThrow(FeatureNotSupportedError);
  });
});
