/**
 * Claude adapter skeleton. run()/runStreamed() are filled in Phase 7
 * after the event translator lands.
 */

import type {
  HeadlessCoder,
  SharedStartOpts,
  ThreadHandle,
  PromptInput,
  RunOpts,
  RunResult,
  CoderStreamEvent,
} from '../../types.js';

export function createClaudeCoder(defaults?: SharedStartOpts): HeadlessCoder<'claude'> {
  return new ClaudeCoder(defaults);
}

class ClaudeCoder implements HeadlessCoder<'claude'> {
  readonly provider = 'claude' as const;
  constructor(private readonly defaults?: SharedStartOpts) {}

  async startThread(opts?: SharedStartOpts): Promise<ThreadHandle<'claude'>> {
    return new ClaudeThread({ ...this.defaults, ...opts });
  }

  async resumeThread(
    id: string,
    opts?: SharedStartOpts,
  ): Promise<ThreadHandle<'claude'>> {
    const thread = new ClaudeThread({ ...this.defaults, ...opts });
    thread.id = id;
    return thread;
  }

  async resumeLatest(opts?: SharedStartOpts): Promise<ThreadHandle<'claude'>> {
    const thread = new ClaudeThread({ ...this.defaults, ...opts });
    thread._continueLatest = true;
    return thread;
  }

  async close(thread: ThreadHandle<'claude'>): Promise<void> {
    await thread.close();
  }
}

class ClaudeThread implements ThreadHandle<'claude'> {
  readonly provider = 'claude' as const;
  id?: string;
  /** @internal */
  _continueLatest = false;

  constructor(private readonly opts: SharedStartOpts) {
    // Reference to silence unused-param lint until Phase 7 consumes it.
    void this.opts;
  }

  async run(_input: PromptInput, _opts?: RunOpts): Promise<RunResult<'claude'>> {
    throw new Error('Not implemented (Phase 7)');
  }

  runStreamed(
    _input: PromptInput,
    _opts?: RunOpts,
  ): AsyncIterable<CoderStreamEvent<'claude'>> {
    throw new Error('Not implemented (Phase 7)');
  }

  async interrupt(_reason?: string): Promise<void> {
    // Phase 7
  }

  async close(): Promise<void> {
    // Phase 7
  }

  async fork(): Promise<ThreadHandle<'claude'>> {
    throw new Error('Not implemented (Phase 7)');
  }
}
