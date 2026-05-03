/**
 * Opt-in exit-cleanup helper.
 *
 * Libraries should not auto-register global signal handlers at module
 * load — that surprises consumers who already wire their own. Instead we
 * expose `installExitCleanup()` for consumers to call once at startup.
 *
 * Each spawned thread registers its `interrupt` via
 * `trackForExitCleanup(dispose)`; on host exit (signal, beforeExit, or
 * uncaught exception) every tracked dispose runs with a small grace
 * period so child CLIs and their grandchildren are reaped before the
 * host dies.
 */

const tracked = new Set<() => Promise<void> | void>();

export function trackForExitCleanup(
  dispose: () => Promise<void> | void,
): () => void {
  tracked.add(dispose);
  return () => {
    tracked.delete(dispose);
  };
}

export interface InstallExitCleanupOptions {
  /** Signals to trap. Default: SIGINT, SIGTERM (+SIGHUP on non-Windows). */
  signals?: NodeJS.Signals[];
  /** Per-dispose timeout in ms. Default: 2000. */
  disposeTimeoutMs?: number;
}

let installed = false;

async function runWithTimeout(
  fn: () => Promise<void> | void,
  timeoutMs: number,
): Promise<void> {
  await Promise.race([
    Promise.resolve().then(() => fn()),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs).unref?.()),
  ]).catch(() => undefined);
}

export function installExitCleanup(opts: InstallExitCleanupOptions = {}): void {
  if (installed) return;
  installed = true;

  const defaults: NodeJS.Signals[] =
    process.platform === 'win32'
      ? ['SIGINT', 'SIGTERM']
      : ['SIGINT', 'SIGTERM', 'SIGHUP'];
  const signals = opts.signals ?? defaults;
  const timeout = opts.disposeTimeoutMs ?? 2000;

  let running = false;
  const runAll = async () => {
    if (running) return;
    running = true;
    const fns = [...tracked];
    tracked.clear();
    await Promise.all(fns.map((fn) => runWithTimeout(fn, timeout)));
  };

  for (const sig of signals) {
    process.once(sig, () => {
      void runAll().finally(() => {
        // Re-raise the signal so default handler runs (preserves correct
        // exit code semantics). 128 + signal number is the conventional
        // exit code; for portability we just exit with code 1 if the
        // signal can't be re-raised.
        try {
          process.kill(process.pid, sig);
        } catch {
          process.exit(1);
        }
      });
    });
  }

  process.once('beforeExit', () => {
    void runAll();
  });

  process.once('uncaughtException', (err) => {
    void runAll().finally(() => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
  });
}

/** @internal — for tests. */
export function _resetExitCleanup(): void {
  tracked.clear();
  installed = false;
}
