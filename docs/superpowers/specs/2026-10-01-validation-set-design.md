# Validation set and quality dashboard

Date: 2026-10-01. Rendering plan phase 4 ("Build the validation set and quality dashboard").

## Problem

Surface quality is only measured today on the 5 curated rooms: the opt-in evidence run (`tests/e2e/pipeline-evidence.spec.ts`). That run compares the pipeline with SegFormer's class map, and the class map is itself often wrong: rugs labelled floor, picture mats labelled wall. Nothing says what the *correct* area is. So the confidence thresholds (`services/qualityGate.ts`: auto ≥ 0.85, confirm ≥ 0.65) are uncalibrated, and a pipeline change can't be judged against real answers.

## Decisions (user)

- **Photos:** free-licence Unsplash/Pexels photos. Only a URL manifest is committed; the photos themselves go into a git-ignored cache.
- **Ground truth:** masks are approved by a person in the app, with the existing Area Editor.
- **Dashboard:** a dev-only page, plus a history file in the repo.
- **Scope:** masks only for now. Planes, scale references and reference materials come later.

## Design

### 1. The set (`validation/`, committed)

- **`validation/manifest.json`:** an array of `{ id, url, source: 'unsplash' | 'pexels', credit, category, surfaces: string[] }`.
  - `category` is one of `wall | floor | cabinet-door | countertop | hard`.
  - `surfaces` are ADE20K labels to score, for example `["wall"]`, `["floor"]`, `["cabinet"]` or `["countertop", "kitchen island"]`.
  - The target mix is about 60 photos: 20 wall, 15 floor, 10 cabinet or door, 10 countertop, 5 hard (plants, mirrors, curtains, strong shadows, oblique angles). The 5 curated rooms are included.
- **`npm run validation:fetch`** (`scripts/fetchValidation.mjs`): downloads each photo to `validation/.cache/<id>.jpg` (git-ignored) and skips files it already has. It reports failures and never fails silently.
- **`validation/approved/<id>__<surface>.png`:** the approved mask. It is photo-sized, white where the surface is, black elsewhere, a hard 0/255 edge. It sits next to **`<id>__<surface>.json`**, which holds `{ approvedAt, analysisVersion, notes? }`. Both are committed.
- **Manifest validation:** a pure function checks that ids are unique, categories and sources are valid, `surfaces` is non-empty and URLs are `https`. A unit test runs it against the committed manifest.

### 2. Approve tool (dev only)

- **Route:** `/dev/validation`, registered in `index.tsx` only when `import.meta.env.DEV`, so it's absent from the production build.
- **Page** (`components/dev/ValidationApprovePage.tsx`):
  - lists the manifest's surfaces with approved and missing status, filterable by category
  - opening one loads the cached photo (served by the dev server from `/validation-cache/<id>.jpg`), then runs `analyzeRoom` and `cutSurface` for that label at its proposal anchor
  - opens the **Area Editor** with the union of parts, starting from an existing approved mask if there is one
  - **Approve** thresholds the edit at alpha > 127 to a hard mask and posts it
- **Dev-server endpoint** (a Vite plugin in `vite.config.ts`, `apply: 'serve'`):
  - `POST /__validation/approve` writes the PNG and the JSON into `validation/approved/`. The id and surface are checked against the manifest, so no other path can be written.
  - `GET /validation-cache/*` serves the cached photos.
- If the pipeline proposes no surface with that label, the page starts from an empty mask. The approver then draws it with polygon and brush.

### 3. Scoring

- **Command:** `npm run validation:score` = `VALIDATION=1 npx playwright test tests/e2e/validation-score.spec.ts`. It's opt-in and uses the real models.
- **The run:** a harness page (`tests/e2e/validation/harness.ts`) runs the app's own `analyzeRoom` and `cutSurface` (with `debugStages`) on each approved surface. It then compares the final render mask with the approved mask.
- **Metrics** live in a pure, unit-tested module, `services/validation/metrics.ts`, with areas in % of photo:
  - **coverage:** approved pixels the pipeline covers, as a share of the approved area
  - **leak:** pipeline pixels outside the approved area, as a share of the approved area
  - **IoU**
  - **boundary F-score:** boundary pixels matched within 2 px
  - **stage attribution:** for each missed or leaked pixel, the pipeline stage that last removed or added it (reusing the stage logic from the evidence harness, moved into `metrics.ts`)
  - **decision correctness:**
    - `auto` with IoU < 0.9 is a **false auto**, the dangerous case
    - `correct` with IoU ≥ 0.9 is a **needless correction**
- **Outputs:**
  - `validation/results/latest.json`, per surface and per category (git-ignored; large)
  - overlays in `validation/.cache/overlays/`
  - one appended line in **`validation/history.jsonl`** (committed): `{ date, commit, analysisVersion, surfaces, meanIoU, meanCoverage, meanLeak, falseAuto, byCategory }`
- **Threshold calibration:** the run reports, for candidate `auto` thresholds (0.75–0.95 in 0.05 steps), how many surfaces would be auto and how many of those would be false autos. This is the evidence for changing `CONFIDENCE_THRESHOLDS`, which the run itself never changes.

### 4. Dashboard (dev only)

- **Route:** `/dev/validation/results` (`components/dev/ValidationDashboardPage.tsx`), fed by `GET /__validation/results` (latest.json plus history.jsonl) from the same Vite plugin.
- **Contents:**
  - headline numbers: mean IoU, coverage, leak, false autos
  - a per-category table
  - the surfaces sorted worst IoU first, each with its overlay (missed in red, leaked in magenta) and its top failing stage
  - the threshold calibration table
  - a small trend chart of mean IoU and false autos across the history lines, as inline SVG with no chart library

### 5. Testing

- **Unit (Vitest):**
  - `metrics.ts`: coverage, leak, IoU, boundary F-score on synthetic masks; stage attribution; decision correctness; threshold calibration
  - manifest validation of the committed manifest
  - the history line builder
- **Playwright:** `validation-approve.spec.ts` opens `/dev/validation` with a stubbed approve endpoint (`page.route`). It checks that one cached photo loads, the Area Editor opens and Approve posts a photo-sized binary PNG. It skips if the models or the cached photo are missing.
- **Scoring:** the scoring spec is opt-in and skipped by default, like the evidence run.

## Out of scope

- planes, scale references and reference materials per photo
- running in CI
- a production admin dashboard
- changing `CONFIDENCE_THRESHOLDS` (that needs the calibration evidence first)
