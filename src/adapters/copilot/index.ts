/**
 * Copilot adapter — subprocess-based coder for the `copilot` CLI.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { FeatureNotSupportedError } from '../../errors.js';
import type { HeadlessCoder, SharedStartOpts } from '../../types.js';
import type { HttpMcpBridge } from '../../tools/bridge.js';
import { createCoderFromSpec } from '../shared/thread.js';
import type { AdapterSpec, McpHandshake } from '../shared/spec.js';
import { buildCopilotArgv } from './flags.js';
import { translateCopilotLine } from './translate.js';

async function registerCopilotMcp(bridge: HttpMcpBridge): Promise<McpHandshake> {
  const dir = await mkdtemp(join(tmpdir(), 'hca-copilot-mcp-'));
  const path = join(dir, 'mcp.json');
  await writeFile(
    path,
    JSON.stringify({
      mcpServers: {
        [bridge.serverName]: {
          type: 'http',
          url: bridge.url,
          tools: ['*'],
        },
      },
    }),
  );

  return {
    argv: [
      '--additional-mcp-config',
      `@${path}`,
      '--allow-tool',
      bridge.serverName,
    ],
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

export const copilotSpec: AdapterSpec<'copilot'> = {
  provider: 'copilot',
  bin: 'copilot',
  buildArgv: (ctx) =>
    buildCopilotArgv({
      prompt: ctx.prompt,
      opts: ctx.opts,
      resumeId: ctx.resumeId,
      resumeLatest: ctx.resumeLatest,
    }),
  translateLine: translateCopilotLine,
  registerMcp: registerCopilotMcp,
  transformPrompt: (prompt, opts) => injectSchemaPrompt(prompt, opts),
  shouldAccumulateText: (ev) =>
    ev.type === 'message' && ev.role === 'assistant' && !ev.delta,
  fork: async () => {
    throw new FeatureNotSupportedError(
      'copilot',
      'fork',
      'Copilot CLI does not expose a fork-session operation.',
    );
  },
};

export function createCopilotCoder(
  defaults?: SharedStartOpts,
): HeadlessCoder<'copilot'> {
  return createCoderFromSpec(copilotSpec, defaults);
}
