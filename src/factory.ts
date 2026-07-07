/**
 * Generic `createCoder(name, defaults)` — thin type-narrowing wrapper
 * over the direct adapter factories. Using the literal `name` argument
 * narrows the returned `HeadlessCoder<P>` so consumers get adapter-
 * specific typing on events and thread handles.
 */

import type { HeadlessCoder, Provider, SharedStartOpts } from './types.js';
import { CoderError } from './errors.js';
import { createClaudeCoder } from './adapters/claude/index.js';
import { createCodexCoder } from './adapters/codex/index.js';
import { createCopilotCoder } from './adapters/copilot/index.js';
import { createPiCoder } from './adapters/pi/index.js';

export function createCoder<P extends Provider>(
  name: P,
  defaults?: SharedStartOpts,
): HeadlessCoder<P> {
  switch (name) {
    case 'claude':
      return createClaudeCoder(defaults) as unknown as HeadlessCoder<P>;
    case 'codex':
      return createCodexCoder(defaults) as unknown as HeadlessCoder<P>;
    case 'copilot':
      return createCopilotCoder(defaults) as unknown as HeadlessCoder<P>;
    case 'pi':
      return createPiCoder(defaults) as unknown as HeadlessCoder<P>;
    default:
      throw new CoderError('UNKNOWN_PROVIDER', `Unknown provider: ${String(name)}`);
  }
}
