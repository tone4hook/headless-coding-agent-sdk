import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DENY_KEYS,
  DEFAULT_DENY_PREFIXES,
  sanitizeEnv,
} from '../src/transport/env.js';
import { composeEnv } from '../src/transport/spawn.js';

describe('sanitizeEnv', () => {
  it('strips default-deny keys', () => {
    const out = sanitizeEnv({
      NODE_OPTIONS: '--require ts-node/register',
      CLAUDECODE: '1',
      PATH: '/usr/bin',
    });
    expect(out.NODE_OPTIONS).toBeUndefined();
    expect(out.CLAUDECODE).toBeUndefined();
    expect(out.PATH).toBe('/usr/bin');
  });

  it('strips default-deny prefixes', () => {
    const out = sanitizeEnv({
      npm_config_prefix: 'x',
      PNPM_HOME: '/tmp',
      YARN_CACHE: '/tmp',
      HOME: '/Users/me',
    });
    expect(out.npm_config_prefix).toBeUndefined();
    expect(out.PNPM_HOME).toBeUndefined();
    expect(out.YARN_CACHE).toBeUndefined();
    expect(out.HOME).toBe('/Users/me');
  });

  it('preserves provider auth/proxy/CA vars', () => {
    const parent = {
      ANTHROPIC_API_KEY: 'a',
      GEMINI_API_KEY: 'g',
      OPENAI_API_KEY: 'o',
      GOOGLE_APPLICATION_CREDENTIALS: '/x',
      HTTPS_PROXY: 'http://proxy',
      NO_PROXY: 'localhost',
      SSL_CERT_FILE: '/etc/ssl',
      NODE_EXTRA_CA_CERTS: '/etc/ca',
      CLAUDE_CONFIG_DIR: '/cfg',
      XDG_CONFIG_HOME: '/x',
    };
    const out = sanitizeEnv(parent);
    expect(out).toEqual(parent);
  });

  it('honors additionalDeny', () => {
    const out = sanitizeEnv({ MY_SECRET: 's', PATH: '/usr/bin' }, {
      additionalDeny: ['MY_SECRET'],
    });
    expect(out.MY_SECRET).toBeUndefined();
    expect(out.PATH).toBe('/usr/bin');
  });

  it('exports usable defaults', () => {
    expect(DEFAULT_DENY_KEYS).toContain('NODE_OPTIONS');
    expect(DEFAULT_DENY_PREFIXES).toContain('npm_');
  });
});

describe('composeEnv with sanitation', () => {
  it('sanitizes by default', () => {
    const out = composeEnv(
      { NODE_OPTIONS: 'x', PATH: '/usr/bin' },
      { extraEnv: { FOO: 'bar' } },
    );
    expect(out.NODE_OPTIONS).toBeUndefined();
    expect(out.PATH).toBe('/usr/bin');
    expect(out.FOO).toBe('bar');
  });

  it('cleanEnv: false passes host env through', () => {
    const out = composeEnv(
      { NODE_OPTIONS: 'x', PATH: '/usr/bin' },
      { cleanEnv: false },
    );
    expect(out.NODE_OPTIONS).toBe('x');
  });

  it('extraEnv can re-add a sanitized key intentionally', () => {
    const out = composeEnv(
      { NODE_OPTIONS: 'host' },
      { extraEnv: { NODE_OPTIONS: '--max-old-space-size=4096' } },
    );
    expect(out.NODE_OPTIONS).toBe('--max-old-space-size=4096');
  });

  it('unsetEnv overrides extraEnv', () => {
    const out = composeEnv(
      { PATH: '/usr/bin' },
      { extraEnv: { FOO: 'bar' }, unsetEnv: ['FOO'] },
    );
    expect(out.FOO).toBeUndefined();
  });

  it('legacy 3-arg signature still works', () => {
    const out = composeEnv(
      { PATH: '/usr/bin' },
      { FOO: 'bar' },
      ['BAR'],
    );
    expect(out.FOO).toBe('bar');
    expect(out.BAR).toBeUndefined();
  });

  it('additionalDenyEnv removes named keys', () => {
    const out = composeEnv(
      { MY_SECRET: 'shh', PATH: '/usr/bin' },
      { additionalDenyEnv: ['MY_SECRET'] },
    );
    expect(out.MY_SECRET).toBeUndefined();
  });
});
