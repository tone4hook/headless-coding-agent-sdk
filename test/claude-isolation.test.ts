import { describe, expect, it } from 'vitest';
import { buildClaudeArgv } from '../src/adapters/claude/flags.js';

describe('buildClaudeArgv with isolation preset', () => {
  it("isolation: 'strict' adds --setting-sources= (empty)", () => {
    const argv = buildClaudeArgv({
      prompt: 'hi',
      opts: { isolation: 'strict' },
    });
    const idx = argv.indexOf('--setting-sources');
    expect(idx).toBeGreaterThan(-1);
    expect(argv[idx + 1]).toBe('');
  });

  it("isolation: 'project' uses local,project", () => {
    const argv = buildClaudeArgv({
      prompt: 'hi',
      opts: { isolation: 'project' },
    });
    const idx = argv.indexOf('--setting-sources');
    expect(argv[idx + 1]).toBe('local,project');
  });

  it("isolation: 'user' relies on CLI default (no --setting-sources)", () => {
    const argv = buildClaudeArgv({ prompt: 'hi', opts: { isolation: 'user' } });
    expect(argv).not.toContain('--setting-sources');
  });

  it('explicit settingSources overrides isolation preset', () => {
    const argv = buildClaudeArgv({
      prompt: 'hi',
      opts: { isolation: 'strict', settingSources: ['project'] },
    });
    const idx = argv.indexOf('--setting-sources');
    expect(argv[idx + 1]).toBe('project');
  });
});
