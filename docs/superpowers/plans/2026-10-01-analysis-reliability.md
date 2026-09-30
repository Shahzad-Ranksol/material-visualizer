# Analysis Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Analysis jobs can be cancelled, stop with a clear error at a hard time limit, and report progress to the screen that asked for them, with a "Still working… (Cancel)" notice after 30 s.

**Architecture:** The worker client moves out of `services/roomAnalysis.ts` into a testable `services/analysis/workerClient.ts`. It owns per-job progress routing, `AbortSignal` handling, and hard-limit timers that terminate a stuck worker.

- **Cancelling inside the worker:** the worker keeps a cancellation registry (`services/analysis/cancellation.ts`) and stops a cancelled job at its next step boundary. A photo load shared by several jobs stops only when every job waiting on it has cancelled.
- **UI:** a small pure controller (`services/slowJob.ts`) with a React hook and a shared notice component wires this into the four screens that wait on the worker.

**Tech Stack:** React 19 + TypeScript + Vite, Web Worker (`workers/analysis.worker.ts`), Vitest (Node environment, fake timers), Playwright.

Spec: `docs/superpowers/specs/2026-09-25-analysis-reliability-design.md`.

## Global Constraints

- **Slow notice:** after **30 s**, show "Still working — <step> (Cancel)" (the step labels already end in "…"). At the hard limit, stop with **"This took too long — try again"**.
- **Hard limits** (timed from when the job is sent): `analyze` **5 min**; `cut` and `cutObject` **3 min**.
- **User cancel, or a superseded job:** cooperative. The worker stops at its next step boundary. A running model step can't be interrupted.
- **Hard limit:** the worker is **terminated**. Every job still pending in it rejects with the too-long error, and the next request spawns a fresh worker.
- **Aborts:** an aborted job rejects with `DOMException('Cancelled', 'AbortError')`. The UI ignores it and shows no error.
- **Progress:** `onAnalysisProgress` (the global progress listener) is removed. Progress goes to each job's own `onProgress`.
- **Checks:** run `npm run typecheck` and `npm test` after every task; both must stay green.
- **Lint:** no new npm dependencies. `vitest.config.ts` uses `environment: 'node'` (there is no DOM or React testing library), so the logic under test lives in pure modules.
- **Code style:** relative imports without extensions in the frontend. Comments are sparse and explain *why*.

---

### Task 1: Cancellation registry (pure)

**Files:**
- Create: `services/analysis/cancellation.ts`
- Test: `tests/unit/cancellation.test.ts`

**Interfaces:**
- Produces:
  - `class Cancelled extends Error` (name `'Cancelled'`)
  - `createCancelRegistry(): CancelRegistry`, where `CancelRegistry` is `{ cancel(id: number): void; isCancelled(id: number): boolean; release(id: number): void; check(id: number): void; checkAll(ids: Iterable<number>): void }`
  - `check` throws `Cancelled` if `id` was cancelled.
  - `checkAll` throws `Cancelled` only if there is at least one id and every id was cancelled.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/cancellation.test.ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/cancellation.test.ts`
Expected: FAIL, "Failed to resolve import ../../services/analysis/cancellation"

- [ ] **Step 3: Write the implementation**

```ts
// services/analysis/cancellation.ts
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
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/cancellation.test.ts && npm run typecheck`
Expected: PASS (2 tests), typecheck clean

- [ ] **Step 5: Commit**

```bash
git add services/analysis/cancellation.ts tests/unit/cancellation.test.ts
git commit -m "Add cooperative cancellation registry for the analysis worker"
```

---

### Task 2: Worker client with abort, hard limits and per-job progress

**Files:**
- Create: `services/analysis/workerClient.ts`
- Modify: `services/analysis/protocol.ts`: add the `cancel` request to `WorkerRequest`
- Test: `tests/unit/workerClient.test.ts`

**Interfaces:**
- Consumes: `WorkerRequest`, `WorkerResponse`, `STAGE_LABELS`, `AnalysisStage` from `services/analysis/protocol.ts`
- Produces:
  - `interface JobOptions { signal?: AbortSignal; onProgress?: (label: string) => void }`
  - `class AnalysisTimeoutError extends Error` (message `'This took too long — try again.'`, name `'AnalysisTimeoutError'`)
  - `isAbortError(err: unknown): boolean`
  - `JOB_TIME_LIMITS_MS: Record<'analyze' | 'cut' | 'cutObject', number>` = `{ analyze: 300_000, cut: 180_000, cutObject: 180_000 }`
  - `createWorkerClient(makeWorker: () => Worker): { send(body: RequestBody, options?: JobOptions): Promise<WorkerResponse> }`
  - `type RequestBody` = any `WorkerRequest` except `cancel`, without `id`

- [ ] **Step 1: Add the cancel request to the protocol**

In `services/analysis/protocol.ts`, change the last member of `WorkerRequest`, from:

```ts
  | { id: number; type: 'cutObject'; imageUrl: string; point: { xPct: number; yPct: number } };
```

to:

```ts
  | { id: number; type: 'cutObject'; imageUrl: string; point: { xPct: number; yPct: number } }
  // Stop job `target` at its next step boundary (it then sends nothing more)
  | { id: number; type: 'cancel'; target: number };
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/unit/workerClient.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisTimeoutError, createWorkerClient, isAbortError, JOB_TIME_LIMITS_MS } from '../../services/analysis/workerClient';

// A stand-in for the analysis worker: records what it's sent; the test plays its replies
class FakeWorker {
  static made: FakeWorker[] = [];
  sent: any[] = [];
  terminated = false;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  constructor() {
    FakeWorker.made.push(this);
  }
  postMessage(msg: unknown) {
    this.sent.push(msg);
  }
  terminate() {
    this.terminated = true;
  }
  reply(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

const analyze = { type: 'analyze' as const, imageUrl: 'room.jpg' };
const analyzeReply = (id: number) => ({ id, type: 'analyze', width: 1, height: 1, labels: [], proposals: [], warnings: [], geometryAvailable: false, fromCache: false });

describe('worker client', () => {
  beforeEach(() => {
    FakeWorker.made = [];
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());
  const client = () => createWorkerClient(() => new FakeWorker() as unknown as Worker);

  it("routes progress to the job that asked, and resolves with the job's reply", async () => {
    const c = client();
    const a = vi.fn();
    const b = vi.fn();
    const first = c.send(analyze, { onProgress: a });
    c.send(analyze, { onProgress: b });
    const w = FakeWorker.made[0];
    w.reply({ id: w.sent[1].id, type: 'progress', stage: 'geometry' });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith('Estimating 3D geometry…');
    w.reply(analyzeReply(w.sent[0].id));
    await expect(first).resolves.toMatchObject({ type: 'analyze' });
  });

  it('on abort: rejects with AbortError, tells the worker, and ignores a late reply', async () => {
    const c = client();
    const ctrl = new AbortController();
    const job = c.send(analyze, { signal: ctrl.signal });
    const w = FakeWorker.made[0];
    const id = w.sent[0].id;
    ctrl.abort();
    const err = await job.catch((e: unknown) => e);
    expect(isAbortError(err)).toBe(true);
    expect(w.sent[1]).toMatchObject({ type: 'cancel', target: id });
    expect(() => w.reply(analyzeReply(id))).not.toThrow();
  });

  it('never sends a job whose signal is already aborted', async () => {
    const c = client();
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(c.send(analyze, { signal: ctrl.signal })).rejects.toSatisfy(isAbortError);
    expect(FakeWorker.made.length === 0 || FakeWorker.made[0].sent.length === 0).toBe(true);
  });

  it('at the hard limit: terminates the worker, fails every pending job, and starts afresh', async () => {
    const c = client();
    const slow = c.send(analyze).catch((e: unknown) => e);
    const other = c.send({ type: 'cutObject', imageUrl: 'room.jpg', point: { xPct: 1, yPct: 1 } }).catch((e: unknown) => e);
    vi.advanceTimersByTime(JOB_TIME_LIMITS_MS.analyze + 1);
    expect(await slow).toBeInstanceOf(AnalysisTimeoutError);
    expect(await other).toBeInstanceOf(AnalysisTimeoutError);
    expect(FakeWorker.made[0].terminated).toBe(true);
    c.send(analyze);
    expect(FakeWorker.made.length).toBe(2);
  });

  it('clears the time limit once a job answers', async () => {
    const c = client();
    const job = c.send(analyze);
    const w = FakeWorker.made[0];
    w.reply(analyzeReply(w.sent[0].id));
    await job;
    vi.advanceTimersByTime(JOB_TIME_LIMITS_MS.analyze + 1);
    expect(w.terminated).toBe(false);
  });
});
```

(`STAGE_LABELS.geometry` in `services/analysis/protocol.ts` is `'Estimating 3D geometry…'`; stage labels already end in "…".)

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/unit/workerClient.test.ts`
Expected: FAIL, "Failed to resolve import ../../services/analysis/workerClient"

- [ ] **Step 4: Write the implementation**

```ts
// services/analysis/workerClient.ts
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
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/workerClient.test.ts && npm run typecheck`
Expected: PASS (5 tests). Typecheck may report `workers/analysis.worker.ts` not handling `cancel`. If it does, add this temporary line at the top of `self.onmessage`: `if (e.data.type === 'cancel') return;`. Task 3 replaces it.

- [ ] **Step 6: Commit**

```bash
git add services/analysis/workerClient.ts services/analysis/protocol.ts tests/unit/workerClient.test.ts workers/analysis.worker.ts
git commit -m "Add analysis worker client with abort, hard time limits and per-job progress"
```

---

### Task 3: Worker stops cancelled jobs at step boundaries

**Files:**
- Modify: `workers/analysis.worker.ts`: `rooms`, `loadRoom`, `analyze`, `cutObject`, `cut`, `self.onmessage`

**Interfaces:**
- Consumes: `createCancelRegistry`, `Cancelled` (Task 1); the `cancel` request (Task 2)
- Produces:
  - `loadRoom(imageUrl: string, jobId: number, reportStage: ReportStage): Promise<RoomState>`
  - `analyze(imageUrl, jobId, reportStage)`, `cutObject(req, reportStage)`, `cut(req, reportStage)` (the latter two read `req.id`)

- [ ] **Step 1: Make shared photo loads track their waiters**

Replace

```ts
const rooms = new Map<string, Promise<RoomState>>();
```

with

```ts
// One load per photo, shared by every job that needs it; `waiters` are the jobs waiting on it
// (with their progress), so it stops only when all of them have been cancelled
const rooms = new Map<string, { promise: Promise<RoomState>; waiters: Map<number, ReportStage> }>();
const cancels = createCancelRegistry();
```

and add `import { Cancelled, createCancelRegistry } from '../services/analysis/cancellation';` to the imports.

Rewrite `loadRoom`, keeping its body between the two markers unchanged apart from the `reportStage` calls:

```ts
const loadRoom = async (imageUrl: string, jobId: number, reportStage: ReportStage): Promise<RoomState> => {
  let entry = rooms.get(imageUrl);
  if (!entry) {
    // The first job is a waiter before the load starts, so it gets the very first step too
    const waiters = new Map<number, ReportStage>([[jobId, reportStage]]);
    // Every step: stop if nobody still wants this photo, else tell each waiter what's running
    const step = (stage: AnalysisStage) => {
      cancels.checkAll(waiters.keys());
      waiters.forEach((report, id) => !cancels.isCancelled(id) && report(stage));
    };
    const promise = (async () => {
      // ... the existing body, with every `reportStage('<stage>')` replaced by `step('<stage>')`
    })();
    entry = { promise, waiters };
    promise.catch(() => rooms.delete(imageUrl));
    rooms.set(imageUrl, entry);
  }
  entry.waiters.set(jobId, reportStage);
  try {
    return await entry.promise;
  } finally {
    entry.waiters.delete(jobId);
  }
};
```

The existing `entry.catch(() => rooms.delete(imageUrl))` and `rooms.set(imageUrl, entry)` lines become the two lines shown above. A load that was cancelled is deleted from `rooms`, so a later request starts clean.

- [ ] **Step 2: Check the job's own cancellation at its step boundaries**

- `analyze(imageUrl, reportStage)` becomes `analyze(imageUrl, jobId, reportStage)`. It calls `loadRoom(imageUrl, jobId, reportStage)`, then `cancels.check(jobId)` right after it.
- `cutObject`: call `loadRoom(req.imageUrl, req.id, reportStage)`. Put `cancels.check(req.id);` immediately before `reportStage('refining');` and again immediately before the `segmentWithPrompts` call.
- `cut`: call `loadRoom(req.imageUrl, req.id, reportStage)`. Put `cancels.check(req.id);` in three places:
  - immediately before `reportStage('refining');`
  - immediately after `const enc = await room.prompts;`
  - immediately before the `// 4. One plane per physical surface` comment

- [ ] **Step 3: Handle cancel messages and stay silent for cancelled jobs**

At the top of `self.onmessage`, before `const post = …`, replace the temporary line from Task 2 (if any) with:

```ts
  const req = e.data;
  if (req.type === 'cancel') {
    cancels.cancel(req.target);
    return;
  }
```

Remove the now-duplicate `const req = e.data;` below it. Change the `catch` and add a `finally`:

```ts
  } catch (err) {
    // A cancelled job sends nothing more: its client has already stopped waiting
    if (err instanceof Cancelled) return;
    post({ id: req.id, type: 'error', error: err instanceof Error ? err.message : String(err) });
  } finally {
    cancels.release(req.id);
  }
```

Pass `req.id` into `analyze`: `await analyze(req.imageUrl, req.id, reportStage)`.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test`
Expected: clean; all unit tests pass. The worker has no unit tests; Task 7's e2e exercises it.

- [ ] **Step 5: Commit**

```bash
git add workers/analysis.worker.ts
git commit -m "Stop cancelled analysis jobs at step boundaries; shared photo loads stop when all waiters cancel"
```

---

### Task 4: roomAnalysis uses the client; job options on every call

**Files:**
- Modify: `services/roomAnalysis.ts`

**Interfaces:**
- Consumes: `createWorkerClient`, `JobOptions`, `isAbortError`, `AnalysisTimeoutError` (Task 2)
- Produces:
  - `analyzeRoom(imageUrl: string, options?: JobOptions)`
  - `cutSurface(imageUrl, point, options?: { label?; connectedOnly?; include?; exclude?; debugStages?; signal?: AbortSignal; onProgress?: (label: string) => void })`
  - `cutObject(imageUrl: string, point: PlanePoint, options?: JobOptions)`
  - `resolveSurface(imageUrl: string, item: DetectedItem, options?: JobOptions)`
  - re-exports: `export { isAbortError, AnalysisTimeoutError } from './analysis/workerClient'; export type { JobOptions } from './analysis/workerClient';`
  - `onAnalysisProgress` is **removed**

- [ ] **Step 1: Replace the inline client**

Delete from `services/roomAnalysis.ts`:
- the `progressListeners` set and `onAnalysisProgress`
- `type RequestBody`
- `let worker`, `let nextId`, `const pending`, and the whole `send` function

Add:

```ts
import { createWorkerClient, JobOptions } from './analysis/workerClient';
export { isAbortError, AnalysisTimeoutError } from './analysis/workerClient';
export type { JobOptions } from './analysis/workerClient';

// One worker for the app; `new Worker(new URL(...))` stays literal here so Vite bundles it
const client = createWorkerClient(() => new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), { type: 'module' }));
const send = client.send;
```

Remove `STAGE_LABELS` and `AnalysisStage` from this file's imports if they're no longer used.

- [ ] **Step 2: Thread the options through**

- `analyzeRoom = async (imageUrl: string, options: JobOptions = {})`: `send({ type: 'analyze', imageUrl }, options)`
- `cutSurface(…, options: { label?: string; connectedOnly?: boolean; include?: PlanePoint[]; exclude?: PlanePoint[]; debugStages?: boolean } & JobOptions = {})`: pass `{ signal: options.signal, onProgress: options.onProgress }` as `send`'s second argument.
- `cutObject = async (imageUrl: string, point: PlanePoint, options: JobOptions = {})`: `send({ type: 'cutObject', imageUrl, point }, options)`
- `resolveSurface = async (imageUrl: string, item: DetectedItem, options: JobOptions = {})`: `cutSurface(imageUrl, item.anchor, { label: item.surfaceLabel, ...options })`

- [ ] **Step 3: Fix the one caller of the removed listener**

In `App.tsx`, delete the effect that subscribes with `onAnalysisProgress`; it's at about line 119 (`const off = onAnalysisProgress(setAnalysisProgress);`). Remove `onAnalysisProgress` from the import on line 20. `analysisProgress` is fed per job in Task 6, so leave its `useState` in place.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test`
Expected: clean, all pass.

- [ ] **Step 5: Commit**

```bash
git add services/roomAnalysis.ts App.tsx
git commit -m "Route analysis through the worker client; per-job progress and signals on every call"
```

---

### Task 5: Slow-job controller, hook and notice

**Files:**
- Create: `services/slowJob.ts`, `components/useSlowJob.ts`, `components/SlowJobNotice.tsx`
- Test: `tests/unit/slowJob.test.ts`

**Interfaces:**
- Consumes: `JobOptions` (Task 2)
- Produces:
  - `SLOW_JOB_MS = 30_000`
  - `interface SlowJobState { slow: boolean; label: string | null }`
  - `createSlowJob(onChange: (s: SlowJobState) => void, slowAfterMs?: number)`, returning `{ start(): Required<JobOptions>; cancel(): void; finish(): void }`
    - `start()` aborts any job it started before, since a new one supersedes it.
    - `finish()` ends the current job without aborting.
    - Progress from a superseded job is ignored.
  - `useSlowJob(): SlowJobState & { start(): Required<JobOptions>; cancel(): void; finish(): void }`, which cancels on unmount
  - `<SlowJobNotice slow label onCancel />`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/slowJob.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSlowJob, SLOW_JOB_MS, SlowJobState } from '../../services/slowJob';

describe('slow job', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('turns slow after 30 s, with the latest step, and resets when finished', () => {
    const states: SlowJobState[] = [];
    const job = createSlowJob((s) => states.push(s));
    const { onProgress } = job.start();
    onProgress('Recovering 3D geometry');
    vi.advanceTimersByTime(SLOW_JOB_MS - 1);
    expect(states.at(-1)).toEqual({ slow: false, label: 'Recovering 3D geometry' });
    vi.advanceTimersByTime(1);
    expect(states.at(-1)).toEqual({ slow: true, label: 'Recovering 3D geometry' });
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

  it("ignores progress from a superseded job", () => {
    const states: SlowJobState[] = [];
    const job = createSlowJob((s) => states.push(s));
    const stale = job.start();
    job.start();
    stale.onProgress('Old step');
    expect(states.at(-1)!.label).toBe(null);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/slowJob.test.ts`
Expected: FAIL, "Failed to resolve import ../../services/slowJob"

- [ ] **Step 3: Write the controller**

```ts
// services/slowJob.ts
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
      return { signal: own.signal, onProgress: (label: string) => controller === own && set({ label }) };
    },
    cancel() {
      controller?.abort();
      stop();
    },
    finish: stop,
  };
};
```

- [ ] **Step 4: Write the hook and the notice**

```ts
// components/useSlowJob.ts
import { useEffect, useRef, useState } from 'react';
import { createSlowJob, SlowJobState } from '../services/slowJob';

/** A screen's analysis job (see services/slowJob.ts); cancelled when the screen unmounts. */
export const useSlowJob = () => {
  const [state, setState] = useState<SlowJobState>({ slow: false, label: null });
  const job = useRef<ReturnType<typeof createSlowJob> | null>(null);
  if (!job.current) job.current = createSlowJob(setState);
  useEffect(() => () => job.current!.cancel(), []);
  return { ...state, start: job.current.start, cancel: job.current.cancel, finish: job.current.finish };
};
```

```tsx
// components/SlowJobNotice.tsx
import React from 'react';

/** "Still working — <step>… (Cancel)", once a job has run past SLOW_JOB_MS. */
export const SlowJobNotice: React.FC<{ slow: boolean; label: string | null; onCancel: () => void }> = ({ slow, label, onCancel }) =>
  slow ? (
    <p data-testid="slow-job-notice" className="flex items-center gap-2 text-[11px] text-amber-300/90">
      {/* Stage labels already end in "…" */}
      Still working — {label ?? 'analysing the photo…'}
      <button type="button" onClick={onCancel} className="underline hover:text-amber-200">
        Cancel
      </button>
    </p>
  ) : null;
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/slowJob.test.ts && npm run typecheck && npm test`
Expected: PASS (3 tests), clean, all pass

- [ ] **Step 6: Commit**

```bash
git add services/slowJob.ts components/useSlowJob.ts components/SlowJobNotice.tsx tests/unit/slowJob.test.ts
git commit -m "Add slow-job controller, hook and Still working notice"
```

---

### Task 6: Wire jobs into the four waiting screens

**Files:**
- Modify: `App.tsx`, `components/DetectedItems.tsx`, `components/SurfaceReviewModal.tsx`, `components/ShowcaseEditorModal.tsx`, `components/AreaEditor.tsx`

**Interfaces:**
- Consumes:
  - `useSlowJob` and `SlowJobNotice` (Task 5)
  - `isAbortError` and the `options` parameters (Task 4)

The same pattern applies at every call site:
- Get `const { signal, onProgress } = job.start()` before the call and pass both to it.
- Call `job.finish()` on success or error.
- Return silently if `isAbortError(err)`.
- In an effect, call `job.cancel()` in the cleanup, instead of only setting `cancelled = true`.

- [ ] **Step 1: Studio room analysis (`App.tsx`, `components/DetectedItems.tsx`)**

In `App.tsx` add `const analysisJob = useSlowJob();` next to the other state, and import `useSlowJob`, `SlowJobNotice` and `isAbortError`. In the analysis effect (the one calling `analyzeRoom(uploadedImageUrl)`, about line 590):

```ts
    setDetectedItems([]);
    setAnalyzing(true);
    const { signal, onProgress } = analysisJob.start();
    analyzeRoom(uploadedImageUrl, { signal, onProgress: (label) => (onProgress(label), setAnalysisProgress(label)) })
      .then(({ items, warnings }) => {
        if (cancelled) return;
        // (existing body unchanged)
      })
      .catch((err: unknown) => {
        if (cancelled || isAbortError(err)) return;
        setAnalysisError(errorText(err, 'Could not analyze this photo.'));
      })
      .finally(() => {
        if (cancelled) return;
        analysisJob.finish();
        setAnalyzing(false);
        setAnalysisProgress(null);
      });
    return () => {
      cancelled = true;
      analysisJob.cancel(); // a new photo (or the vendor's room after sign-in) supersedes this one
    };
```

Pass the notice to `DetectedItems` (at about line 824): add the props `analysisSlow={analysisJob.slow}` and `onCancelAnalysis={analysisJob.cancel}`. In `components/DetectedItems.tsx`:
- add `analysisSlow?: boolean; onCancelAnalysis?: () => void;` to the props interface and destructuring, and import `SlowJobNotice`
- right after the `{analyzing && (<p …>…</p>)}` block, add:

```tsx
      {analyzing && onCancelAnalysis && <SlowJobNotice slow={Boolean(analysisSlow)} label={progressLabel ?? null} onCancel={onCancelAnalysis} />}
```

When the user cancels, the effect's `.catch` sees an AbortError and stays silent. Also set the error that the user stopped it, by changing the notice's `onCancel` in App to:

```tsx
onCancelAnalysis={() => {
  analysisJob.cancel();
  setAnalyzing(false);
  setAnalysisError('Analysis stopped — pick the photo again to retry.');
}}
```

- [ ] **Step 2: Studio surface resolution (`App.tsx`)**

Add `const surfaceJob = useSlowJob();`. In `resolveSelected`, change to:

```ts
  const resolveSelected = async (imageUrl: string) => {
    const selected = detectedItems.filter((item) => selectedItemIds.has(item.id));
    const job = surfaceJob.start();
    try {
      const resolved = await Promise.all(selected.map((item) => resolveSurface(imageUrl, item, job)));
      setDetectedItems((prev) => prev.map((item) => resolved.find((r) => r.item.id === item.id)?.item ?? item));
      return resolved;
    } finally {
      surfaceJob.finish();
    }
  };
```

In `applyMaterial` and `handleShowSelectedArea`, make their `catch` blocks return early on `isAbortError(err)`, before setting an error message. Right below `<ResultDisplay …/>`, render:

```tsx
            <SlowJobNotice slow={surfaceJob.slow} label={surfaceJob.label} onCancel={surfaceJob.cancel} />
```

- [ ] **Step 3: Studio surface check (`components/SurfaceReviewModal.tsx`)**

Add `const job = useSlowJob();`. In the cut effect:

```ts
    const { signal, onProgress } = job.start();
    cutSurface(imageUrl, item.anchor, { label: item.surfaceLabel, debugStages: showDebugTools, signal, onProgress })
      .then((result) => {
        if (cancelled) return;
        job.finish();
        setLoaded({ cut: result, imageUrl, anchor: item.anchor, label: item.surfaceLabel });
        setEdited(unionMasks(result.parts.map((p) => p.mask)));
      })
      .catch((err: unknown) => {
        if (cancelled || isAbortError(err)) return;
        job.finish();
        setError(err instanceof Error ? err.message : 'Could not load the area.');
      });
    return () => {
      cancelled = true;
      job.cancel();
    };
```

Under the "Loading the area…" paragraph, add `<SlowJobNotice slow={job.slow} label={job.label} onCancel={onClose} />`. Cancelling closes the check; unmounting cancels the job.

- [ ] **Step 4: Showcase editor (`components/ShowcaseEditorModal.tsx`)**

Add `const analysisJob = useSlowJob();` and `const detectJob = useSlowJob();`.

- **Analysis effect** (about line 157): start `analysisJob` and pass `{ signal, onProgress }` to `analyzeRoom`. The catch ignores `isAbortError`. On success or error, call `analysisJob.finish()`. The cleanup calls `analysisJob.cancel()`.
- **`detectArea`:**

```ts
    const { signal, onProgress } = detectJob.start(); // supersedes an earlier detection
    try {
      const cut = await cutSurface(selectedImage.imageUrl, point, { label, connectedOnly: connected, debugStages: showDebugTools, signal, onProgress });
      if (request !== areaRequest.current) return;
      detectJob.finish();
      // (existing success body unchanged)
    } catch (err) {
      if (request !== areaRequest.current || isAbortError(err)) return;
      detectJob.finish();
      setAreaStatus('error');
      setAreaError(err instanceof Error ? err.message : 'Could not detect a surface here.');
    }
```

- **`resetArea`:** add `detectJob.cancel();`.
- **"Detecting surface…" label** (about line 825): replace the text `Detecting surface…` with `{detectJob.label ?? 'Detecting surface…'}`. Stage labels already end in "…". Right after its containing element, add `<SlowJobNotice slow={detectJob.slow} label={detectJob.label} onCancel={resetArea} />`.

- [ ] **Step 5: Area Editor object tools (`components/AreaEditor.tsx`)**

Add `const objectJob = useSlowJob();`. In `runObjectTool`:
- replace `await cutObject(imageUrl, toPct(p))` with `await cutObject(imageUrl, toPct(p), objectJob.start())`
- in the `catch`, add `if (isAbortError(err)) return;` as the first line
- in the `finally`, call `objectJob.finish()`

The hook cancels on unmount. Show the notice at the end of the status row, right after the `{pending && (…)}` block:

```tsx
        <SlowJobNotice slow={objectJob.slow} label={objectJob.label} onCancel={objectJob.cancel} />
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm test && npx playwright test tests/e2e/`
Expected: clean, all unit tests pass, and all e2e specs pass. `pipeline-evidence` is skipped. The existing flows use the default no-cancel paths.

- [ ] **Step 7: Commit**

```bash
git add App.tsx components/DetectedItems.tsx components/SurfaceReviewModal.tsx components/ShowcaseEditorModal.tsx components/AreaEditor.tsx
git commit -m "Cancel superseded analysis jobs and offer Cancel on slow ones in every waiting screen"
```

---

### Task 7: E2E, switching photos cancels the old analysis

**Files:**
- Create: `tests/e2e/analysis-cancel.spec.ts`

**Interfaces:**
- Consumes: the studio (`#room-file-input`, `[id^="detected-item-"]`) and the cached photo `tests/e2e/.cache/room.jpg`

- [ ] **Step 1: Write the test**

```ts
// tests/e2e/analysis-cancel.spec.ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

// Starting a new photo while the previous one is still being analysed cancels the old job: the
// worker is told to stop it, its result never lands, the new photo's surfaces appear, no errors.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PHOTO = path.join(HERE, '.cache', 'room.jpg'); // cached by studio-flow.spec.ts

test('switching photos mid-analysis cancels the old job', async ({ page }) => {
  test.setTimeout(8 * 60_000);
  test.skip(!fs.existsSync(path.join(HERE, '../../public/models')), 'local models missing — run npm run assets:fetch');
  test.skip(!fs.existsSync(PHOTO), 'room photo not cached — run studio-flow.spec.ts once');

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // Record what the page sends the analysis worker
  await page.addInitScript(() => {
    const sent: unknown[] = [];
    (window as unknown as { __workerSent: unknown[] }).__workerSent = sent;
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (this: Worker, msg: unknown, ...rest: unknown[]) {
      sent.push(msg);
      return (post as (...a: unknown[]) => void).call(this, msg, ...rest);
    };
  });

  // The studio starts analysing its default demo room; switch to an upload straight away
  await page.goto('/studio');
  await expect.poll(() => page.evaluate(() => (window as any).__workerSent.length), { timeout: 60_000 }).toBeGreaterThan(0);
  await page.locator('#room-file-input').setInputFiles(PHOTO);

  await expect(page.locator('[id^="detected-item-"]').first()).toBeVisible({ timeout: 6 * 60_000 });
  const sent = await page.evaluate(() => (window as any).__workerSent as Array<{ type: string; target?: number; id: number }>);
  const firstAnalyze = sent.find((m) => m.type === 'analyze')!;
  expect(sent.some((m) => m.type === 'cancel' && m.target === firstAnalyze.id)).toBe(true);
  await expect(page.locator('p.text-rose-300')).toHaveCount(0);
  expect(errors).toEqual([]);
});
```

- [ ] **Step 2: Run it**

Run: `npx playwright test tests/e2e/analysis-cancel.spec.ts`
Expected: PASS. If the first analysis finishes before the upload (for example, a warm cache), the cancel may not be sent. In that case, clear IndexedDB first with `await page.addInitScript(() => indexedDB.deleteDatabase('material-visualizer-analysis'))`, using the database name from `services/analysis/analysisCache.ts`, and re-run.

- [ ] **Step 3: Full suite**

Run: `npx playwright test tests/e2e/`
Expected: all specs pass (`pipeline-evidence` skipped).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/analysis-cancel.spec.ts
git commit -m "E2E: switching photos mid-analysis cancels the old job"
```

---

### Task 8: Docs

**Files:**
- Modify: `CLAUDE.md`, `PROJECT.md`

- [ ] **Step 1: CLAUDE.md**

In the "Rendering pipeline", step 1 ("Room analysis"), after the sentence about caching in IndexedDB, add:

> Every call (`analyzeRoom`, `cutSurface`, `cutObject`, `resolveSurface`) takes `{ signal, onProgress }` (`services/analysis/workerClient.ts`). An aborted job is stopped by the worker at its next step, and a photo load shared by several jobs stops only when all of them cancel. Jobs have hard limits: `analyze` 5 min, `cut` and `cutObject` 3 min. Past a limit the worker is terminated, pending jobs fail with "This took too long — try again", and a fresh worker starts. Screens use `useSlowJob` and `SlowJobNotice`, which show "Still working… (Cancel)" after 30 s; starting a new job supersedes the previous one.

In the Commands list, add `analysis-cancel.spec.ts` after `storefront-consistency.spec.ts`: "`analysis-cancel.spec.ts` checks that switching photos mid-analysis cancels the old job".

- [ ] **Step 2: PROJECT.md**

Rewrite "Current state" and "Roadmap" to match the code:

- **Materials:** a signed-in tenant sees only its own materials. `GET /api/materials` and the public endpoint both exclude the shared defaults.
- **Admin and landing:** platform admin approval (`/admin`), category-scoped vendors, and a landing page (`/`) exist.
- **Hotspots:** repositioning already works. In the showcase editor, clicking the photo while editing a hotspot moves it and re-detects the surface. Remove it from the roadmap.
- **Rendering:** add these to what's done:
  - surface evidence, the review reasons, Protect object and Include area
  - the storefront consistency test
  - cancellation and time limits
- **Roadmap order:**
  1. 60-photo validation set and quality dashboard
  2. multi-user tenant invites
  3. billing
  4. rendering phase 3, once a GPU host exists (SAM 3.1 and MoGe-3 benchmark, MatSwap)
  5. privacy and retention controls for customer photos

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md PROJECT.md
git commit -m "Docs: analysis cancellation and time limits; bring PROJECT.md up to date"
```
