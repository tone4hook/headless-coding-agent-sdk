import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupEphemeralGeminiHome } from '../src/adapters/gemini/home.js';

describe('setupEphemeralGeminiHome', () => {
  let fakeHome: string;

  beforeEach(async () => {
    fakeHome = await mkdtemp(join(tmpdir(), 'hca-fake-home-'));
    const geminiDir = join(fakeHome, '.gemini');
    await mkdir(geminiDir, { recursive: true });
    // Seed a few auth/state files so we can verify symlinks resolve.
    await writeFile(join(geminiDir, 'oauth_creds.json'), '{"fake":"creds"}', 'utf-8');
    await writeFile(join(geminiDir, 'installation_id'), 'fake-id', 'utf-8');
    await mkdir(join(geminiDir, 'extensions'), { recursive: true });
    await writeFile(
      join(geminiDir, 'extensions', 'README'),
      'inside extensions',
      'utf-8',
    );
    // User settings with a pre-existing mcpServers entry we should preserve.
    await writeFile(
      join(geminiDir, 'settings.json'),
      JSON.stringify({
        theme: 'Default',
        mcpServers: { keepMe: { httpUrl: 'http://keep/' } },
      }),
      'utf-8',
    );
  });

  afterEach(async () => {
    await rm(fakeHome, { recursive: true, force: true });
  });

  it('creates an ephemeral home under os.tmpdir() with GEMINI_CLI_HOME set', async () => {
    const eph = await setupEphemeralGeminiHome({
      bridgeUrl: 'http://127.0.0.1:9999/mcp',
      mcpServerName: 'sdk_bridge_test',
      realHome: fakeHome,
    });
    try {
      expect(eph.home.startsWith(tmpdir())).toBe(true);
      expect(eph.env.GEMINI_CLI_HOME).toBe(eph.home);
      expect(existsSync(join(eph.home, '.gemini', 'settings.json'))).toBe(true);
    } finally {
      await eph.cleanup();
    }
  });

  it('merges user mcpServers with our bridge entry, preserving other keys', async () => {
    const eph = await setupEphemeralGeminiHome({
      bridgeUrl: 'http://127.0.0.1:9999/mcp',
      mcpServerName: 'sdk_bridge_test',
      realHome: fakeHome,
    });
    try {
      const merged = JSON.parse(
        readFileSync(join(eph.home, '.gemini', 'settings.json'), 'utf-8'),
      );
      expect(merged.theme).toBe('Default');
      expect(merged.mcpServers.keepMe).toEqual({ httpUrl: 'http://keep/' });
      expect(merged.mcpServers.sdk_bridge_test).toEqual({
        httpUrl: 'http://127.0.0.1:9999/mcp',
      });
    } finally {
      await eph.cleanup();
    }
  });

  it('symlinks oauth_creds.json / installation_id / extensions from real home', async () => {
    const eph = await setupEphemeralGeminiHome({
      bridgeUrl: 'http://127.0.0.1:9999/mcp',
      mcpServerName: 'sdk_bridge_test',
      realHome: fakeHome,
    });
    try {
      expect(
        realpathSync(join(eph.home, '.gemini', 'oauth_creds.json')),
      ).toBe(realpathSync(join(fakeHome, '.gemini', 'oauth_creds.json')));
      expect(
        readFileSync(join(eph.home, '.gemini', 'oauth_creds.json'), 'utf-8'),
      ).toBe('{"fake":"creds"}');
      expect(
        readFileSync(
          join(eph.home, '.gemini', 'extensions', 'README'),
          'utf-8',
        ),
      ).toBe('inside extensions');
    } finally {
      await eph.cleanup();
    }
  });

  it('skips entries that do not exist in the real home', async () => {
    // state.json / projects.json / trustedFolders.json are missing on fakeHome.
    const eph = await setupEphemeralGeminiHome({
      bridgeUrl: 'http://127.0.0.1:9999/mcp',
      mcpServerName: 'sdk_bridge_test',
      realHome: fakeHome,
    });
    try {
      expect(existsSync(join(eph.home, '.gemini', 'state.json'))).toBe(false);
      expect(existsSync(join(eph.home, '.gemini', 'trustedFolders.json'))).toBe(false);
    } finally {
      await eph.cleanup();
    }
  });

  it('cleanup() removes the ephemeral dir and does not touch the real home', async () => {
    const eph = await setupEphemeralGeminiHome({
      bridgeUrl: 'http://127.0.0.1:9999/mcp',
      mcpServerName: 'sdk_bridge_test',
      realHome: fakeHome,
    });
    const ephDir = eph.home;
    await eph.cleanup();
    expect(existsSync(ephDir)).toBe(false);
    // Real home untouched
    expect(readFileSync(join(fakeHome, '.gemini', 'oauth_creds.json'), 'utf-8')).toBe(
      '{"fake":"creds"}',
    );
    expect(readFileSync(join(fakeHome, '.gemini', 'settings.json'), 'utf-8')).toContain(
      'keepMe',
    );
  });

  it('cleanup() refuses to rm paths outside os.tmpdir()', async () => {
    const eph = await setupEphemeralGeminiHome({
      bridgeUrl: 'http://127.0.0.1:9999/mcp',
      mcpServerName: 'sdk_bridge_test',
      realHome: fakeHome,
    });
    // Sabotage: rewrite the home path to something outside tmpdir.
    const sabotaged: typeof eph = { ...eph, home: '/etc' };
    Object.defineProperty(sabotaged, 'cleanup', {
      value: async () => {
        const root = '/etc';
        if (!root.startsWith(tmpdir() + '/')) {
          throw new Error('refuse');
        }
      },
    });
    await expect(sabotaged.cleanup()).rejects.toThrow(/refuse/);
    // Still clean up the real one.
    await eph.cleanup();
  });

  it('works with a missing real home (no auth passthrough)', async () => {
    const nonexistentHome = join(tmpdir(), 'hca-does-not-exist-' + Date.now());
    const eph = await setupEphemeralGeminiHome({
      bridgeUrl: 'http://127.0.0.1:9999/mcp',
      mcpServerName: 'sdk_bridge_test',
      realHome: nonexistentHome,
    });
    try {
      const merged = JSON.parse(
        readFileSync(join(eph.home, '.gemini', 'settings.json'), 'utf-8'),
      );
      expect(merged.mcpServers.sdk_bridge_test.httpUrl).toBe(
        'http://127.0.0.1:9999/mcp',
      );
      // No symlinks were created for missing entries.
      expect(existsSync(join(eph.home, '.gemini', 'oauth_creds.json'))).toBe(false);
    } finally {
      await eph.cleanup();
    }
  });
});
