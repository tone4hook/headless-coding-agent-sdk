/**
 * Pi adapter — subprocess-based coder for the `pi` coding-agent CLI.
 */

import { FeatureNotSupportedError } from '../../errors.js';
import type { HeadlessCoder, SharedStartOpts } from '../../types.js';
import { createCoderFromSpec } from '../shared/thread.js';
import type { AdapterSpec, BuildArgvCtx, PreparedRun } from '../shared/spec.js';
import { buildPiArgv } from './flags.js';
import { translatePiLine } from './translate.js';

function injectSchemaPrompt(
  prompt: string,
  opts: SharedStartOpts & { outputSchema?: unknown },
): string {
  if (!opts.outputSchema) return prompt;
  return [
    'Return only JSON matching this JSON Schema. Do not include markdown fences or explanatory prose.',
    JSON.stringify(opts.outputSchema, null, 2),
    '',
    prompt,
  ].join('\n');
}

async function preparePiRun(ctx: BuildArgvCtx): Promise<PreparedRun> {
  const argv = buildPiArgv({
    opts: ctx.opts,
    resumeId: ctx.resumeId,
    resumeLatest: ctx.resumeLatest,
  });
  const callerProvidedOffline = Object.prototype.hasOwnProperty.call(
    ctx.opts.extraEnv ?? {},
    'PI_OFFLINE',
  );

  return {
    argv,
    stdin: ctx.prompt,
    env: callerProvidedOffline ? undefined : { PI_OFFLINE: '1' },
  };
}

export const piSpec: AdapterSpec<'pi'> = {
  provider: 'pi',
  bin: 'pi',
  promptTransport: 'stdin',
  buildArgv: (ctx) =>
    buildPiArgv({
      opts: ctx.opts,
      resumeId: ctx.resumeId,
      resumeLatest: ctx.resumeLatest,
    }),
  prepareRun: preparePiRun,
  translateLine: translatePiLine,
  transformPrompt: (prompt, opts) => injectSchemaPrompt(prompt, opts),
  shouldAccumulateText: (ev) =>
    ev.type === 'message' && ev.role === 'assistant' && !ev.delta,
  fork: async () => {
    throw new FeatureNotSupportedError(
      'pi',
      'fork',
      'Pi has --fork for session files, but the SDK does not expose a safe fork() mapping yet.',
    );
  },
};

export function createPiCoder(defaults?: SharedStartOpts): HeadlessCoder<'pi'> {
  return createCoderFromSpec(piSpec, defaults);
}
