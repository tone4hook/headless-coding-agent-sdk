import { describe, expect, it } from 'vitest';
import { buildCodexArgv } from '../src/adapters/codex/flags.js';
import { FeatureNotSupportedError } from '../src/errors.js';

describe('buildCodexArgv', () => {
  it('uses codex exec json mode and reads the prompt from stdin', () => {
    const argv = buildCodexArgv({ opts: {} });
    expect(argv.slice(0, 4)).toEqual([
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--full-auto',
    ]);
    expect(argv.at(-1)).toBe('-');
  });

  it('maps model, cwd, add dirs, reasoning, network, plugin, and schema knobs', () => {
    const argv = buildCodexArgv({
      opts: {
        model: 'gpt-5.3-codex',
        workingDirectory: '/repo',
        addDirs: ['/tmp/sidecar'],
        codexReasoningEffort: 'high',
        codexNetworkAccess: true,
        codexDisablePlugins: true,
        codexSearch: true,
      },
      outputSchemaPath: '/tmp/schema.json',
    });
    expect(argv).toContain('--model');
    expect(argv).toContain('gpt-5.3-codex');
    expect(argv).toContain('-C');
    expect(argv).toContain('/repo');
    expect(argv).toContain('--add-dir');
    expect(argv).toContain('/tmp/sidecar');
    expect(argv).toContain('model_reasoning_effort="high"');
    expect(argv).toContain('sandbox_workspace_write.network_access=true');
    expect(argv).toContain('--disable');
    expect(argv).toContain('plugins');
    expect(argv).toContain('--search');
    expect(argv).toContain('--output-schema');
    expect(argv).toContain('/tmp/schema.json');
  });

  it('rejects unsupported deny behaviour', () => {
    expect(() =>
      buildCodexArgv({
        opts: { permissionPolicy: { deny: ['Bash'] } },
      }),
    ).toThrow(FeatureNotSupportedError);
  });
});
