# Validation Set Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A versioned set of ~60 free-licence room photos, with human-approved surface masks, lets a one-command run score the pipeline (coverage, leak, IoU, boundary accuracy, failing stage, false "auto" decisions). A dev-only dashboard shows the latest scores and their trend.

**Architecture:**
- **Data:** photo URLs, credits and categories live in a committed manifest (`validation/manifest.json`). Photos download into a git-ignored cache. Approved masks are committed PNGs.
- **Dev-only tools:** a Vite plugin (dev server only) serves the cache, writes approved masks and serves results to two dev-only pages: approve, and results.
- **Scoring:** a pure, unit-tested metrics module (`services/validation/metrics.ts`) does the maths. An opt-in Playwright run, like the evidence run, uses the real models and the app's own client code.

**Tech Stack:** React 19 + TypeScript + Vite 6 (a dev-server plugin), Node 25 scripts, Vitest (Node environment), Playwright.

Spec: `docs/superpowers/specs/2026-10-01-validation-set-design.md`.

## Global Constraints

- **Photos:** free-licence Unsplash only (skip Unsplash+ / premium). Record `credit` (photographer name and profile URL) for each. Photos are **never committed**; they go in `validation/.cache/` (git-ignored).
- **Approved masks:** `validation/approved/<id>__<surface>.png`, photo-sized, white = surface, black elsewhere, hard 0/255. The sidecar is `<id>__<surface>.json` = `{ approvedAt, analysisVersion, notes? }`.
- **Categories:** `wall | floor | cabinet-door | countertop | hard`. Target mix: 20 / 15 / 10 / 10 / 5.
- **Metrics** (areas in % of the photo): **coverage** (approved pixels covered ÷ approved), **leak** (covered pixels outside approved ÷ approved), **IoU**, and **boundary F-score** with 2 px tolerance.
  - **False auto:** decision `auto` with IoU < 0.9.
  - **Needless correction:** decision `correct` with IoU ≥ 0.9.
  - **Calibration:** candidate auto thresholds from 0.75 to 0.95 in 0.05 steps.
- **Dev only:** the `/dev/validation` and `/dev/validation/results` routes exist only when `import.meta.env.DEV`, and the plugin uses `apply: 'serve'`. The approve endpoint writes only ids and surfaces listed in the manifest.
- **No new npm dependencies.** Charts are inline SVG.
- **Checks:** `npm run typecheck` and `npm test` stay green after every task.
- **Commits:** end every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Manifest schema, validator and seed manifest

**Files:**
- Create: `services/validation/manifest.ts`, `validation/manifest.json`
- Modify: `.gitignore`
- Test: `tests/unit/validationManifest.test.ts`

**Interfaces:**
- Produces:
  - `type ValidationCategory = 'wall' | 'floor' | 'cabinet-door' | 'countertop' | 'hard'`
  - `interface ValidationPhoto { id: string; url: string; source: 'unsplash'; credit: string; category: ValidationCategory; surfaces: string[] }`
  - `validateManifest(photos: unknown): string[]` returns problems; an empty array means valid
  - `approvedName(id: string, surface: string): string` is `` `${id}__${surface.replace(/[^a-z0-9]+/gi, '-')}` ``
  - `isListed(photos: ValidationPhoto[], id: string, surface: string): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/validationManifest.test.ts
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { approvedName, isListed, validateManifest, ValidationPhoto } from '../../services/validation/manifest';

const ok: ValidationPhoto = { id: 'a1', url: 'https://images.unsplash.com/photo-1', source: 'unsplash', credit: 'Jane (https://unsplash.com/@jane)', category: 'wall', surfaces: ['wall'] };

describe('validation manifest', () => {
  it('accepts the committed manifest', () => {
    expect(validateManifest(JSON.parse(fs.readFileSync('validation/manifest.json', 'utf8')))).toEqual([]);
  });

  it('reports duplicates, bad categories, missing surfaces and non-https urls', () => {
    const bad = [ok, { ...ok }, { ...ok, id: 'b', category: 'roof' }, { ...ok, id: 'c', surfaces: [] }, { ...ok, id: 'd', url: 'http://x' }];
    const problems = validateManifest(bad);
    expect(problems.some((p) => p.includes('duplicate id "a1"'))).toBe(true);
    expect(problems.some((p) => p.includes('"b"') && p.includes('category'))).toBe(true);
    expect(problems.some((p) => p.includes('"c"') && p.includes('surfaces'))).toBe(true);
    expect(problems.some((p) => p.includes('"d"') && p.includes('https'))).toBe(true);
  });

  it('names approved masks safely and only for listed surfaces', () => {
    expect(approvedName('a1', 'kitchen island')).toBe('a1__kitchen-island');
    expect(isListed([ok], 'a1', 'wall')).toBe(true);
    expect(isListed([ok], 'a1', 'floor')).toBe(false);
    expect(isListed([ok], '../etc', 'wall')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/validationManifest.test.ts`
Expected: FAIL (the module is missing)

- [ ] **Step 3: Implement the module and seed the manifest**

```ts
// services/validation/manifest.ts
/**
 * The validation set: free-licence room photos (URL + credit, never the photo itself), each with
 * the surfaces to score. Approved masks live next to it in validation/approved/.
 */
export type ValidationCategory = 'wall' | 'floor' | 'cabinet-door' | 'countertop' | 'hard';
export const VALIDATION_CATEGORIES: ValidationCategory[] = ['wall', 'floor', 'cabinet-door', 'countertop', 'hard'];

export interface ValidationPhoto {
  id: string;
  url: string;
  source: 'unsplash';
  // Photographer name and profile, as the licence asks
  credit: string;
  category: ValidationCategory;
  // ADE20K labels to score on this photo
  surfaces: string[];
}

export const validateManifest = (photos: unknown): string[] => {
  if (!Array.isArray(photos)) return ['the manifest must be an array'];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const p of photos as ValidationPhoto[]) {
    if (!p?.id || !/^[a-z0-9-]+$/i.test(p.id)) problems.push(`invalid id ${JSON.stringify(p?.id)}`);
    else if (seen.has(p.id)) problems.push(`duplicate id "${p.id}"`);
    seen.add(p?.id);
    if (!VALIDATION_CATEGORIES.includes(p?.category)) problems.push(`"${p?.id}": unknown category ${JSON.stringify(p?.category)}`);
    if (!Array.isArray(p?.surfaces) || p.surfaces.length === 0) problems.push(`"${p?.id}": surfaces must list at least one label`);
    if (typeof p?.url !== 'string' || !p.url.startsWith('https://')) problems.push(`"${p?.id}": url must be https`);
    if (p?.source !== 'unsplash') problems.push(`"${p?.id}": source must be "unsplash"`);
    if (!p?.credit) problems.push(`"${p?.id}": missing credit`);
  }
  return problems;
};

export const approvedName = (id: string, surface: string) => `${id}__${surface.replace(/[^a-z0-9]+/gi, '-')}`;

export const isListed = (photos: ValidationPhoto[], id: string, surface: string) =>
  photos.some((p) => p.id === id && p.surfaces.includes(surface));
```

Create `validation/manifest.json` with the five curated rooms. Their Unsplash URLs are in `constants.ts` (`CURATED_ROOMS[].fullImage`). Make each entry `{ "id": "<room.id>", "url": "<fullImage>", "source": "unsplash", "credit": "Unsplash (curated demo room)", "category": ..., "surfaces": [...] }`, with category and surfaces as follows:

| Room | Category | Surfaces |
|---|---|---|
| `minimalist-living` | `hard` | `["wall", "floor"]` (mirror, rug, sun shadows) |
| `nordic-master-bedroom` | `wall` | `["wall", "floor"]` |
| `penthouse-dining-room` | `wall` | `["wall", "floor"]` |
| `executive-atelier-office` | `wall` | `["wall", "floor"]` |

Leave out `culinary-marble-kitchen`: it's an exterior photo.

Append to `.gitignore`:

```
# Validation photos and run output (validation/manifest.json and validation/approved/ are committed)
validation/.cache/
validation/results/
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/validationManifest.test.ts && npm run typecheck`
Expected: PASS (3), clean

- [ ] **Step 5: Commit**

```bash
git add services/validation/manifest.ts validation/manifest.json .gitignore tests/unit/validationManifest.test.ts
git commit -m "Add validation set manifest, validator and seed photos"
```

---

### Task 2: Fetch and find scripts

**Files:**
- Create: `scripts/fetchValidation.mjs`, `scripts/findValidationPhotos.mjs`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: `validation/manifest.json` (Task 1)
- Produces:
  - `npm run validation:fetch` fills `validation/.cache/<id>.jpg`
  - `npm run validation:find` appends free Unsplash candidates to the manifest

- [ ] **Step 1: Fetch script**

```js
// scripts/fetchValidation.mjs
// Downloads the validation photos (validation/manifest.json) into the git-ignored
// validation/.cache/<id>.jpg. Idempotent; reports every failure and exits non-zero on any.
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const photos = JSON.parse(await readFile(join(root, 'validation/manifest.json'), 'utf8'));
const exists = (p) => stat(p).then(() => true, () => false);
let failed = 0;
for (const p of photos) {
  const dest = join(root, 'validation/.cache', `${p.id}.jpg`);
  if (await exists(dest)) {
    console.log(`present    ${p.id}`);
    continue;
  }
  try {
    const res = await fetch(p.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, Buffer.from(await res.arrayBuffer()));
    console.log(`downloaded ${p.id}`);
  } catch (err) {
    failed++;
    console.error(`FAILED     ${p.id}: ${err.message}`);
  }
}
if (failed) process.exit(1);
```

- [ ] **Step 2: Find script (Unsplash API, free licence only)**

```js
// scripts/findValidationPhotos.mjs
// Fills the validation set towards the plan's mix (20 wall, 15 floor, 10 cabinet-door,
// 10 countertop, 5 hard) with free-licence Unsplash photos, credited. Needs a free Unsplash
// developer Access Key in .env as UNSPLASH_ACCESS_KEY. Unsplash+ (premium) photos are skipped.
// Review the added photos in /dev/validation and delete any that don't fit.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const key = process.env.UNSPLASH_ACCESS_KEY;
if (!key) {
  console.error('Set UNSPLASH_ACCESS_KEY in .env (free key from https://unsplash.com/developers).');
  process.exit(1);
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, 'validation/manifest.json');
const photos = JSON.parse(await readFile(file, 'utf8'));

const TARGET = { wall: 20, floor: 15, 'cabinet-door': 10, countertop: 10, hard: 5 };
const SEARCH = {
  wall: { queries: ['living room interior wall', 'bedroom interior', 'empty room interior wall', 'dining room interior'], surfaces: ['wall'] },
  floor: { queries: ['living room floor interior', 'hardwood floor room', 'tiled floor interior', 'empty room floor'], surfaces: ['floor'] },
  'cabinet-door': { queries: ['kitchen cabinets', 'wardrobe interior', 'interior door hallway'], surfaces: ['cabinet'] },
  countertop: { queries: ['kitchen countertop', 'kitchen island interior', 'bathroom vanity countertop'], surfaces: ['countertop'] },
  hard: { queries: ['room with mirror interior', 'room curtains sunlight', 'living room plants interior', 'wide angle room interior'], surfaces: ['wall', 'floor'] },
};

const have = new Set(photos.map((p) => p.id));
for (const [category, { queries, surfaces }] of Object.entries(SEARCH)) {
  let count = photos.filter((p) => p.category === category).length;
  for (const q of queries) {
    if (count >= TARGET[category]) break;
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=30&orientation=landscape&content_filter=high`;
    const res = await fetch(url, { headers: { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' } });
    if (!res.ok) {
      console.error(`search "${q}": HTTP ${res.status}`);
      continue;
    }
    for (const r of (await res.json()).results) {
      if (count >= TARGET[category]) break;
      if (r.premium || r.plus || have.has(r.id)) continue;
      photos.push({
        id: r.id,
        url: `${r.urls.raw}&w=1600&q=85&fm=jpg&fit=max`,
        source: 'unsplash',
        credit: `${r.user.name} (${r.user.links.html})`,
        category,
        surfaces,
      });
      have.add(r.id);
      count++;
    }
  }
  console.log(`${category}: ${count}/${TARGET[category]}`);
}
await writeFile(file, JSON.stringify(photos, null, 2) + '\n');
```

- [ ] **Step 3: npm scripts**

In `package.json` `"scripts"`, after `"assets:fetch"`, add:

```json
    "validation:fetch": "node scripts/fetchValidation.mjs",
    "validation:find": "node --env-file-if-exists=.env scripts/findValidationPhotos.mjs",
    "validation:score": "VALIDATION=1 playwright test tests/e2e/validation-score.spec.ts",
```

- [ ] **Step 4: Verify**

Run: `npm run validation:fetch`
Expected: `downloaded` (or `present`) for the 4 seed photos; `ls validation/.cache` shows 4 jpgs.

Run: `npm run validation:find` without the key.
Expected: the key message and exit code 1. With a key, it reports per-category counts. That's the user's step.

Run: `npm run typecheck && npm test`
Expected: clean, all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/fetchValidation.mjs scripts/findValidationPhotos.mjs package.json
git commit -m "Add validation photo fetch and Unsplash find scripts"
```

---

### Task 3: Metrics (pure)

**Files:**
- Create: `services/validation/metrics.ts`
- Test: `tests/unit/validationMetrics.test.ts`

**Interfaces:**
- Consumes: `CUT_STAGES`, `CutStage` (`services/analysis/protocol.ts`); `ReviewDecision` (`services/qualityGate.ts`)
- Produces:
  - `interface MaskScore { coverage: number; leak: number; iou: number; boundaryF: number; approvedPct: number; predictedPct: number }`
  - `scoreMasks(predicted: Uint8Array, approved: Uint8Array, w: number, h: number, tolerancePx = 2): MaskScore`, where both masks are binary 0/1 and coverage, leak and IoU are 0–1
  - `lastTransition(stages: Record<CutStage, Uint8Array>, i: number, wanted: 0 | 1): CutStage`, the stage that last made pixel `i` equal `wanted`
  - `attribute(stages: Record<CutStage, Uint8Array>, predicted: Uint8Array, approved: Uint8Array): { missedBy: Record<string, number>; leakedBy: Record<string, number> }`, as pixel counts
  - `decisionOutcome(decision: ReviewDecision, iou: number): 'ok' | 'false-auto' | 'needless-correction'`
  - `calibrate(rows: Array<{ confidence: number; iou: number }>, thresholds = [0.75, 0.8, 0.85, 0.9, 0.95]): Array<{ threshold: number; auto: number; falseAuto: number }>`
  - `FALSE_AUTO_IOU = 0.9`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/validationMetrics.test.ts
import { describe, expect, it } from 'vitest';
import { attribute, calibrate, decisionOutcome, lastTransition, scoreMasks } from '../../services/validation/metrics';
import { CUT_STAGES, CutStage } from '../../services/analysis/protocol';

const W = 20;
const H = 10;
const rect = (x0: number, x1: number) => Uint8Array.from({ length: W * H }, (_, i) => (i % W >= x0 && i % W < x1 ? 1 : 0));

describe('scoreMasks', () => {
  it('is perfect for identical masks', () => {
    const m = rect(5, 15);
    expect(scoreMasks(m, m, W, H)).toMatchObject({ coverage: 1, leak: 0, iou: 1, boundaryF: 1 });
  });

  it('measures coverage and leak against the approved area', () => {
    // approved 10 columns; predicted 8 of them plus 2 outside
    const s = scoreMasks(rect(7, 17), rect(5, 15), W, H);
    expect(s.coverage).toBeCloseTo(0.8, 9);
    expect(s.leak).toBeCloseTo(0.2, 9);
    expect(s.iou).toBeCloseTo(80 / 120, 9);
  });

  it('forgives boundary offsets within the tolerance', () => {
    expect(scoreMasks(rect(6, 16), rect(5, 15), W, H, 2).boundaryF).toBe(1);
    expect(scoreMasks(rect(9, 19), rect(5, 15), W, H, 2).boundaryF).toBeLessThan(0.5);
  });

  it('is zero, not NaN, when nothing is approved', () => {
    const none = new Uint8Array(W * H);
    expect(scoreMasks(rect(0, 5), none, W, H)).toMatchObject({ coverage: 0, iou: 0 });
  });
});

describe('stage attribution', () => {
  const stages = Object.fromEntries(CUT_STAGES.map((s) => [s, rect(0, 10)])) as Record<CutStage, Uint8Array>;
  // SAM also took columns 10-12; the band step dropped column 9
  stages.samRaw = rect(0, 13);
  for (const s of CUT_STAGES.slice(CUT_STAGES.indexOf('samAfterExclusions'))) stages[s] = rect(0, 13);
  for (const s of CUT_STAGES.slice(CUT_STAGES.indexOf('bandRefined'))) stages[s] = Uint8Array.from(rect(0, 13), (v, i) => (i % W === 9 ? 0 : v));

  it('names the stage that last changed a pixel', () => {
    expect(lastTransition(stages, 5 * W + 11, 1)).toBe('samRaw');
    expect(lastTransition(stages, 5 * W + 9, 0)).toBe('bandRefined');
  });

  it('counts misses and leaks by stage', () => {
    const r = attribute(stages, stages.onPlane, rect(0, 10));
    expect(r.missedBy).toEqual({ bandRefined: H });
    expect(r.leakedBy).toEqual({ samRaw: 3 * H });
  });
});

describe('decisions and calibration', () => {
  it('flags a bad mask marked auto, and a good one sent to correction', () => {
    expect(decisionOutcome('auto', 0.95)).toBe('ok');
    expect(decisionOutcome('auto', 0.7)).toBe('false-auto');
    expect(decisionOutcome('correct', 0.95)).toBe('needless-correction');
    expect(decisionOutcome('confirm', 0.5)).toBe('ok');
  });

  it('reports autos and false autos per threshold', () => {
    const rows = [
      { confidence: 0.9, iou: 0.95 },
      { confidence: 0.86, iou: 0.6 },
      { confidence: 0.7, iou: 0.95 },
    ];
    expect(calibrate(rows, [0.85, 0.9])).toEqual([
      { threshold: 0.85, auto: 2, falseAuto: 1 },
      { threshold: 0.9, auto: 1, falseAuto: 0 },
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/validationMetrics.test.ts`
Expected: FAIL (the module is missing)

- [ ] **Step 3: Implement**

```ts
// services/validation/metrics.ts
import { CUT_STAGES, CutStage } from '../analysis/protocol';
import type { ReviewDecision } from '../qualityGate';

/** Scoring a predicted surface mask against a person-approved one (validation set). */
export interface MaskScore {
  coverage: number; // approved pixels covered ÷ approved
  leak: number; // predicted pixels outside the approved area ÷ approved
  iou: number;
  boundaryF: number; // boundary pixels matched within the tolerance (F1)
  approvedPct: number; // approved area, % of the photo
  predictedPct: number;
}

// Below this IoU an area needs a person: marked 'auto' it would reach customers unchecked
export const FALSE_AUTO_IOU = 0.9;

const boundary = (m: Uint8Array, w: number, h: number) => {
  const out = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) {
    if (!m[i]) continue;
    const x = i % w;
    const y = (i - x) / w;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !m[i - 1] || !m[i + 1] || !m[i - w] || !m[i + w]) out[i] = 1;
  }
  return out;
};

// Share of `from`'s boundary pixels with a boundary pixel of `to` within r (Chebyshev)
const matched = (from: Uint8Array, to: Uint8Array, w: number, h: number, r: number) => {
  let total = 0;
  let hit = 0;
  for (let i = 0; i < from.length; i++) {
    if (!from[i]) continue;
    total++;
    const x = i % w;
    const y = (i - x) / w;
    search: for (let dy = -r; dy <= r; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx;
        if (xx >= 0 && xx < w && to[yy * w + xx]) {
          hit++;
          break search;
        }
      }
    }
  }
  return total ? hit / total : 1;
};

export const scoreMasks = (predicted: Uint8Array, approved: Uint8Array, w: number, h: number, tolerancePx = 2): MaskScore => {
  let a = 0;
  let p = 0;
  let both = 0;
  for (let i = 0; i < approved.length; i++) {
    if (approved[i]) a++;
    if (predicted[i]) p++;
    if (approved[i] && predicted[i]) both++;
  }
  const n = w * h;
  const union = a + p - both;
  const pb = boundary(predicted, w, h);
  const ab = boundary(approved, w, h);
  const precision = matched(pb, ab, w, h, tolerancePx);
  const recall = matched(ab, pb, w, h, tolerancePx);
  return {
    coverage: a ? both / a : 0,
    leak: a ? (p - both) / a : 0,
    iou: union ? both / union : 0,
    boundaryF: a && p ? (2 * precision * recall) / (precision + recall || 1) : 0,
    approvedPct: (a / n) * 100,
    predictedPct: (p / n) * 100,
  };
};

/** The stage that last made pixel i equal `wanted` (SAM leaving a surface pixel out counts as samRaw). */
export const lastTransition = (stages: Record<CutStage, Uint8Array>, i: number, wanted: 0 | 1): CutStage => {
  for (let k = CUT_STAGES.length - 1; k >= 1; k--) {
    const now = stages[CUT_STAGES[k]][i] ? 1 : 0;
    const before = stages[CUT_STAGES[k - 1]][i] ? 1 : 0;
    if (now === wanted && before !== wanted) return CUT_STAGES[k];
  }
  return 'samRaw';
};

export const attribute = (stages: Record<CutStage, Uint8Array>, predicted: Uint8Array, approved: Uint8Array) => {
  const missedBy: Record<string, number> = {};
  const leakedBy: Record<string, number> = {};
  for (let i = 0; i < approved.length; i++) {
    if (approved[i] && !predicted[i]) {
      const s = lastTransition(stages, i, 0);
      missedBy[s] = (missedBy[s] ?? 0) + 1;
    } else if (!approved[i] && predicted[i]) {
      const s = lastTransition(stages, i, 1);
      leakedBy[s] = (leakedBy[s] ?? 0) + 1;
    }
  }
  return { missedBy, leakedBy };
};

export const decisionOutcome = (decision: ReviewDecision, iou: number): 'ok' | 'false-auto' | 'needless-correction' =>
  decision === 'auto' && iou < FALSE_AUTO_IOU ? 'false-auto' : decision === 'correct' && iou >= FALSE_AUTO_IOU ? 'needless-correction' : 'ok';

/** For each candidate 'auto' threshold: how many surfaces would be auto, and how many of those wrongly. */
export const calibrate = (rows: Array<{ confidence: number; iou: number }>, thresholds = [0.75, 0.8, 0.85, 0.9, 0.95]) =>
  thresholds.map((threshold) => {
    const auto = rows.filter((r) => r.confidence >= threshold);
    return { threshold, auto: auto.length, falseAuto: auto.filter((r) => r.iou < FALSE_AUTO_IOU).length };
  });
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/validationMetrics.test.ts && npm run typecheck && npm test`
Expected: PASS (all 8), clean, all pass

- [ ] **Step 5: Commit**

```bash
git add services/validation/metrics.ts tests/unit/validationMetrics.test.ts
git commit -m "Add validation metrics: coverage, leak, IoU, boundary F, stage attribution, calibration"
```

---

### Task 4: Dev-server plugin (serve cache, approve, results)

**Files:**
- Create: `scripts/validationDevServer.ts`
- Modify: `vite.config.ts`

**Interfaces:**
- Consumes: `isListed`, `approvedName`, `validateManifest` (Task 1)
- Produces (dev server only):
  - `GET /validation-cache/<id>.jpg`: the cached photo, or 404
  - `GET /__validation/state`: `{ photos: ValidationPhoto[], approved: string[] }`, where `approved` holds `approvedName`s
  - `GET /validation-approved/<name>.png`: an approved mask
  - `POST /__validation/approve` with a JSON body `{ id, surface, png: base64, analysisVersion, notes? }`: writes `validation/approved/<name>.png` and `.json`, and returns `{ ok: true }`. It returns 400 if the id and surface aren't listed.
  - `GET /__validation/results`: `{ latest: object | null, history: object[] }`

- [ ] **Step 1: Write the plugin**

```ts
// scripts/validationDevServer.ts
// Dev-server-only endpoints for the validation tools (/dev/validation): the cached photos, the
// approved masks, writing a new approval (only for surfaces the manifest lists), and the latest
// scores with their history. Not part of the production build (`apply: 'serve'`).
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { approvedName, isListed, validateManifest, ValidationPhoto } from '../services/validation/manifest';

export const validationDevServer = (root: string): Plugin => {
  const dir = path.join(root, 'validation');
  const manifest = (): ValidationPhoto[] => {
    const photos = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    const problems = validateManifest(photos);
    if (problems.length) throw new Error(`validation/manifest.json: ${problems.join('; ')}`);
    return photos;
  };
  const sendFile = (res: import('node:http').ServerResponse, file: string, type: string) => {
    if (!fs.existsSync(file)) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader('Content-Type', type);
    res.end(fs.readFileSync(file));
  };
  const json = (res: import('node:http').ServerResponse, status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  };
  return {
    name: 'validation-dev-server',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? '').split('?')[0]);
        const safe = (s: string) => /^[a-z0-9_-]+$/i.test(s);
        if (req.method === 'GET' && url.startsWith('/validation-cache/')) {
          const id = url.slice('/validation-cache/'.length).replace(/\.jpg$/, '');
          return safe(id) ? sendFile(res, path.join(dir, '.cache', `${id}.jpg`), 'image/jpeg') : json(res, 400, { error: 'bad id' });
        }
        if (req.method === 'GET' && url.startsWith('/validation-approved/')) {
          const name = url.slice('/validation-approved/'.length).replace(/\.png$/, '');
          return safe(name) ? sendFile(res, path.join(dir, 'approved', `${name}.png`), 'image/png') : json(res, 400, { error: 'bad name' });
        }
        if (req.method === 'GET' && url === '/__validation/state') {
          const approvedDir = path.join(dir, 'approved');
          const approved = fs.existsSync(approvedDir) ? fs.readdirSync(approvedDir).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)) : [];
          return json(res, 200, { photos: manifest(), approved });
        }
        if (req.method === 'GET' && url === '/__validation/results') {
          const latestFile = path.join(dir, 'results', 'latest.json');
          const historyFile = path.join(dir, 'history.jsonl');
          const latest = fs.existsSync(latestFile) ? JSON.parse(fs.readFileSync(latestFile, 'utf8')) : null;
          const history = fs.existsSync(historyFile) ? fs.readFileSync(historyFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
          return json(res, 200, { latest, history });
        }
        if (req.method === 'POST' && url === '/__validation/approve') {
          let body = '';
          req.on('data', (c) => (body += c));
          req.on('end', () => {
            try {
              const { id, surface, png, analysisVersion, notes } = JSON.parse(body);
              if (!isListed(manifest(), id, surface)) return json(res, 400, { error: `${id} / ${surface} is not in the manifest` });
              const name = approvedName(id, surface);
              fs.mkdirSync(path.join(dir, 'approved'), { recursive: true });
              fs.writeFileSync(path.join(dir, 'approved', `${name}.png`), Buffer.from(png, 'base64'));
              fs.writeFileSync(
                path.join(dir, 'approved', `${name}.json`),
                JSON.stringify({ approvedAt: new Date().toISOString(), analysisVersion, ...(notes ? { notes } : {}) }, null, 2) + '\n'
              );
              json(res, 200, { ok: true });
            } catch (err) {
              json(res, 400, { error: String(err) });
            }
          });
          return;
        }
        next();
      });
    },
  };
};
```

- [ ] **Step 2: Register it**

In `vite.config.ts`, add `import { validationDevServer } from './scripts/validationDevServer';` and change the plugins line to:

```ts
      plugins: [react(), modelsNotFound(), validationDevServer(__dirname)],
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck` (clean). The dev server is already running (Vite restarts itself on a config change). Check:

```bash
curl -s http://localhost:3000/__validation/state | head -c 200
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/validation-cache/minimalist-living.jpg
curl -s -X POST http://localhost:3000/__validation/approve -d '{"id":"nope","surface":"wall","png":""}'
```

Expected:
- JSON listing 4 photos and `"approved":[]`
- `200`
- `{"error":"nope / wall is not in the manifest"}`

- [ ] **Step 4: Commit**

```bash
git add scripts/validationDevServer.ts vite.config.ts
git commit -m "Add dev-server endpoints for validation photos, approvals and results"
```

---

### Task 5: Approve page (dev only)

**Files:**
- Create: `components/dev/ValidationApprovePage.tsx`, `services/validation/binaryPng.ts`
- Modify: `index.tsx`
- Test: `tests/e2e/validation-approve.spec.ts`

**Interfaces:**
- Consumes:
  - `/__validation/state`, `/validation-cache/`, `/validation-approved/`, `POST /__validation/approve` (Task 4)
  - `analyzeRoom`, `cutSurface`, `ANALYSIS_VERSION` (`services/roomAnalysis.ts`)
  - `AreaEditor` (`components/AreaEditor.tsx`)
  - `unionMasks`, `loadMaskAsAlpha`, `canvasToAlphaMask` (`services/maskCanvas.ts`)
- Produces:
  - `binaryMaskPngBase64(mask: HTMLCanvasElement): Promise<string>`: alpha > 127 → white, else black, as a photo-sized PNG in base64
  - the dev routes `/dev/validation` and `/dev/validation/results` (the second is filled in Task 7)

- [ ] **Step 1: The PNG helper**

```ts
// services/validation/binaryPng.ts
/** An editor mask (white, alpha = coverage) as the approved-mask format: hard white-on-black PNG, base64. */
export const binaryMaskPngBase64 = async (mask: HTMLCanvasElement): Promise<string> => {
  const { width: w, height: h } = mask;
  const src = mask.getContext('2d')!.getImageData(0, 0, w, h).data;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = src[i * 4 + 3] > 127 ? 255 : 0;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png'));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
```

- [ ] **Step 2: The page**

```tsx
// components/dev/ValidationApprovePage.tsx
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Loader2 } from 'lucide-react';
import { AreaEditor } from '../AreaEditor';
import { analyzeRoom, cutSurface, ANALYSIS_VERSION } from '../../services/roomAnalysis';
import { loadMaskAsAlpha, unionMasks } from '../../services/maskCanvas';
import { approvedName, ValidationPhoto, VALIDATION_CATEGORIES } from '../../services/validation/manifest';
import { binaryMaskPngBase64 } from '../../services/validation/binaryPng';

/**
 * Dev only: approve the correct area of each validation surface. The pipeline's cut (or the
 * existing approved mask) opens in the Area Editor; fix it, then Approve writes it to
 * validation/approved/ through the dev server.
 */
export const ValidationApprovePage: React.FC = () => {
  const [photos, setPhotos] = useState<ValidationPhoto[]>([]);
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [category, setCategory] = useState<string>('all');
  const [open, setOpen] = useState<{ photo: ValidationPhoto; surface: string } | null>(null);
  const [mask, setMask] = useState<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    fetch('/__validation/state')
      .then((r) => r.json())
      .then((s: { photos: ValidationPhoto[]; approved: string[] }) => {
        setPhotos(s.photos);
        setApproved(new Set(s.approved));
      })
      .catch((err) => setError(String(err)));
  useEffect(() => void refresh(), []);

  // Opening a surface: its approved mask if there is one, else the pipeline's cut, else empty
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const imageUrl = `/validation-cache/${open.photo.id}.jpg`;
    const name = approvedName(open.photo.id, open.surface);
    setMask(null);
    setError(null);
    setStatus('Loading…');
    (async () => {
      if (approved.has(name)) return loadMaskAsAlpha(`/validation-approved/${name}.png`);
      setStatus('Analysing the photo…');
      const { items } = await analyzeRoom(imageUrl, { onProgress: (l) => !cancelled && setStatus(l) });
      const item = items.find((i) => i.surfaceLabel === open.surface);
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error(`${imageUrl} is missing — run npm run validation:fetch`));
        el.src = imageUrl;
      });
      if (!item?.anchor) {
        const empty = document.createElement('canvas');
        empty.width = img.naturalWidth;
        empty.height = img.naturalHeight;
        return empty; // not proposed: draw it with polygon/brush
      }
      const cut = await cutSurface(imageUrl, item.anchor, { label: open.surface, onProgress: (l) => !cancelled && setStatus(l) });
      return unionMasks(cut.parts.map((p) => p.mask));
    })()
      .then((m) => {
        if (cancelled) return;
        setMask(m);
        setStatus(null);
      })
      .catch((err) => !cancelled && (setError(err instanceof Error ? err.message : String(err)), setStatus(null)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const approve = async () => {
    if (!open || !mask) return;
    setStatus('Saving…');
    const res = await fetch('/__validation/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: open.photo.id, surface: open.surface, png: await binaryMaskPngBase64(mask), analysisVersion: ANALYSIS_VERSION }),
    });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error ?? 'Could not save');
      setStatus(null);
      return;
    }
    setStatus(null);
    setOpen(null);
    refresh();
  };

  const surfaces = photos
    .filter((p) => category === 'all' || p.category === category)
    .flatMap((photo) => photo.surfaces.map((surface) => ({ photo, surface, done: approved.has(approvedName(photo.id, surface)) })));

  return (
    <div className="min-h-screen bg-[#0b0d12] text-slate-200 p-6 flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold">Validation set — approve areas</h1>
        <span className="text-xs text-slate-400">
          {approved.size} of {photos.reduce((n, p) => n + p.surfaces.length, 0)} approved
        </span>
        <Link to="/dev/validation/results" className="text-xs text-amber-300 underline ml-auto">
          Results →
        </Link>
      </div>
      {error && <p className="text-xs text-rose-300">{error}</p>}
      {!open && (
        <>
          <div className="flex gap-2 text-xs">
            {['all', ...VALIDATION_CATEGORIES].map((c) => (
              <button key={c} type="button" onClick={() => setCategory(c)} className={`px-2 py-1 rounded border ${category === c ? 'border-amber-400 text-amber-300' : 'border-white/10'}`}>
                {c}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {surfaces.map(({ photo, surface, done }) => (
              <button
                key={`${photo.id}-${surface}`}
                type="button"
                data-testid="validation-surface"
                onClick={() => setOpen({ photo, surface })}
                className="text-left rounded-lg overflow-hidden border border-white/10 hover:border-amber-400/60"
              >
                <img src={`/validation-cache/${photo.id}.jpg`} alt="" className="w-full aspect-[4/3] object-cover bg-slate-900" />
                <div className="p-2 text-[11px] flex items-center gap-1">
                  {done && <Check className="w-3 h-3 text-emerald-400" />}
                  <span className="truncate">
                    {photo.id} · {surface}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
      {open && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3 text-xs">
            <span className="font-medium">
              {open.photo.id} · {open.surface} · {open.photo.category}
            </span>
            <span className="text-slate-500">{open.photo.credit}</span>
            {status && (
              <span className="flex items-center gap-1 text-slate-400">
                <Loader2 className="w-3 h-3 animate-spin" /> {status}
              </span>
            )}
            <button type="button" onClick={() => setOpen(null)} className="ml-auto px-3 py-1.5 rounded border border-white/10">
              Back
            </button>
            <button type="button" onClick={approve} disabled={!mask} className="px-3 py-1.5 rounded bg-amber-500 text-slate-950 font-semibold disabled:opacity-50">
              Approve
            </button>
          </div>
          {mask && <AreaEditor imageUrl={`/validation-cache/${open.photo.id}.jpg`} initialMask={mask} label={open.surface} onChange={setMask} />}
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 3: Dev-only routes**

In `index.tsx`, add, after the existing imports:

```tsx
import { ValidationApprovePage } from './components/dev/ValidationApprovePage';
```

Then, inside `<Routes>` after the storefront route:

```tsx
        {import.meta.env.DEV && <Route path="/dev/validation" element={<ValidationApprovePage />} />}
```

(`/dev/validation/results` is added in Task 7.)

- [ ] **Step 4: E2E test**

```ts
// tests/e2e/validation-approve.spec.ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

// The dev-only approve tool: a cached validation photo opens with the pipeline's cut in the Area
// Editor, and Approve posts a photo-sized, hard white-on-black PNG (the endpoint is stubbed so
// the test never writes into validation/approved/).
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PHOTO = path.join(HERE, '../../validation/.cache/minimalist-living.jpg');

test('approve tool posts a binary mask for a validation surface', async ({ page }) => {
  test.setTimeout(8 * 60_000);
  test.skip(!fs.existsSync(path.join(HERE, '../../public/models')), 'local models missing — run npm run assets:fetch');
  test.skip(!fs.existsSync(PHOTO), 'validation photos missing — run npm run validation:fetch');

  let posted: { id: string; surface: string; png: string } | null = null;
  await page.route('**/__validation/state', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        photos: [{ id: 'minimalist-living', url: 'https://x', source: 'unsplash', credit: 'test', category: 'hard', surfaces: ['wall'] }],
        approved: [],
      }),
    })
  );
  await page.route('**/__validation/approve', async (route) => {
    posted = JSON.parse(route.request().postData() ?? '{}');
    await route.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
  });

  await page.goto('/dev/validation');
  await page.getByTestId('validation-surface').first().click();
  await expect(page.getByTestId('area-editor-viewport')).toBeVisible({ timeout: 6 * 60_000 });
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect.poll(() => posted !== null, { timeout: 30_000 }).toBe(true);

  const check = await page.evaluate(async (png) => {
    const img = new Image();
    img.src = `data:image/png;base64,${png}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let white = 0;
    let other = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] === 255) white++;
      else if (d[i] !== 0) other++;
    }
    return { w: c.width, h: c.height, white, other };
  }, posted!.png);
  expect(posted!.id).toBe('minimalist-living');
  expect(check).toMatchObject({ w: 1600, h: 1200, other: 0 });
  expect(check.white).toBeGreaterThan(100_000); // the wall
});
```

- [ ] **Step 5: Run**

Run: `npm run typecheck && npx playwright test tests/e2e/validation-approve.spec.ts`
Expected: clean; PASS

- [ ] **Step 6: Commit**

```bash
git add components/dev/ValidationApprovePage.tsx services/validation/binaryPng.ts index.tsx tests/e2e/validation-approve.spec.ts
git commit -m "Add dev-only validation approve tool"
```

---

### Task 6: Scoring run

**Files:**
- Create: `tests/e2e/validation/harness.html`, `tests/e2e/validation/harness.ts`, `tests/e2e/validation-score.spec.ts`

**Interfaces:**
- Consumes:
  - `scoreMasks`, `attribute`, `decisionOutcome`, `calibrate` (Task 3)
  - `approvedName` (Task 1)
  - `analyzeRoom`, `cutSurface`, `cutToRenderables` (`services/roomAnalysis.ts`)
  - `selectedAreaAlpha` (`services/renderer/materialRenderer.ts`)
- Produces:
  - `validation/results/latest.json` = `{ date, commit, analysisVersion, surfaces: SurfaceResult[], byCategory, calibration }`
  - one line appended to `validation/history.jsonl`
  - overlays in `validation/.cache/overlays/<name>.jpg`
  - `SurfaceResult = { id, surface, category, iou, coverage, leak, boundaryF, confidence, decision, outcome, missedBy, leakedBy, reviewReasons }`, where `missedBy` and `leakedBy` are in % of the approved area

- [ ] **Step 1: Harness page**

`tests/e2e/validation/harness.html`: the same as `tests/e2e/evidence/harness.html`, but with title "Validation scoring harness" and `<script type="module" src="./harness.ts">`.

```ts
// tests/e2e/validation/harness.ts
// Scores one approved validation surface with the app's own client code: analyze, cut (with
// every stage), the exact final render mask (selectedAreaAlpha > 0.5), compared with the approved
// mask. Run by tests/e2e/validation-score.spec.ts through the Vite dev server.
import { analyzeRoom, cutSurface, cutToRenderables } from '../../../services/roomAnalysis';
import { selectedAreaAlpha } from '../../../services/renderer/materialRenderer';
import { attribute, decisionOutcome, scoreMasks } from '../../../services/validation/metrics';

const binaryOf = async (url: string, w: number, h: number) => {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  return Uint8Array.from({ length: w * h }, (_, i) => (d[i * 4] > 127 ? 1 : 0));
};

const overlay = async (imageUrl: string, w: number, h: number, missed: (i: number) => boolean, leaked: (i: number) => boolean) => {
  const img = new Image();
  img.src = imageUrl;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < w * h; i++) {
    const rgb = missed(i) ? [239, 68, 68] : leaked(i) ? [217, 70, 239] : null;
    if (rgb) for (let k = 0; k < 3; k++) d.data[i * 4 + k] = d.data[i * 4 + k] * 0.35 + rgb[k] * 0.65;
  }
  ctx.putImageData(d, 0, 0);
  const s = document.createElement('canvas');
  const scale = Math.min(1, 800 / w);
  s.width = Math.round(w * scale);
  s.height = Math.round(h * scale);
  s.getContext('2d')!.drawImage(c, 0, 0, s.width, s.height);
  return s.toDataURL('image/jpeg', 0.8);
};

const scoreSurface = async (id: string, surface: string, approvedName: string) => {
  const imageUrl = `/validation-cache/${id}.jpg`;
  const { items } = await analyzeRoom(imageUrl);
  const item = items.find((i) => i.surfaceLabel === surface);
  const final = item?.anchor ? null : await selectedAreaAlpha(imageUrl, []);
  if (!item?.anchor) {
    // Not proposed at all: everything approved is missed
    const approved = await binaryOf(`/validation-approved/${approvedName}.png`, final!.width, final!.height);
    const predicted = new Uint8Array(approved.length);
    const s = scoreMasks(predicted, approved, final!.width, final!.height);
    return { ...s, confidence: 0, decision: 'correct', outcome: decisionOutcome('correct', s.iou), missedBy: { notProposed: 100 }, leakedBy: {}, reviewReasons: ['not proposed'], overlay: null };
  }
  const cut = await cutSurface(imageUrl, item.anchor, { label: surface, debugStages: true });
  const render = await selectedAreaAlpha(imageUrl, cutToRenderables(cut));
  const { width: w, height: h } = render;
  const predicted = Uint8Array.from(render.alpha, (v) => (v > 0.5 ? 1 : 0));
  const approved = await binaryOf(`/validation-approved/${approvedName}.png`, w, h);
  const s = scoreMasks(predicted, approved, w, h);
  const approvedPx = approved.reduce((n, v) => n + v, 0) || 1;
  const { missedBy, leakedBy } = attribute(cut.stages!.masks, predicted, approved);
  const pct = (r: Record<string, number>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, +((v / approvedPx) * 100).toFixed(2)]));
  return {
    ...s,
    confidence: cut.confidence,
    decision: cut.decision,
    outcome: decisionOutcome(cut.decision, s.iou),
    missedBy: pct(missedBy),
    leakedBy: pct(leakedBy),
    reviewReasons: cut.reviewReasons,
    overlay: await overlay(imageUrl, w, h, (i) => approved[i] === 1 && !predicted[i], (i) => predicted[i] === 1 && !approved[i]),
  };
};

Object.assign(window, { scoreSurface });
```

- [ ] **Step 2: The spec**

```ts
// tests/e2e/validation-score.spec.ts
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from '@playwright/test';
import { approvedName, ValidationPhoto } from '../../services/validation/manifest';
import { calibrate } from '../../services/validation/metrics';
import { ANALYSIS_VERSION } from '../../services/analysis/protocol';

// Scores every approved validation surface (npm run validation:score; opt-in, real models).
// Writes validation/results/latest.json, overlays in validation/.cache/overlays/, and appends a
// summary line to validation/history.jsonl (committed) so runs can be compared.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, '../../validation');

test('validation set score', async ({ page }) => {
  test.skip(!process.env.VALIDATION, 'scoring run only: npm run validation:score');
  test.setTimeout(90 * 60_000);
  const photos: ValidationPhoto[] = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
  const todo = photos.flatMap((p) =>
    p.surfaces
      .map((surface) => ({ p, surface, name: approvedName(p.id, surface) }))
      .filter(({ name, p: photo }) => fs.existsSync(path.join(DIR, 'approved', `${name}.png`)) && fs.existsSync(path.join(DIR, '.cache', `${photo.id}.jpg`)))
  );
  test.skip(todo.length === 0, 'no approved surfaces with cached photos yet — approve some in /dev/validation');

  await page.goto('/tests/e2e/validation/harness.html');
  await page.waitForFunction(() => 'scoreSurface' in window);
  fs.mkdirSync(path.join(DIR, '.cache', 'overlays'), { recursive: true });
  fs.mkdirSync(path.join(DIR, 'results'), { recursive: true });

  const surfaces: any[] = [];
  for (const { p, surface, name } of todo) {
    const r: any = await page
      .evaluate(([id, s, n]) => (window as any).scoreSurface(id, s, n), [p.id, surface, name] as const)
      .catch((err: unknown) => ({ error: String(err) }));
    if (r.overlay) fs.writeFileSync(path.join(DIR, '.cache', 'overlays', `${name}.jpg`), Buffer.from(r.overlay.split(',')[1], 'base64'));
    delete r.overlay;
    surfaces.push({ id: p.id, surface, category: p.category, ...r });
    console.log(name, r.error ?? `IoU ${r.iou?.toFixed(3)} cov ${r.coverage?.toFixed(3)} leak ${r.leak?.toFixed(3)} ${r.decision} ${r.outcome}`);
  }

  const ok = surfaces.filter((s) => !s.error);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const summarise = (rows: any[]) => ({
    surfaces: rows.length,
    meanIoU: +mean(rows.map((r) => r.iou)).toFixed(4),
    meanCoverage: +mean(rows.map((r) => r.coverage)).toFixed(4),
    meanLeak: +mean(rows.map((r) => r.leak)).toFixed(4),
    falseAuto: rows.filter((r) => r.outcome === 'false-auto').length,
    needlessCorrection: rows.filter((r) => r.outcome === 'needless-correction').length,
  });
  const byCategory = Object.fromEntries([...new Set(ok.map((s) => s.category))].map((c) => [c, summarise(ok.filter((s) => s.category === c))]));
  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse --short HEAD', { cwd: DIR }).toString().trim();
  } catch {}
  const date = new Date().toISOString();
  const latest = { date, commit, analysisVersion: ANALYSIS_VERSION, ...summarise(ok), errors: surfaces.length - ok.length, byCategory, calibration: calibrate(ok), surfaces };
  fs.writeFileSync(path.join(DIR, 'results', 'latest.json'), JSON.stringify(latest, null, 2));
  const { surfaces: _all, calibration: _cal, ...line } = latest;
  fs.appendFileSync(path.join(DIR, 'history.jsonl'), JSON.stringify(line) + '\n');
});
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npx playwright test tests/e2e/validation-score.spec.ts`
Expected: clean; the spec is skipped without `VALIDATION`.

Run: `npm run validation:score`
Expected: skipped ("no approved surfaces") until approvals exist. After approving one surface in `/dev/validation`, it passes and writes `validation/results/latest.json` and one line of `validation/history.jsonl`.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/validation tests/e2e/validation-score.spec.ts
git commit -m "Add validation scoring run with history"
```

---

### Task 7: Results dashboard (dev only)

**Files:**
- Create: `components/dev/ValidationDashboardPage.tsx`
- Modify: `index.tsx`, `scripts/validationDevServer.ts` (serve the overlays)

**Interfaces:**
- Consumes: `GET /__validation/results` (Task 4); `latest.json` and history lines (Task 6)
- Produces:
  - the route `/dev/validation/results`
  - `GET /validation-overlays/<name>.jpg`

- [ ] **Step 1: Serve the overlays**

In `scripts/validationDevServer.ts`, next to the `/validation-approved/` branch, add:

```ts
        if (req.method === 'GET' && url.startsWith('/validation-overlays/')) {
          const name = url.slice('/validation-overlays/'.length).replace(/\.jpg$/, '');
          return safe(name) ? sendFile(res, path.join(dir, '.cache', 'overlays', `${name}.jpg`), 'image/jpeg') : json(res, 400, { error: 'bad name' });
        }
```

- [ ] **Step 2: The page**

```tsx
// components/dev/ValidationDashboardPage.tsx
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { approvedName } from '../../services/validation/manifest';

/** Dev only: the latest validation scores, worst surfaces first, and the trend across runs. */
export const ValidationDashboardPage: React.FC = () => {
  const [data, setData] = useState<{ latest: any; history: any[] } | null>(null);
  useEffect(() => {
    fetch('/__validation/results').then((r) => r.json()).then(setData);
  }, []);
  if (!data) return <div className="min-h-screen bg-[#0b0d12] text-slate-400 p-6 text-sm">Loading…</div>;
  const { latest, history } = data;
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const topStage = (r: Record<string, number>) => Object.entries(r ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';

  // Trend: mean IoU (amber) and false autos (rose) per run, as a small inline SVG
  const W = 480;
  const H = 120;
  const n = history.length;
  const x = (k: number) => (n <= 1 ? W / 2 : (k / (n - 1)) * (W - 20) + 10);
  const maxFalse = Math.max(1, ...history.map((h) => h.falseAuto));
  const iouPath = history.map((h, k) => `${k ? 'L' : 'M'}${x(k)},${H - 10 - h.meanIoU * (H - 20)}`).join(' ');
  const falsePath = history.map((h, k) => `${k ? 'L' : 'M'}${x(k)},${H - 10 - (h.falseAuto / maxFalse) * (H - 20)}`).join(' ');

  return (
    <div className="min-h-screen bg-[#0b0d12] text-slate-200 p-6 flex flex-col gap-5 text-sm">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold">Validation results</h1>
        <Link to="/dev/validation" className="text-xs text-amber-300 underline ml-auto">
          ← Approve areas
        </Link>
      </div>
      {!latest ? (
        <p className="text-slate-400">No results yet — approve surfaces in /dev/validation, then run npm run validation:score.</p>
      ) : (
        <>
          <p className="text-xs text-slate-400">
            {latest.date} · commit {latest.commit} · analysis {latest.analysisVersion} · {latest.surfaces.length} surfaces{latest.errors ? ` · ${latest.errors} errors` : ''}
          </p>
          <div data-testid="validation-headline" className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              ['Mean IoU', pct(latest.meanIoU)],
              ['Coverage', pct(latest.meanCoverage)],
              ['Leak', pct(latest.meanLeak)],
              ['False auto', String(latest.falseAuto)],
              ['Needless correction', String(latest.needlessCorrection)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-white/10 p-3">
                <div className="text-[11px] text-slate-400">{k}</div>
                <div className="text-xl font-semibold">{v}</div>
              </div>
            ))}
          </div>
          <table className="text-xs">
            <thead className="text-slate-400">
              <tr>
                <th className="text-left p-1">Category</th>
                <th className="p-1">Surfaces</th>
                <th className="p-1">IoU</th>
                <th className="p-1">Coverage</th>
                <th className="p-1">Leak</th>
                <th className="p-1">False auto</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(latest.byCategory).map(([c, s]: [string, any]) => (
                <tr key={c} className="border-t border-white/5">
                  <td className="p-1">{c}</td>
                  <td className="p-1 text-center">{s.surfaces}</td>
                  <td className="p-1 text-center">{pct(s.meanIoU)}</td>
                  <td className="p-1 text-center">{pct(s.meanCoverage)}</td>
                  <td className="p-1 text-center">{pct(s.meanLeak)}</td>
                  <td className="p-1 text-center">{s.falseAuto}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div>
            <h2 className="font-medium mb-1">Auto threshold calibration</h2>
            <p className="text-[11px] text-slate-400 mb-1">How many surfaces each threshold would pass automatically, and how many of those are wrong (IoU &lt; 90%).</p>
            <table className="text-xs">
              <tbody>
                {latest.calibration.map((c: any) => (
                  <tr key={c.threshold}>
                    <td className="p-1">≥ {Math.round(c.threshold * 100)}%</td>
                    <td className="p-1">{c.auto} auto</td>
                    <td className={`p-1 ${c.falseAuto ? 'text-rose-300' : 'text-emerald-300'}`}>{c.falseAuto} wrong</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {n > 0 && (
            <div>
              <h2 className="font-medium mb-1">Trend ({n} runs)</h2>
              <svg width={W} height={H} className="bg-white/[0.02] rounded" role="img" aria-label="Mean IoU and false autos per run">
                <path d={iouPath} fill="none" stroke="#fbbf24" strokeWidth={2} />
                <path d={falsePath} fill="none" stroke="#fb7185" strokeWidth={2} strokeDasharray="4 3" />
              </svg>
              <p className="text-[11px] text-slate-400">Amber: mean IoU · dashed rose: false autos</p>
            </div>
          )}
          <div>
            <h2 className="font-medium mb-2">Surfaces, worst first</h2>
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
              {[...latest.surfaces]
                .filter((s: any) => !s.error)
                .sort((a: any, b: any) => a.iou - b.iou)
                .map((s: any) => (
                  <div key={`${s.id}-${s.surface}`} className="rounded-lg border border-white/10 overflow-hidden">
                    <img src={`/validation-overlays/${approvedName(s.id, s.surface)}.jpg`} alt="" className="w-full" />
                    <div className="p-2 text-[11px] space-y-0.5">
                      <div className="font-medium">
                        {s.id} · {s.surface} · {s.category}
                      </div>
                      <div>
                        IoU {pct(s.iou)} · coverage {pct(s.coverage)} · leak {pct(s.leak)} · edges {pct(s.boundaryF)}
                      </div>
                      <div>
                        {s.decision} ({Math.round(s.confidence * 100)}%){s.outcome !== 'ok' && <span className="text-rose-300"> · {s.outcome}</span>}
                      </div>
                      <div className="text-slate-400">
                        missed mostly by {topStage(s.missedBy)} · leaked mostly by {topStage(s.leakedBy)}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
```

- [ ] **Step 3: Route**

In `index.tsx`, import `ValidationDashboardPage` from `./components/dev/ValidationDashboardPage`, and add after the approve route:

```tsx
        {import.meta.env.DEV && <Route path="/dev/validation/results" element={<ValidationDashboardPage />} />}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test`
Expected: clean, all pass

Then:
- open `http://localhost:3000/dev/validation/results`: with no run it shows "No results yet"
- run `npm run build` and check the dev pages aren't in the production bundle: `grep -l "Validation results" dist/assets/*.js` finds nothing

- [ ] **Step 5: Commit**

```bash
git add components/dev/ValidationDashboardPage.tsx index.tsx scripts/validationDevServer.ts
git commit -m "Add dev-only validation results dashboard"
```

---

### Task 8: Docs

**Files:**
- Modify: `CLAUDE.md`, `PROJECT.md`

- [ ] **Step 1: CLAUDE.md Commands**, after `npm run assets:fetch`, add:

```
- `npm run validation:fetch` / `validation:find` / `validation:score` — the validation set (`validation/manifest.json`: free-licence Unsplash photos, credited; photos cached in git-ignored `validation/.cache/`). `validation:find` needs a free `UNSPLASH_ACCESS_KEY` in `.env` and fills the set towards 20 wall / 15 floor / 10 cabinet-door / 10 countertop / 5 hard, skipping Unsplash+ photos. Approve each surface's correct area at `/dev/validation` (dev server only; Area Editor → Approve writes `validation/approved/<id>__<surface>.png`, committed). `validation:score` (opt-in, real models) scores every approved surface — coverage, leak, IoU, boundary F (2 px), failing stage, false autos (`auto` with IoU < 0.9), auto-threshold calibration — into `validation/results/latest.json` and appends to the committed `validation/history.jsonl`; `/dev/validation/results` shows it
```

- [ ] **Step 2: PROJECT.md:** in "Current state" → Rendering, add that the validation tooling exists (manifest, approve tool, scoring, dashboard). Change roadmap item 1 to: "Fill the validation set to ~60 approved surfaces (`npm run validation:find` + `/dev/validation`), then calibrate `CONFIDENCE_THRESHOLDS` from its calibration table; privacy/retention controls for customer photos."

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md PROJECT.md
git commit -m "Docs: validation set tooling"
```
