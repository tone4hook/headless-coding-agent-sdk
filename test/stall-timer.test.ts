import { describe, expect, it, vi } from 'vitest';
import { createStallTimer } from '../src/transport/stallTimer.js';

describe('createStallTimer', () => {
  it('is a no-op when ms is undefined', () => {
    const onStall = vi.fn();
    const t = createStallTimer(undefined, onStall);
    t.reset();
    t.cancel();
    expect(onStall).not.toHaveBeenCalled();
  });

  it('is a no-op when ms is 0', () => {
    const onStall = vi.fn();
    const t = createStallTimer(0, onStall);
    expect(onStall).not.toHaveBeenCalled();
    t.cancel();
  });

  it('fires onStall after ms elapses with no reset', async () => {
    const onStall = vi.fn();
    const t = createStallTimer(20, onStall);
    await new Promise((r) => setTimeout(r, 60));
    expect(onStall).toHaveBeenCalledTimes(1);
    t.cancel();
  });

  it('reset() postpones onStall', async () => {
    const onStall = vi.fn();
    const t = createStallTimer(40, onStall);
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 20));
      t.reset();
    }
    expect(onStall).not.toHaveBeenCalled();
    t.cancel();
  });

  it('cancel() prevents onStall', async () => {
    const onStall = vi.fn();
    const t = createStallTimer(20, onStall);
    t.cancel();
    await new Promise((r) => setTimeout(r, 50));
    expect(onStall).not.toHaveBeenCalled();
  });
});
