/**
 * Generic `createCoder(name, defaults)` — thin type-narrowing wrapper
 * over the direct adapter factories. Using the literal `name` argument
 * narrows the returned `HeadlessCoder<P>` so consumers get adapter-
 * specific typing on events and thread handles.
 */

import type { HeadlessCoder, Provider, SharedStartOpts } from './types.js';
import { CoderError } from './errors.js';
import { createClaudeCoder } from './adapters/claude/index.js';
import { createGeminiCoder } from './adapters/gemini/index.js';

export function createCoder<P extends Provider>(
  name: P,
  defaults?: SharedStartOpts,
): HeadlessCoder<P> {
  switch (name) {
    case 'claude':
      return createClaudeCoder(defaults) as unknown as HeadlessCoder<P>;
    case 'gemini':
      return createGeminiCoder(defaults) as unknown as HeadlessCoder<P>;
    default:
      throw new CoderError('UNKNOWN_PROVIDER', `Unknown provider: ${String(name)}`);
  }
}
