/**
 * Gemini adapter skeleton. run()/runStreamed() filled in Phase 10.
 */

import type {
  CoderStreamEvent,
  HeadlessCoder,
  PromptInput,
  RunOpts,
  RunResult,
  SharedStartOpts,
  ThreadHandle,
} from '../../types.js';
import { FeatureNotSupportedError } from '../../errors.js';

export function createGeminiCoder(
  defaults?: SharedStartOpts,
): HeadlessCoder<'gemini'> {
  return new GeminiCoder(defaults);
}

class GeminiCoder implements HeadlessCoder<'gemini'> {
  readonly provider = 'gemini' as const;
  constructor(private readonly defaults?: SharedStartOpts) {}

  async startThread(opts?: SharedStartOpts): Promise<ThreadHandle<'gemini'>> {
    return new GeminiThread({ ...this.defaults, ...opts });
  }

  async resumeThread(
    id: string,
    opts?: SharedStartOpts,
  ): Promise<ThreadHandle<'gemini'>> {
    const t = new GeminiThread({ ...this.defaults, ...opts });
    t.id = id;
    return t;
  }

  async resumeLatest(opts?: SharedStartOpts): Promise<ThreadHandle<'gemini'>> {
    const t = new GeminiThread({ ...this.defaults, ...opts });
    t._resumeLatest = true;
    return t;
  }

  async close(thread: ThreadHandle<'gemini'>): Promise<void> {
    await thread.close();
  }
}

class GeminiThread implements ThreadHandle<'gemini'> {
  readonly provider = 'gemini' as const;
  id?: string;
  /** @internal */ _resumeLatest = false;

  constructor(private readonly opts: SharedStartOpts) {
    void this.opts;
  }

  async run(_input: PromptInput, _opts?: RunOpts): Promise<RunResult<'gemini'>> {
    throw new Error('Not implemented (Phase 10)');
  }

  runStreamed(
    _input: PromptInput,
    _opts?: RunOpts,
  ): AsyncIterable<CoderStreamEvent<'gemini'>> {
    throw new Error('Not implemented (Phase 10)');
  }

  async interrupt(_reason?: string): Promise<void> {
    // Phase 10
  }

  async close(): Promise<void> {
    // Phase 10
  }

  async fork(): Promise<ThreadHandle<'gemini'>> {
    throw new FeatureNotSupportedError(
      'gemini',
      'fork',
      'Gemini CLI has no --fork-session equivalent. Use resumeLatest or resumeThread(id) for a new branch.',
    );
  }
}
