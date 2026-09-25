# Analysis reliability: cancel, time limits, per-job progress

Date: 2026-09-25. Rendering plan phase 4 ("cancellation, progress reporting, timeouts").

## Problem

All models run in one Web Worker on the user's device (`workers/analysis.worker.ts`, client in `services/roomAnalysis.ts`).

- **Nothing gives up.** `analyzeRoom`, `cutSurface` and `cutObject` wait forever. A stuck model step, like the `post_process_masks` hang fixed in 13bef3c, leaves "Detecting surface…" spinning forever.
- **Nothing cancels.** The UI "cancels" by ignoring a result. The worker keeps computing the abandoned photo and competes for CPU with the one on screen. Example: a vendor signing in while the demo room is still being analysed.
- **Progress is global.** `onAnalysisProgress` is one module-wide listener, shown only in the studio's detected-items list. The showcase editor, the surface check and Area Editor's Cut/Add show a bare spinner.

## Decisions

- **Slow jobs** (user's choice): after **30 s**, show "Still working — <step>… (Cancel)". At a hard limit, stop with **"This took too long — try again"**.
- **Hard limits**, timed from when the job is sent:
  - `analyze`: **5 min**. The first photo also loads the models.
  - `cut` and `cutObject`: **3 min**.
  - They're exported constants, so tests can use short ones.
- **How a job stops:**
  - **User cancel or superseded job:** cooperative. The worker stops at its next step boundary. A running model step can't be interrupted, so the CPU frees up after that step.
  - **Hard limit:** the worker is **terminated**, because it's probably stuck. Every job still pending in it rejects with the too-long error. The next request spawns a fresh worker, and the models reload from the HTTP cache. The per-photo analysis cache (IndexedDB) survives.

## Design

### 1. Worker client (`services/roomAnalysis.ts`)

- Every call takes an optional `JobOptions`: `{ signal?: AbortSignal; onProgress?: (label: string) => void }`. They are `analyzeRoom(url, opts)`, `cutSurface(url, point, { ...existing, ...opts })` and `cutObject(url, point, opts)`.
- `send(body, opts)`:
  - Registers `{ resolve, reject, onProgress, timer }` per id.
  - Arms a hard-limit timer. A progress message routes to that job's own `onProgress`.
  - **Abort:** clears the timer and removes the entry. It rejects with `new DOMException('Cancelled', 'AbortError')` and posts `{ type: 'cancel', id }`. An already-aborted signal rejects without posting the job at all.
  - **Hard limit:** calls `worker.terminate()` and sets `worker = null`. Every pending job rejects with `AnalysisTimeoutError` ("This took too long — try again").
  - `worker.onerror`, as today, rejects all pending jobs.
- `isAbortError(err)` helper; the UI ignores those.
- `onAnalysisProgress` is removed. Its only user is App.tsx, which moves to `onProgress`.

### 2. Protocol and worker

- `WorkerRequest` gains `{ id: number; type: 'cancel'; target: number }`.
- The worker keeps `cancelled: Set<number>`.
- `reportStage(stage)` is the step boundary. For a cancelled request it throws `Cancelled` instead of posting. Boundaries: loading-photo, from-cache, surfaces, geometry, refining, and a new `planes` check before plane fitting (no new label).
- A cancelled request posts nothing more. Its id leaves the set when its handler finishes.
- **Shared photo loads:** `rooms` entries track their waiting request ids. `loadRoom`'s internal step checks throw only when **every** waiter has cancelled. The entry is then deleted, as on any failure, so a later request starts clean. A job that cancels while others still wait just stops waiting.

### 3. UI

- A new hook, `components/useSlowJob.ts`: `useSlowJob()` returns `{ start(): { signal, onProgress }, cancel(), finish(), slow, label }`.
  - `slow` turns true 30 s after `start()`.
  - `label` is the latest step.
  - `cancel()` aborts the job.
- A shared `components/SlowJobNotice.tsx` renders "Still working — {label}… (Cancel)" when `slow`.
- Wired into:
  - **Studio room analysis (`App.tsx`):**
    - Aborts in the effect cleanup, so switching photos and the vendor sign-in swap cancel the old job.
    - Keeps showing the step label in `DetectedItems`.
    - Studio surface resolution (`resolveSurface` at render time) passes the same signal.
  - **`SurfaceReviewModal`:** aborts on unmount and on photo change.
  - **`ShowcaseEditorModal`:**
    - Aborts analysis on image change or close. Aborts detection when a new detection starts (replacing today's `areaRequest` counter check) or on close.
    - "Detecting surface…" shows the step label and the slow notice.
  - **`AreaEditor` Cut/Add:** aborts on unmount. The notice goes in the toolbar status line.
- Errors: an `AbortError` is silent. A timeout or other error shows the existing error UI with the message.

### 4. Testing

- **Unit tests (Vitest):** a fake `Worker` stubbed on `globalThis`, and fake timers. They cover:
  - progress routed to the right job
  - abort: rejects with `AbortError`, posts `cancel`, and a late result is ignored
  - an already-aborted signal: nothing posted
  - the hard limit: terminates the worker, rejects every pending job, and the next call spawns a new worker
- **Worker cancel logic:** the "every waiter cancelled" rule lives in a small pure helper, with its own unit tests.
- **Hook:** `useSlowJob` timing is covered with fake timers. The repo has no React testing library, so the hook's timing logic lives in a pure helper and the hook stays a thin wrapper.
- **E2E (`studio-flow` or a new spec):**
  - Load a photo, then switch to another before analysis finishes. The second analysis completes, the first job's result never appears, and no page errors occur.
  - The existing four specs stay green.

### 5. Docs

- `CLAUDE.md`: worker client options, time limits, cancellation.
- `PROJECT.md` is out of date and gets rewritten to match the current state:
  - a signed-in catalog is the tenant's own materials only
  - admin approval and the landing page exist
  - hotspot repositioning already works
  - roadmap order: validation set, invites, billing, phase 3

## Out of scope

- GPU worker queue.
- Retrying automatically.
- Interrupting a running model step (ONNX Runtime has no cancellation).
