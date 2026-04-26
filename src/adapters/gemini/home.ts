/**
 * Ephemeral GEMINI_CLI_HOME setup for the Gemini adapter.
 *
 * The Gemini CLI looks up its .gemini/ configuration directory via
 * `homedir()` which respects the `GEMINI_CLI_HOME` env var
 * (verified at gemini-cli bundle `chunk-ETUADTWF.js:41664`). We leverage
 * this to redirect the CLI's config lookup to an isolated temp dir
 * that:
 *  - carries a freshly-written `settings.json` with our MCP bridge URL
 *    merged into `mcpServers`
 *  - symlinks the user's real auth/state files from `~/.gemini/` so the
 *    CLI can still authenticate and see installed extensions
 *
 * No mutation of user files, concurrency-safe (each thread gets its own
 * ephemeral home), trivial teardown (rm the ephemeral dir — symlinks
 * don't cascade into the user's real dir).
 */

import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { GeminiBridgeNotLoadedError } from '../../errors.js';

/** Files/dirs under ~/.gemini that we symlink into the ephemeral home. */
const PASSTHROUGH_ENTRIES = [
  'oauth_creds.json',
  'google_accounts.json',
  'installation_id',
  'trustedFolders.json',
  'projects.json',
  'state.json',
  'extension_integrity.json',
  'extensions',
] as const;

export interface SetupEphemeralHomeInput {
  /** URL of the HTTP MCP bridge to register under `mcpServers`. */
  bridgeUrl: string;
  /** Name used as the mcpServers key (matches HttpMcpBridge.serverName). */
  mcpServerName: string;
  /** Override the real home root for tests. Defaults to os.homedir(). */
  realHome?: string;
}

export interface EphemeralHome {
  /** Absolute path to the ephemeral home root. */
  home: string;
  /** Env object to merge into the spawned child's env. */
  env: { GEMINI_CLI_HOME: string };
  /** Idempotent teardown. Refuses to rm anything outside os.tmpdir(). */
  cleanup(): Promise<void>;
}

export async function setupEphemeralGeminiHome(
  input: SetupEphemeralHomeInput,
): Promise<EphemeralHome> {
  const home = await mkdtemp(join(tmpdir(), 'hca-gemini-home-'));
  const geminiDir = join(home, '.gemini');
  await mkdir(geminiDir, { recursive: true });

  const realHome = input.realHome ?? homedir();
  const realGemini = join(realHome, '.gemini');

  // Merge user's existing settings.json with our mcpServers injection.
  const userSettings: Record<string, unknown> = readUserSettings(realGemini);
  const mergedMcp = {
    ...((userSettings.mcpServers as Record<string, unknown> | undefined) ?? {}),
    [input.mcpServerName]: {
      httpUrl: input.bridgeUrl,
      // The SDK owns this localhost bridge; mark it trusted so headless
      // tool calls don't stall on Gemini's per-call confirmation prompt.
      trust: true,
    },
  };
  const merged: Record<string, unknown> = { ...userSettings, mcpServers: mergedMcp };
  const settingsPath = join(geminiDir, 'settings.json');
  await writeFile(settingsPath, JSON.stringify(merged, null, 2), 'utf-8');

  // Defensive read-back: confirm our bridge entry survived the merge and the
  // file is parseable. Catches code-level regressions in the merge logic
  // before we hand off to gemini, where a missing bridge would silently
  // remove every SDK custom tool from the headless run.
  assertBridgeRegistered(settingsPath, input.mcpServerName, input.bridgeUrl);

  // Symlink pass-through entries from the real .gemini into the ephemeral one.
  for (const entry of PASSTHROUGH_ENTRIES) {
    const src = join(realGemini, entry);
    if (!existsSync(src)) continue;
    const dst = join(geminiDir, entry);
    try {
      await symlink(src, dst);
    } catch {
      /* ignore — symlink failures (e.g. EEXIST) leave auth gracefully
         degraded; gemini will prompt for auth or use env-based API keys. */
    }
  }

  return {
    home,
    env: { GEMINI_CLI_HOME: home },
    cleanup: async () => {
      const root = resolve(home);
      const tmpRoot = resolve(tmpdir());
      if (!root.startsWith(tmpRoot + '/') && !root.startsWith(tmpRoot + '\\')) {
        throw new Error(
          `setupEphemeralGeminiHome: refusing to rm path outside tmpdir: ${root}`,
        );
      }
      await rm(root, { recursive: true, force: true });
    },
  };
}

/**
 * Verifies that a `settings.json` at `settingsPath` registers an MCP server
 * named `mcpServerName` with `httpUrl === bridgeUrl`. Throws
 * `GeminiBridgeNotLoadedError` otherwise. Exported for direct unit testing
 * of the defensive smoke-check path against synthetic settings files.
 */
export function assertBridgeRegistered(
  settingsPath: string,
  mcpServerName: string,
  bridgeUrl: string,
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(settingsPath, 'utf-8'));
  } catch (err) {
    throw new GeminiBridgeNotLoadedError(
      mcpServerName,
      `ephemeral settings.json failed to parse (${(err as Error).message})`,
    );
  }
  const servers =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? ((parsed as Record<string, unknown>).mcpServers as
          | Record<string, unknown>
          | undefined)
      : undefined;
  const entry = servers?.[mcpServerName] as Record<string, unknown> | undefined;
  if (!entry || entry.httpUrl !== bridgeUrl) {
    throw new GeminiBridgeNotLoadedError(
      mcpServerName,
      'bridge entry missing from merged settings.json',
    );
  }
}

function readUserSettings(realGeminiDir: string): Record<string, unknown> {
  const path = join(realGeminiDir, 'settings.json');
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* missing or unreadable — return an empty object */
  }
  return {};
}
