import { describe, expect, it } from 'vitest';
import { buildGeminiArgv } from '../src/adapters/gemini/flags.js';
import { FeatureNotSupportedError } from '../src/errors.js';

describe('buildGeminiArgv', () => {
  it('starts every invocation with an empty -p marker and leaves prompt for stdin', () => {
    const argv = buildGeminiArgv({ prompt: 'hi', opts: {} });
    expect(argv.slice(0, 4)).toEqual(['-p', '', '--output-format', 'stream-json']);
    expect(argv).not.toContain('hi');
  });

  it('maps model and sandbox; approvalMode flows through when yolo is unset', () => {
    const argv = buildGeminiArgv({
      prompt: 'hi',
      opts: {
        model: 'gemini-flash',
        sandbox: true,
        approvalMode: 'auto_edit',
      },
    });
    expect(argv).toContain('-m');
    expect(argv).toContain('gemini-flash');
    expect(argv).toContain('-s');
    expect(argv).toContain('--approval-mode');
    expect(argv).toContain('auto_edit');
    expect(argv).not.toContain('-y');
  });

  it('normalizes yolo:true to --approval-mode yolo (no -y)', () => {
    const argv = buildGeminiArgv({ prompt: 'hi', opts: { yolo: true } });
    expect(argv).not.toContain('-y');
    const idx = argv.indexOf('--approval-mode');
    expect(idx).toBeGreaterThan(-1);
    expect(argv[idx + 1]).toBe('yolo');
    // Single --approval-mode entry only.
    expect(argv.filter((a) => a === '--approval-mode')).toHaveLength(1);
  });

  it('coalesces yolo:true + approvalMode:"yolo" to a single --approval-mode yolo', () => {
    const argv = buildGeminiArgv({
      prompt: 'hi',
      opts: { yolo: true, approvalMode: 'yolo' },
    });
    expect(argv.filter((a) => a === '--approval-mode')).toHaveLength(1);
    expect(argv.filter((a) => a === 'yolo')).toHaveLength(1);
    expect(argv).not.toContain('-y');
  });

  it('coalesces yolo:true + permissionPolicy.mode:"bypass" without throwing', () => {
    const argv = buildGeminiArgv({
      prompt: 'hi',
      opts: { yolo: true, permissionPolicy: { mode: 'bypass' } },
    });
    expect(argv.filter((a) => a === '--approval-mode')).toHaveLength(1);
    const idx = argv.indexOf('--approval-mode');
    expect(argv[idx + 1]).toBe('yolo');
    expect(argv).not.toContain('-y');
  });

  it('throws when yolo:true is combined with a non-yolo approvalMode', () => {
    expect(() =>
      buildGeminiArgv({
        prompt: 'hi',
        opts: { yolo: true, approvalMode: 'auto_edit' },
      }),
    ).toThrowError(FeatureNotSupportedError);
  });

  it('throws when yolo:true is combined with a non-yolo permissionPolicy mode', () => {
    expect(() =>
      buildGeminiArgv({
        prompt: 'hi',
        opts: { yolo: true, permissionPolicy: { mode: 'plan' } },
      }),
    ).toThrowError(FeatureNotSupportedError);
  });

  it('repeats --policy for each policy file', () => {
    const argv = buildGeminiArgv({
      prompt: 'hi',
      opts: { policyFiles: ['/etc/a.yaml', '/etc/b.yaml'] },
    });
    const idxs = argv
      .map((v, i) => (v === '--policy' ? i : -1))
      .filter((i) => i >= 0);
    expect(idxs).toHaveLength(2);
    expect(argv[idxs[0]! + 1]).toBe('/etc/a.yaml');
    expect(argv[idxs[1]! + 1]).toBe('/etc/b.yaml');
  });

  it('joins allowedTools / extensions / includeDirectories / allowedMcpServerNames with commas', () => {
    const argv = buildGeminiArgv({
      prompt: 'hi',
      opts: {
        allowedTools: ['Bash', 'Read'],
        extensions: ['a', 'b'],
        includeDirectories: ['/x', '/y'],
        allowedMcpServerNames: ['s1', 's2'],
      },
    });
    expect(argv).toContain('Bash,Read');
    expect(argv).toContain('a,b');
    expect(argv).toContain('/x,/y');
    expect(argv).toContain('s1,s2');
  });

  it('maps resumeId to --resume <uuid>', () => {
    const argv = buildGeminiArgv({
      prompt: 'hi',
      opts: {},
      resumeId: '6d30c353-d91a-4155-9311-ed6d695d5199',
    });
    expect(argv).toContain('--resume');
    expect(argv).toContain('6d30c353-d91a-4155-9311-ed6d695d5199');
  });

  it('maps resumeLatest to --resume latest', () => {
    const argv = buildGeminiArgv({
      prompt: 'hi',
      opts: {},
      resumeLatest: true,
    });
    const idx = argv.indexOf('--resume');
    expect(idx).toBeGreaterThan(-1);
    expect(argv[idx + 1]).toBe('latest');
  });

  it('maps permissionPolicy.mode=bypass to --approval-mode yolo', () => {
    const argv = buildGeminiArgv({
      prompt: 'hi',
      opts: { permissionPolicy: { mode: 'bypass' } },
    });
    const idx = argv.indexOf('--approval-mode');
    expect(argv[idx + 1]).toBe('yolo');
  });

  it('maps permissionPolicy.mode=accept-edits to --approval-mode auto_edit', () => {
    const argv = buildGeminiArgv({
      prompt: 'hi',
      opts: { permissionPolicy: { mode: 'accept-edits' } },
    });
    const idx = argv.indexOf('--approval-mode');
    expect(argv[idx + 1]).toBe('auto_edit');
  });

  it('maps permissionPolicy.allow to --allowed-tools as CSV', () => {
    const argv = buildGeminiArgv({
      prompt: 'hi',
      opts: { permissionPolicy: { allow: ['Bash', 'Edit'] } },
    });
    const idx = argv.indexOf('--allowed-tools');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(argv[idx + 1]).toBe('Bash,Edit');
  });

  it('throws FeatureNotSupportedError for permissionPolicy.deny', () => {
    expect(() =>
      buildGeminiArgv({
        prompt: 'hi',
        opts: { permissionPolicy: { deny: ['Bash(rm:*)'] } },
      }),
    ).toThrow(FeatureNotSupportedError);
  });

  it('does not throw for permissionPolicy.deny when the list is empty', () => {
    expect(() =>
      buildGeminiArgv({
        prompt: 'hi',
        opts: { permissionPolicy: { mode: 'plan', deny: [] } },
      }),
    ).not.toThrow();
  });

  it('throws FeatureNotSupportedError for Claude-only fields', () => {
    for (const field of [
      'permissionMode',
      'settingSources',
      'addDirs',
      'forkSession',
      'systemPrompt',
      'appendSystemPrompt',
      'agents',
      'maxBudgetUsd',
    ] as const) {
      expect(() =>
        buildGeminiArgv({ prompt: 'hi', opts: { [field]: 'x' as never } }),
      ).toThrowError(FeatureNotSupportedError);
    }
  });

  it('accepts outputSchema without strictSchema (best-effort handled later)', () => {
    expect(() =>
      buildGeminiArgv({
        prompt: 'hi',
        opts: {
          outputSchema: {
            type: 'object',
            properties: { answer: { type: 'string' } },
          },
        },
      }),
    ).not.toThrow();
  });

  it('throws FeatureNotSupportedError for outputSchema with strictSchema:true', () => {
    expect(() =>
      buildGeminiArgv({
        prompt: 'hi',
        opts: {
          outputSchema: { type: 'object' },
          strictSchema: true,
        },
      }),
    ).toThrowError(FeatureNotSupportedError);
  });
});
