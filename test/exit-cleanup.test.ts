import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _resetExitCleanup,
  trackForExitCleanup,
} from '../src/transport/exitCleanup.js';

afterEach(() => {
  _resetExitCleanup();
});

describe('trackForExitCleanup', () => {
  it('returns an untrack function that removes the dispose', () => {
    const dispose = vi.fn();
    const untrack = trackForExitCleanup(dispose);
    untrack();
    // Nothing observable beyond the absence of throws — but a second
    // untrack should also be a no-op.
    untrack();
    expect(dispose).not.toHaveBeenCalled();
  });

  it('multiple registrations are independent', () => {
    const a = vi.fn();
    const b = vi.fn();
    const untrackA = trackForExitCleanup(a);
    trackForExitCleanup(b);
    untrackA();
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });
});
