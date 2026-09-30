import { AnalysisStage, STAGE_LABELS, WorkerRequest, WorkerResponse } from './protocol';

/**
 * The analysis worker's client: one worker, many overlapping jobs. Each job gets its own
 * progress, can be cancelled with an AbortSignal (the worker stops it at its next step), and
 * has a hard time limit — past it the worker is presumed stuck, so it is terminated, every job
 * still pending in it fails with "took too long", and the next job starts a fresh worker.
 */
export interface JobOptions {
  signal?: AbortSignal;
  // Human-readable step ("Estimating 3D geometry…"), for this job only
  onProgress?: (label: string) => void;
}

export class AnalysisTimeoutError extends Error {
  constructor() {
    super('This took too long — try again.');
    this.name = 'AnalysisTimeoutError';
  }
}

export const isAbortError = (err: unknown) => err instanceof DOMException && err.name === 'AbortError';

// Timed from when a job is sent; the first photo also loads the models
export const JOB_TIME_LIMITS_MS = { analyze: 300_000, cut: 180_000, cutObject: 180_000 } as const;

type JobRequest = Exclude<WorkerRequest, { type: 'cancel' }>;
export type RequestBody = JobRequest extends infer R ? (R extends JobRequest ? Omit<R, 'id'> : never) : never;

interface Pending {
  resolve: (r: WorkerResponse) => void;
  reject: (err: unknown) => void;
  onProgress?: (label: string) => void;
  timer: ReturnType<typeof setTimeout>;
  cleanup: () => void;
}

const aborted = () => new DOMException('Cancelled', 'AbortError');

export const createWorkerClient = (makeWorker: () => Worker) => {
  let worker: Worker | null = null;
  let nextId = 0;
  const pending = new Map<number, Pending>();

  const settle = (id: number) => {
    const job = pending.get(id);
    if (!job) return null;
    pending.delete(id);
    clearTimeout(job.timer);
    job.cleanup();
    return job;
  };

  const failAll = (err: unknown) => {
    for (const id of [...pending.keys()]) settle(id)?.reject(err);
  };

  const ensureWorker = () => {
    if (worker) return worker;
    const w = makeWorker();
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        pending.get(msg.id)?.onProgress?.(STAGE_LABELS[msg.stage as AnalysisStage]);
        return;
      }
      const job = settle(msg.id);
      if (!job) return; // cancelled, or timed out: nobody is waiting
      if (msg.type === 'error') job.reject(new Error(msg.error));
      else job.resolve(msg);
    };
    w.onerror = (e) => {
      // A worker that fails to load or crashes would otherwise leave every job hanging
      failAll(new Error(`The analysis worker stopped: ${e.message || 'unknown error'}`));
      worker = null;
    };
    worker = w;
    return w;
  };

  const send = (body: RequestBody, options: JobOptions = {}): Promise<WorkerResponse> => {
    const { signal, onProgress } = options;
    if (signal?.aborted) return Promise.reject(aborted());
    const w = ensureWorker();
    const id = nextId++;
    return new Promise<WorkerResponse>((resolve, reject) => {
      const onAbort = () => {
        if (!settle(id)) return;
        worker?.postMessage({ id: nextId++, type: 'cancel', target: id } satisfies WorkerRequest);
        reject(aborted());
      };
      const timer = setTimeout(() => {
        // Stuck: nothing else in this worker will answer either
        w.terminate();
        if (worker === w) worker = null;
        failAll(new AnalysisTimeoutError());
      }, JOB_TIME_LIMITS_MS[body.type]);
      signal?.addEventListener('abort', onAbort, { once: true });
      pending.set(id, { resolve, reject, onProgress, timer, cleanup: () => signal?.removeEventListener('abort', onAbort) });
      w.postMessage({ ...body, id } as WorkerRequest);
    });
  };

  return { send };
};
