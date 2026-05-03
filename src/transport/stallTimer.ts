/**
 * Tiny event-stall watchdog. Returns a no-op when `ms` is undefined or 0.
 *
 * Usage from the shared run pipeline:
 *   const stall = createStallTimer(opts.stallTimeoutMs, () => abort('stalled'));
 *   try { ...yield events, calling stall.reset() between each... }
 *   finally { stall.cancel(); }
 */

export interface StallTimer {
  reset(): void;
  cancel(): void;
}

const NOOP: StallTimer = { reset() {}, cancel() {} };

export function createStallTimer(
  ms: number | undefined,
  onStall: () => void,
): StallTimer {
  if (!ms || ms <= 0) return NOOP;

  let timer: NodeJS.Timeout | null = null;
  const arm = () => {
    timer = setTimeout(() => {
      timer = null;
      onStall();
    }, ms);
    // Don't keep the event loop alive solely for this watchdog.
    timer.unref?.();
  };
  arm();

  return {
    reset() {
      if (timer) clearTimeout(timer);
      arm();
    },
    cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
