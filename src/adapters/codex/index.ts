/**
 * Codex adapter — subprocess-based coder for `codex exec`.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { HeadlessCoder, SharedStartOpts } from '../../types.js';
import type { HttpMcpBridge } from '../../tools/bridge.js';
import { createCoderFromSpec } from '../shared/thread.js';
import type {
  AdapterSpec,
  BuildArgvCtx,
  McpHandshake,
  PreparedRun,
} from '../shared/spec.js';
import { buildCodexArgv } from './flags.js';
import { translateCodexLine } from './translate.js';

async function prepareCodexRun(ctx: BuildArgvCtx): Promise<PreparedRun> {
  let dir: string | undefined;
  let outputSchemaPath: string | undefined;

  if (ctx.opts.outputSchema) {
    dir = await mkdtemp(join(tmpdir(), 'hca-codex-schema-'));
    outputSchemaPath = join(dir, 'schema.json');
    await writeFile(outputSchemaPath, JSON.stringify(ctx.opts.outputSchema));
  }

  const argv = buildCodexArgv({
    opts: ctx.opts,
    resumeId: ctx.resumeId,
    resumeLatest: ctx.resumeLatest,
    outputSchemaPath,
  });

  return {
    argv,
    stdin: ctx.prompt,
    cleanup: async () => {
      if (!dir) return;
      const tmpRoot = resolve(tmpdir());
      const resolvedDir = resolve(dir);
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

function tomlString(value: string): string {
  return JSON.stringify(value);
}

async function registerCodexMcp(bridge: HttpMcpBridge): Promise<McpHandshake> {
  const key = `mcp_servers.${bridge.serverName}`;
  return {
    argv: [
      '-c',
      `${key}.url=${tomlString(bridge.url)}`,
      '-c',
      `${key}.enabled=true`,
      '-c',
      `${key}.required=true`,
      '-c',
      `${key}.default_tools_approval_mode=${tomlString('approve')}`,
    ],
    cleanup: async () => undefined,
  };
}

export const codexSpec: AdapterSpec<'codex'> = {
  provider: 'codex',
  bin: 'codex',
  promptTransport: 'stdin',
  buildArgv: (ctx) =>
    buildCodexArgv({
      opts: ctx.opts,
      resumeId: ctx.resumeId,
      resumeLatest: ctx.resumeLatest,
    }),
  prepareRun: prepareCodexRun,
  translateLine: translateCodexLine,
  registerMcp: registerCodexMcp,
  shouldAccumulateText: (ev) =>
    ev.type === 'message' && ev.role === 'assistant' && !ev.delta,
};

export function createCodexCoder(
  defaults?: SharedStartOpts,
): HeadlessCoder<'codex'> {
  return createCoderFromSpec(codexSpec, defaults);
}
