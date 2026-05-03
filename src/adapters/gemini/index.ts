/**
 * Gemini adapter — subprocess-based coder for the `gemini` CLI.
 */

import type {
  HeadlessCoder,
  SharedStartOpts,
} from '../../types.js';
import type { HttpMcpBridge } from '../../tools/bridge.js';
import { createCoderFromSpec } from '../shared/thread.js';
import type { AdapterSpec, McpHandshake } from '../shared/spec.js';
import { buildGeminiArgv } from './flags.js';
import { setupEphemeralGeminiHome } from './home.js';
import { translateGeminiLine } from './translate.js';

function schemaPreamble(schema: Record<string, unknown>): string {
  return [
    'Respond with a single valid JSON value that conforms to this JSON Schema:',
    JSON.stringify(schema),
    'Do not wrap in code fences. Emit JSON only.',
  ].join('\n');
}

async function registerGeminiMcp(bridge: HttpMcpBridge): Promise<McpHandshake> {
  const home = await setupEphemeralGeminiHome({
    bridgeUrl: bridge.url,
    mcpServerName: bridge.serverName,
  });
  return {
    env: home.env,
    cleanup: () => home.cleanup().catch(() => undefined) as Promise<void>,
  };
}

export const geminiSpec: AdapterSpec<'gemini'> = {
  provider: 'gemini',
  bin: 'gemini',
  promptTransport: 'stdin',
  buildArgv: (ctx) =>
    buildGeminiArgv({
      prompt: ctx.prompt,
      opts: ctx.opts,
      resumeId: ctx.resumeId,
      resumeLatest: ctx.resumeLatest,
    }),
  translateLine: translateGeminiLine,
  registerMcp: registerGeminiMcp,
  transformPrompt: (prompt, opts) =>
    opts.outputSchema
      ? `${schemaPreamble(opts.outputSchema)}\n\n${prompt}`
      : prompt,
  shouldAccumulateText: (ev) =>
    ev.type === 'message' && ev.role === 'assistant',
};

export function createGeminiCoder(
  defaults?: SharedStartOpts,
): HeadlessCoder<'gemini'> {
  return createCoderFromSpec(geminiSpec, defaults);
}
