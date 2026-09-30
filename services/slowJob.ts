import type { JobOptions } from './analysis/workerClient';

/**
 * One analysis job a screen is waiting on: its step label, whether it has run past
 * SLOW_JOB_MS (time to offer Cancel), and its AbortController. Starting a new job supersedes
 * (aborts) the previous one; progress from a superseded job is ignored.
 */
export const SLOW_JOB_MS = 30_000;

export interface SlowJobState {
  slow: boolean;
  label: string | null;
}

export const createSlowJob = (onChange: (s: SlowJobState) => void, slowAfterMs = SLOW_JOB_MS) => {
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let state: SlowJobState = { slow: false, label: null };
  const set = (next: Partial<SlowJobState>) => {
    state = { ...state, ...next };
    onChange(state);
  };
  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
    controller = null;
    set({ slow: false, label: null });
  };
  return {
    start(): Required<JobOptions> {
      controller?.abort();
      stop();
      const own = new AbortController();
      controller = own;
      timer = setTimeout(() => controller === own && set({ slow: true }), slowAfterMs);
      return { signal: own.signal, onProgress: (label: string) => void (controller === own && set({ label })) };
    },
    cancel() {
      controller?.abort();
      stop();
    },
    finish: stop,
  };
};
