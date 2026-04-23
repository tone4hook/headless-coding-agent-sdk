/**
 * Thin wrapper around `child_process.spawn` tailored to the CLI adapters:
 *  - stdout is exposed as an async iterator of lines (stream-json friendly)
 *  - stderr is captured separately and exposed the same way
 *  - an AbortSignal or explicit `interrupt()` sends SIGINT; a second call
 *    (or `kill()`) escalates to SIGTERM
 *  - `done` resolves with exit code + signal once the child has exited
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { chunkedToLines } from './lines.js';

export interface SpawnCliOptions {
  bin: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** String written to stdin then closed. Omit to leave stdin open/empty. */
  stdin?: string;
  signal?: AbortSignal;
}

export interface SpawnedCli {
  readonly pid: number | undefined;
  readonly lines: AsyncIterable<string>;
  readonly stderr: AsyncIterable<string>;
  readonly done: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>;
  /** SIGINT first, SIGTERM on a second call. */
  interrupt(): void;
  /** Force SIGTERM. */
  kill(): void;
}

export function spawnCli(opts: SpawnCliOptions): SpawnedCli {
  if (opts.signal?.aborted) {
    throw new Error('spawnCli: AbortSignal already aborted');
  }

  const child: ChildProcessWithoutNullStreams = spawn(opts.bin, opts.args ?? [], {
    env: opts.env ?? process.env,
    cwd: opts.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (opts.stdin !== undefined) {
    child.stdin.end(opts.stdin);
  }

  let interruptsSent = 0;
  let childExited = false;
  const sendInterrupt = () => {
    if (childExited || child.exitCode !== null) return;
    interruptsSent += 1;
    const sig: NodeJS.Signals = interruptsSent === 1 ? 'SIGINT' : 'SIGTERM';
    try {
      child.kill(sig);
    } catch {
      /* ignore */
    }
  };

  const abortListener = () => sendInterrupt();
  if (opts.signal) {
    opts.signal.addEventListener('abort', abortListener, { once: true });
  }

  const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once('error', (err) => reject(err));
      child.once('close', (code, sig) => {
        childExited = true;
        if (opts.signal) {
          opts.signal.removeEventListener('abort', abortListener);
        }
        resolve({ exitCode: code, signal: sig });
      });
    },
  );

  return {
    get pid() {
      return child.pid;
    },
    lines: chunkedToLines(child.stdout),
    stderr: chunkedToLines(child.stderr),
    done,
    interrupt: sendInterrupt,
    kill: () => {
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
    },
  };
}
