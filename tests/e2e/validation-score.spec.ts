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
