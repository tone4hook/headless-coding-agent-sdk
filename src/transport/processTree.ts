import treeKill from 'tree-kill';

export type KillSignal = 'SIGINT' | 'SIGTERM' | 'SIGKILL';

export interface KillProcessTreeOptions {
  signal?: KillSignal;
}

/**
 * Kill `pid` and all its descendants.
 *
 * Walks the tree via `tree-kill` (which uses `pgrep -P` on Unix and
 * `taskkill /T /F` on Windows). On Unix, if `tree-kill` reports any error
 * we fall back to `process.kill(-pid, signal)` — this only succeeds when
 * the spawn used `detached: true` (so the child got its own process
 * group), but in that case it's a clean way to deliver the signal to
 * grandchildren that escaped the pgrep snapshot.
 */
export function killProcessTree(
  pid: number | undefined,
  opts: KillProcessTreeOptions = {},
): Promise<void> {
  if (!pid) return Promise.resolve();
  const signal = opts.signal ?? 'SIGTERM';
  return new Promise((resolve) => {
    treeKill(pid, signal, (err?: Error) => {
      if (err && process.platform !== 'win32') {
        try {
          process.kill(-pid, signal);
        } catch {
          /* group gone or never set — best-effort */
        }
      }
      resolve();
    });
  });
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
