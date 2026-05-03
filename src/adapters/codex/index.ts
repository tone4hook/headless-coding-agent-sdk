/**
 * Codex adapter — subprocess-based coder for `codex exec`.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { HeadlessCoder, SharedStartOpts } from '../../types.js';
import { createCoderFromSpec } from '../shared/thread.js';
import type { AdapterSpec, BuildArgvCtx, PreparedRun } from '../shared/spec.js';
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

export const codexSpec: AdapterSpec<'codex'> = {
  provider: 'codex',
  bin: 'codex',
  promptTransport: 'stdin',
  buildArgv: (ctx) => buildCodexArgv({ opts: ctx.opts }),
  prepareRun: prepareCodexRun,
  translateLine: translateCodexLine,
  shouldAccumulateText: (ev) =>
    ev.type === 'message' && ev.role === 'assistant' && !ev.delta,
};

export function createCodexCoder(
  defaults?: SharedStartOpts,
): HeadlessCoder<'codex'> {
  return createCoderFromSpec(codexSpec, defaults);
}
