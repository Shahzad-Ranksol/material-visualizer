import { describe, expect, it } from 'vitest';
import { Cancelled, createCancelRegistry } from '../../services/analysis/cancellation';

describe('cancel registry', () => {
  it('stops a cancelled job at its next check, and forgets it when released', () => {
    const r = createCancelRegistry();
    expect(() => r.check(1)).not.toThrow();
    r.cancel(1);
    expect(r.isCancelled(1)).toBe(true);
    expect(() => r.check(1)).toThrow(Cancelled);
    r.release(1);
    expect(r.isCancelled(1)).toBe(false);
  });

  it('stops shared work only when every waiter has cancelled', () => {
    const r = createCancelRegistry();
    r.cancel(1);
    expect(() => r.checkAll([1, 2])).not.toThrow(); // job 2 still wants the photo
    r.cancel(2);
    expect(() => r.checkAll([1, 2])).toThrow(Cancelled);
    expect(() => r.checkAll([])).not.toThrow(); // no waiters recorded: never cancelled
  });
});
