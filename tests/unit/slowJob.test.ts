import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSlowJob, SLOW_JOB_MS, SlowJobState } from '../../services/slowJob';

describe('slow job', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('turns slow after 30 s, with the latest step, and resets when finished', () => {
    const states: SlowJobState[] = [];
    const job = createSlowJob((s) => states.push(s));
    const { onProgress } = job.start();
    onProgress('Estimating 3D geometry…');
    vi.advanceTimersByTime(SLOW_JOB_MS - 1);
    expect(states.at(-1)).toEqual({ slow: false, label: 'Estimating 3D geometry…' });
    vi.advanceTimersByTime(1);
    expect(states.at(-1)).toEqual({ slow: true, label: 'Estimating 3D geometry…' });
    job.finish();
    expect(states.at(-1)).toEqual({ slow: false, label: null });
    vi.advanceTimersByTime(SLOW_JOB_MS);
    expect(states.at(-1)!.slow).toBe(false);
  });

  it('cancel aborts the job; a new start supersedes (aborts) the previous one', () => {
    const job = createSlowJob(() => {});
    const first = job.start();
    const second = job.start();
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    job.cancel();
    expect(second.signal.aborted).toBe(true);
  });

  it('ignores progress from a superseded job', () => {
    const states: SlowJobState[] = [];
    const job = createSlowJob((s) => states.push(s));
    const stale = job.start();
    job.start();
    stale.onProgress('Old step');
    expect(states.at(-1)!.label).toBe(null);
  });
});
