import treeKill from 'tree-kill';

export type KillSignal = 'SIGINT' | 'SIGTERM' | 'SIGKILL';

export interface KillProcessTreeOptions {
  signal?: KillSignal;
}

export function killProcessTree(
  pid: number | undefined,
  opts: KillProcessTreeOptions = {},
): Promise<void> {
  if (!pid) return Promise.resolve();
  return new Promise((resolve) => {
    treeKill(pid, opts.signal ?? 'SIGTERM', () => resolve());
  });
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
