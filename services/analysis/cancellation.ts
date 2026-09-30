/**
 * Cooperative cancellation inside the analysis worker: a model step can't be interrupted, so a
 * cancelled job stops at its next step boundary. Work shared by several jobs (one photo's load)
 * stops only when every job waiting on it has cancelled.
 */
export class Cancelled extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'Cancelled';
  }
}

export interface CancelRegistry {
  cancel(id: number): void;
  isCancelled(id: number): boolean;
  // Forget a finished job
  release(id: number): void;
  // Throws Cancelled if this job was cancelled
  check(id: number): void;
  // Throws Cancelled if there is at least one waiter and all of them were cancelled
  checkAll(ids: Iterable<number>): void;
}

export const createCancelRegistry = (): CancelRegistry => {
  const cancelled = new Set<number>();
  return {
    cancel: (id) => void cancelled.add(id),
    isCancelled: (id) => cancelled.has(id),
    release: (id) => void cancelled.delete(id),
    check(id) {
      if (cancelled.has(id)) throw new Cancelled();
    },
    checkAll(ids) {
      const all = [...ids];
      if (all.length && all.every((id) => cancelled.has(id))) throw new Cancelled();
    },
  };
};
