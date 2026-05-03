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
import { sanitizeEnv } from './env.js';
import { delay, killProcessTree, type KillSignal } from './processTree.js';

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

const activeClis = new Set<{
  pid: number | undefined;
  done: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>;
  interrupt: () => void;
  kill: () => void;
}>();

async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([
    promise.then((value) => value),
    delay(ms).then(() => undefined),
  ]);
}

export interface ComposeEnvOptions {
  extraEnv?: Record<string, string>;
  unsetEnv?: string[];
  /**
   * Run the deny-list sanitizer over `parentEnv` before applying `extraEnv`.
   * Default: true. Set false to pass the host env through verbatim.
   */
  cleanEnv?: boolean;
  /** Extra deny keys appended to the sanitizer's defaults. */
  additionalDenyEnv?: string[];
}

/**
 * Compose a child-process env from a parent env, overlay, and unset list.
 *
 * Order of operations:
 *   1. (optional) sanitize `parentEnv` via the deny list (default ON).
 *   2. Spread `extraEnv` (empty strings are preserved as legitimate values
 *      and can intentionally re-add a sanitized key).
 *   3. Delete every key listed in `unsetEnv` (last word — wins over a
 *      same-key `extraEnv` value).
 *
 * Used by adapters to honor `SharedStartOpts.extraEnv`, `unsetEnv`,
 * `cleanEnv`, and `additionalDenyEnv`. The `unsetEnv` field exists so
 * callers can strip stale auth env vars (e.g. `ANTHROPIC_API_KEY`) and
 * force the CLI's OAuth / keychain fallback, which empty-string values
 * cannot do.
 *
 * Two call signatures supported:
 *   - composeEnv(parent, extraEnv, unsetEnv)               // legacy
 *   - composeEnv(parent, { extraEnv, unsetEnv, cleanEnv })  // current
 */
export function composeEnv(
  parentEnv: NodeJS.ProcessEnv,
  extraEnvOrOptions?: Record<string, string> | ComposeEnvOptions,
  unsetEnv?: string[],
): NodeJS.ProcessEnv {
  let opts: ComposeEnvOptions;
  if (
    extraEnvOrOptions &&
    ('cleanEnv' in extraEnvOrOptions ||
      'additionalDenyEnv' in extraEnvOrOptions ||
      'extraEnv' in extraEnvOrOptions ||
      'unsetEnv' in extraEnvOrOptions)
  ) {
    opts = extraEnvOrOptions as ComposeEnvOptions;
  } else {
    opts = {
      extraEnv: extraEnvOrOptions as Record<string, string> | undefined,
      unsetEnv,
    };
  }

  const cleanEnv = opts.cleanEnv ?? true;
  const base = cleanEnv
    ? sanitizeEnv(parentEnv, { additionalDeny: opts.additionalDenyEnv })
    : { ...parentEnv };

  const env: NodeJS.ProcessEnv = { ...base, ...(opts.extraEnv ?? {}) };
  if (opts.unsetEnv) {
    for (const key of opts.unsetEnv) {
      delete env[key];
    }
  }
  return env;
}

export function spawnCli(opts: SpawnCliOptions): SpawnedCli {
  if (opts.signal?.aborted) {
    throw new Error('spawnCli: AbortSignal already aborted');
  }

  const child: ChildProcessWithoutNullStreams = spawn(opts.bin, opts.args ?? [], {
    env: opts.env ?? process.env,
    cwd: opts.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    // Put the child in its own process group on POSIX so killProcessTree
    // can target every descendant via `process.kill(-pid)` even if the
    // direct CLI dies before we can walk its tree. Not on Windows: there
    // is no setpgid; taskkill /T /F handles tree teardown via the job
    // object instead.
    detached: process.platform !== 'win32',
  });

  if (opts.stdin !== undefined) {
    child.stdin.end(opts.stdin);
  } else {
    // Signal EOF immediately so children that read stdin (e.g. the Claude
    // CLI in stream-json mode) don't wait for input that isn't coming.
    child.stdin.end();
  }

  let interruptsSent = 0;
  let childExited = false;
  const sendTreeSignal = (sig: KillSignal) => {
    if (childExited || child.exitCode !== null) return;
    void killProcessTree(child.pid, { signal: sig });
  };
  const sendInterrupt = () => {
    if (childExited || child.exitCode !== null) return;
    interruptsSent += 1;
    const sig: KillSignal = interruptsSent === 1 ? 'SIGINT' : 'SIGTERM';
    sendTreeSignal(sig);
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

  const tracked = {
    get pid() {
      return child.pid;
    },
    done,
    interrupt: sendInterrupt,
    kill: () => {
      sendTreeSignal('SIGTERM');
    },
  };
  activeClis.add(tracked);
  done.finally(() => activeClis.delete(tracked)).catch(() => undefined);

  return {
    get pid() {
      return child.pid;
    },
    lines: chunkedToLines(child.stdout),
    stderr: chunkedToLines(child.stderr),
    done,
    interrupt: sendInterrupt,
    kill: () => {
      sendTreeSignal('SIGTERM');
    },
  };
}

export async function shutdownSpawnedClis(_reason?: string): Promise<void> {
  const clis = [...activeClis];
  for (const cli of clis) cli.interrupt();
  await Promise.all(clis.map((cli) => withDeadline(cli.done, 5000)));

  const stillRunning = clis.filter((cli) => activeClis.has(cli));
  for (const cli of stillRunning) cli.kill();
  await Promise.all(stillRunning.map((cli) => withDeadline(cli.done, 2000)));

  const stubborn = clis.filter((cli) => activeClis.has(cli));
  await Promise.all(stubborn.map((cli) => killProcessTree(cli.pid, { signal: 'SIGKILL' })));
}
