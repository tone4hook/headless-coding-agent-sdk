/**
 * Claude adapter — subprocess-based coder for the `claude` CLI.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { FeatureNotSupportedError } from '../../errors.js';
import type {
  HeadlessCoder,
  SharedStartOpts,
  ThreadHandle,
} from '../../types.js';
import type { HttpMcpBridge } from '../../tools/bridge.js';
import {
  GenericThread,
  createCoderFromSpec,
} from '../shared/thread.js';
import type { AdapterSpec, McpHandshake, PreparedRun } from '../shared/spec.js';
import { buildClaudeArgv } from './flags.js';
import { translateClaudeLine } from './translate.js';

/**
 * Prepare per-run state for the Claude adapter. When `isolation: 'strict'`
 * is set we mint a fresh `CLAUDE_CONFIG_DIR` (passed via `extraEnv` for
 * this spawn only — never written to `process.env`), and supply an empty
 * MCP config + `--strict-mcp-config` so user-level MCP servers don't load.
 */
async function prepareClaudeRun(ctx: {
  prompt: string;
  opts: SharedStartOpts & Record<string, unknown>;
  resumeId?: string;
  resumeLatest: boolean;
}): Promise<PreparedRun> {
  const baseArgv = buildClaudeArgv({
    prompt: ctx.prompt,
    opts: ctx.opts,
    resumeId: ctx.resumeId,
    continueLatest: ctx.resumeLatest,
  });

  if (ctx.opts.isolation !== 'strict') {
    return { argv: baseArgv, stdin: ctx.prompt };
  }

  const isoDir = await mkdtemp(join(tmpdir(), 'hca-claude-iso-'));
  const mcpPath = join(isoDir, 'mcp.json');
  await writeFile(mcpPath, JSON.stringify({ mcpServers: {} }));

  const argv = [...baseArgv, '--mcp-config', mcpPath, '--strict-mcp-config'];
  const env: Record<string, string> = { CLAUDE_CONFIG_DIR: isoDir };

  return {
    argv,
    stdin: ctx.prompt,
    env,
    cleanup: async () => {
      const tmpRoot = resolve(tmpdir());
      const resolved = resolve(isoDir);
      if (
        resolved.startsWith(tmpRoot + '/') ||
        resolved.startsWith(tmpRoot + '\\')
      ) {
        await rm(resolved, { recursive: true, force: true }).catch(
          () => undefined,
        );
      }
    },
  };
}

async function registerClaudeMcp(bridge: HttpMcpBridge): Promise<McpHandshake> {
  const dir = await mkdtemp(join(tmpdir(), 'hca-claude-mcp-'));
  const path = join(dir, 'mcp.json');
  await writeFile(
    path,
    JSON.stringify({
      mcpServers: {
        [bridge.serverName]: { type: 'http', url: bridge.url },
      },
    }),
  );
  return {
    argv: ['--mcp-config', path, '--strict-mcp-config'],
    cleanup: async () => {
      const tmpRoot = resolve(tmpdir());
      const resolvedDir = resolve(dirname(path));
      if (
        resolvedDir.startsWith(tmpRoot + '/') ||
        resolvedDir.startsWith(tmpRoot + '\\')
      ) {
        await rm(resolvedDir, { recursive: true, force: true }).catch(
          () => undefined,
        );
      }
    },
  };
}

export const claudeSpec: AdapterSpec<'claude'> = {
  provider: 'claude',
  bin: 'claude',
  promptTransport: 'stdin',
  buildArgv: (ctx) =>
    buildClaudeArgv({
      prompt: ctx.prompt,
      opts: ctx.opts,
      resumeId: ctx.resumeId,
      continueLatest: ctx.resumeLatest,
    }),
  prepareRun: (ctx) =>
    prepareClaudeRun({
      prompt: ctx.prompt,
      opts: ctx.opts as SharedStartOpts & Record<string, unknown>,
      resumeId: ctx.resumeId,
      resumeLatest: ctx.resumeLatest,
    }),
  translateLine: translateClaudeLine,
  registerMcp: registerClaudeMcp,
  shouldAccumulateText: (ev) =>
    // Skip delta:true chunks — the final aggregated message is emitted
    // separately at message_stop and already contains the full text.
    ev.type === 'message' && ev.role === 'assistant' && !ev.delta,
  fork: async (thread) => {
    const t = thread as GenericThread<'claude'>;
    if (!t.id) {
      throw new FeatureNotSupportedError(
        'claude',
        'fork',
        'fork() requires a thread with an established id. Run at least once first.',
      );
    }
    return new GenericThread<'claude'>(
      claudeSpec,
      { ...t.opts, forkSession: true },
      { id: t.id },
    );
  },
};

export function createClaudeCoder(
  defaults?: SharedStartOpts,
): HeadlessCoder<'claude'> {
  return createCoderFromSpec(claudeSpec, defaults);
}

export type { ThreadHandle };
