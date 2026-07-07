import { describe, expect, it } from 'vitest';
import { buildPiArgv } from '../src/adapters/pi/flags.js';
import { FeatureNotSupportedError } from '../src/errors.js';
import { piSpec } from '../src/adapters/pi/index.js';

describe('buildPiArgv', () => {
  it('uses documented JSON print mode with prompt over stdin', () => {
    const argv = buildPiArgv({ opts: {} });
    expect(argv.slice(0, 3)).toEqual(['--mode', 'json', '--print']);
    expect(argv).not.toContain('hi');
  });

  it('maps provider, model, models, system prompts, thinking, and session flags', () => {
    const argv = buildPiArgv({
      opts: {
        piProvider: 'openai',
        model: 'gpt-4o',
        piModels: ['sonnet:high', 'gpt-4o'],
        systemPrompt: 'you are X',
        appendSystemPrompt: 'also Y',
        reasoningEffort: 'minimal',
        piNoSession: true,
        piSessionDir: '/tmp/pi-sessions',
        piNoContextFiles: true,
        piNoExtensions: true,
        piNoSkills: true,
        piNoPromptTemplates: true,
      },
      resumeId: 'sess-1',
    });
    expect(argv).toContain('--provider');
    expect(argv).toContain('openai');
    expect(argv).toContain('--model');
    expect(argv).toContain('gpt-4o');
    expect(argv).toContain('--models');
    expect(argv).toContain('sonnet:high,gpt-4o');
    expect(argv).toContain('--system-prompt');
    expect(argv).toContain('you are X');
    expect(argv).toContain('--append-system-prompt');
    expect(argv).toContain('also Y');
    expect(argv).toContain('--thinking');
    expect(argv).toContain('minimal');
    expect(argv).toContain('--session');
    expect(argv).toContain('sess-1');
    expect(argv).toContain('--no-session');
    expect(argv).toContain('--session-dir');
    expect(argv).toContain('/tmp/pi-sessions');
    expect(argv).toContain('--no-context-files');
    expect(argv).toContain('--no-extensions');
    expect(argv).toContain('--no-skills');
    expect(argv).toContain('--no-prompt-templates');
  });

  it('maps plan policy to read-only built-in tools', () => {
    const argv = buildPiArgv({
      opts: { permissionPolicy: { mode: 'plan' } },
    });
    expect(argv).toEqual(expect.arrayContaining(['--tools', 'read,grep,find,ls']));
  });

  it('maps allow and deny tool lists to --tools / --exclude-tools', () => {
    const argv = buildPiArgv({
      opts: {
        allowedTools: ['read', 'grep'],
        permissionPolicy: { deny: ['bash'] },
      },
    });
    expect(argv).toEqual(expect.arrayContaining(['--tools', 'read,grep']));
    expect(argv).toEqual(expect.arrayContaining(['--exclude-tools', 'bash']));
  });

  it('maps reasoningEffort none to --thinking off and rejects max', () => {
    expect(buildPiArgv({ opts: { reasoningEffort: 'none' } })).toEqual(
      expect.arrayContaining(['--thinking', 'off']),
    );
    expect(() =>
      buildPiArgv({ opts: { reasoningEffort: 'max' } }),
    ).toThrow(FeatureNotSupportedError);
  });

  it('rejects strict schema, custom SDK tools, maxTurns, and other-adapter fields', () => {
    expect(() =>
      buildPiArgv({
        opts: { outputSchema: { type: 'object' }, strictSchema: true },
      }),
    ).toThrow(FeatureNotSupportedError);
    expect(() =>
      buildPiArgv({
        opts: {
          tools: [
            {
              name: 'add',
              description: 'add',
              inputSchema: { a: 'number' },
              handler: () => ({ content: [{ type: 'text', text: '1' }] }),
            },
          ],
        },
      }),
    ).toThrow(FeatureNotSupportedError);
    expect(() => buildPiArgv({ opts: { maxTurns: 1 } })).toThrow(
      FeatureNotSupportedError,
    );
    expect(() =>
      buildPiArgv({ opts: { copilotMode: 'plan' } }),
    ).toThrow(FeatureNotSupportedError);
  });

  it('defaults PI_OFFLINE=1 unless caller supplied PI_OFFLINE', async () => {
    const prepared = await piSpec.prepareRun!({
      prompt: 'hi',
      opts: {},
      resumeLatest: false,
    });
    expect(prepared.env).toEqual({ PI_OFFLINE: '1' });

    const callerEnv = await piSpec.prepareRun!({
      prompt: 'hi',
      opts: { extraEnv: { PI_OFFLINE: '0' } },
      resumeLatest: false,
    });
    expect(callerEnv.env).toBeUndefined();
  });
});
