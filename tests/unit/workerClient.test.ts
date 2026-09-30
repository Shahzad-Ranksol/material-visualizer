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
    const err = await c.send(analyze, { signal: ctrl.signal }).catch((e: unknown) => e);
    expect(isAbortError(err)).toBe(true);
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
