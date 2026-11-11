import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { BAKED } from '../scenes/baked';
import intrinsicsJson from '../scenes/intrinsics.json';
import { decodeIntrinsics } from '../services/renderer/intrinsics';
import { linearToSrgb, SRGB8_TO_LINEAR } from '../services/renderer/colorSpace';
import { ALBEDO_DETAIL, recolorReference, recolorSurface } from '../services/renderer/recolor';
import { deltaE2000 } from '../services/renderer/deltaE';
import { loadMask, loadRgba, ROOT } from './bakedPixels';

// npm run finishes:fromref — the client's colour references (tests/fixtures/kitchen-refs/: the
// Classic kitchen render with its cabinets painted, pixel-aligned with our photo) are ground
// truth. For each, this fits the paint's true colour (its albedo) over the fronts' baked masks
// against the scene's baked light, by least squares — ref ≈ albedo × shading + reflection — then
// runs the studio's own recolour (services/renderer/recolor.ts) with it and scores the result
// against the reference (CIEDE2000 per pixel). It writes each swatch to public/finishes/ and a
// report with side-by-side images to test-results/colour-match/.

export const KITCHEN_FRONTS = ['wall-cabinets', 'tall-units', 'canopy', 'base-cabinets', 'island'];
// `swatch`: the flat swatch written to public/finishes/ (none for the wood: it is a stained scan)
export const REFERENCES: Array<{ file: string; swatch?: string }> = [
  { file: 'burgundy', swatch: 'burgundy' },
  { file: 'cherry-red', swatch: 'cherry-red' },
  { file: 'burnt-orange', swatch: 'burnt-orange' },
  { file: 'charcoal', swatch: 'charcoal-paint' },
  { file: 'dark-wood' },
];

const OUT = path.join(ROOT, 'test-results/colour-match');
// The recolour's detail share for painted fronts (DETAIL=… to compare)
const DETAIL = Number(process.env.DETAIL ?? ALBEDO_DETAIL);
const fixture = (name: string) => path.join(ROOT, 'tests/fixtures/kitchen-refs', `${name}.jpg`);

const rawOf = async (file: string, w: number, h: number) =>
  new Uint8Array((await sharp(fs.readFileSync(file)).resize(w, h, { fit: 'fill' }).ensureAlpha().raw().toBuffer()).buffer.slice(0));

const percentile = (values: number[], p: number) => {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

/** A wood scan stained to `hex` (its mean, in linear light), its grain contrast × `figure`. */
const stainScan = async (scan: string, name: string, hex: string, figure: number) => {
  const target = [1, 3, 5].map((k) => SRGB8_TO_LINEAR[parseInt(hex.slice(k, k + 2), 16)]);
  const dir = path.join(ROOT, 'public/materials');
  const { data, info } = await sharp(path.join(dir, `${scan}.jpg`)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const mean = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) mean[c] += SRGB8_TO_LINEAR[data[i * 3 + c]] / n;
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < n; i++)
    for (let c = 0; c < 3; c++) {
      const v = SRGB8_TO_LINEAR[data[i * 3 + c]];
      const lin = target[c] * (1 + figure * (v / mean[c] - 1));
      out[i * 3 + c] = Math.round(linearToSrgb(Math.min(1, Math.max(0, lin))) * 255);
    }
  const raw = { raw: { width: info.width, height: info.height, channels: 3 as const } };
  await sharp(out, raw).jpeg({ quality: 90 }).toFile(path.join(dir, `${name}.jpg`));
  // The swatch chip: the middle 256 px, as for the other scans
  const size = Math.min(256, info.width, info.height);
  await sharp(out, raw)
    .extract({ left: Math.floor((info.width - size) / 2), top: Math.floor((info.height - size) / 2), width: size, height: size })
    .jpeg({ quality: 88 })
    .toFile(path.join(dir, `${name}_chip.jpg`));
  console.log(`public/materials/${name}.jpg — ${scan} stained to ${hex}`);
};

const main = async () => {
  const scene = BAKED.kitchen!;
  const { width: w, height: h } = scene;
  const photo = await loadRgba('/scenes/kitchen/photo.png');
  const light = (intrinsicsJson as unknown as Record<string, { shading: string; reflection: string; shadingScale: number }>).kitchen;
  const [s, r] = await Promise.all([loadRgba(light.shading), loadRgba(light.reflection)]);
  const { shading, reflection } = decodeIntrinsics(s.data, r.data, w * h, light.shadingScale);
  const intrinsics = { shading, reflection } as Parameters<typeof recolorSurface>[6];

  // Each front: its parts, its occluder, and their union (the area that is scored)
  const items = await Promise.all(
    KITCHEN_FRONTS.map(async (id) => {
      const item = scene.items[id]!;
      const parts = await Promise.all(item.parts.map((p) => loadMask(p.mask, w, h)));
      const occluder = item.occluder ? await loadMask(item.occluder, w, h) : null;
      return { id, parts, occluder };
    })
  );
  const weight = new Float32Array(w * h);
  for (const it of items)
    for (const m of it.parts) for (let i = 0; i < w * h; i++) weight[i] = Math.max(weight[i], m[i] * (it.occluder ? 1 - it.occluder[i] : 1));
  // Only the clearly-front pixels are scored (soft edges are a blend with the neighbour)
  const scored: number[] = [];
  for (let i = 0; i < w * h; i++) if (weight[i] > 0.95) scored.push(i);

  fs.mkdirSync(OUT, { recursive: true });
  const report: Record<string, unknown> = {};
  for (const ref of REFERENCES) {
    const target = await rawOf(fixture(ref.file), w, h);
    // Least squares per channel: ref − reflection ≈ albedo × shading
    const albedo: [number, number, number] = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      let num = 0;
      let den = 0;
      for (const i of scored) {
        const S = shading[i * 3 + c];
        num += S * (SRGB8_TO_LINEAR[target[i * 4 + c]] - reflection[i * 3 + c]);
        den += S * S;
      }
      albedo[c] = Math.min(1, Math.max(0.002, num / den));
    }
    // The studio's recolour with that albedo, as materialRenderer runs it (one reference per item)
    const render = (t: [number, number, number]) => {
      const out = new Uint8ClampedArray(photo.data);
      for (const it of items) {
        const refL = recolorReference(new Uint8ClampedArray(photo.data), it.parts, it.occluder, intrinsics);
        for (const m of it.parts) recolorSurface(new Uint8ClampedArray(photo.data), out, m, it.occluder, t, refL, intrinsics, DETAIL);
      }
      return out;
    };
    // The recolour keeps some of the old albedo's variation around its median; correct the
    // swatch for the small bias that leaves (two passes on the mean ratio per channel)
    let t = albedo;
    for (let pass = 0; pass < 2; pass++) {
      const out = render(t);
      const next = [0, 0, 0] as [number, number, number];
      for (let c = 0; c < 3; c++) {
        let a = 0;
        let b = 0;
        for (const i of scored) {
          a += SRGB8_TO_LINEAR[target[i * 4 + c]];
          b += SRGB8_TO_LINEAR[out[i * 4 + c]];
        }
        next[c] = Math.min(1, Math.max(0.002, t[c] * (a / Math.max(1e-6, b))));
      }
      t = next;
    }
    const out = render(t);
    const de = scored.map((i) => deltaE2000([out[i * 4], out[i * 4 + 1], out[i * 4 + 2]], [target[i * 4], target[i * 4 + 1], target[i * 4 + 2]]));
    const hex = '#' + t.map((v) => Math.round(linearToSrgb(v) * 255).toString(16).padStart(2, '0')).join('');
    const stats = { swatch: hex, medianDeltaE: +percentile(de, 0.5).toFixed(2), p90DeltaE: +percentile(de, 0.9).toFixed(2) };
    report[ref.file] = stats;
    console.log(`${ref.file.padEnd(13)} swatch ${hex}  ΔE2000 median ${stats.medianDeltaE}  p90 ${stats.p90DeltaE}`);

    // The flat swatch the material uses (its mean is the recolour target)
    const rgb = t.map((v) => Math.round(linearToSrgb(v) * 255));
    if (ref.swatch)
      await sharp({ create: { width: 256, height: 256, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } })
      .jpeg({ quality: 100, chromaSubsampling: '4:4:4' })
      .toFile(path.join(ROOT, 'public/finishes', `${ref.swatch}.jpg`));
    // Render | reference, for review
    const pair = Buffer.alloc(w * 2 * h * 4);
    for (let y = 0; y < h; y++) {
      Buffer.from(out.buffer, y * w * 4, w * 4).copy(pair, y * w * 8);
      Buffer.from(target.buffer, y * w * 4, w * 4).copy(pair, y * w * 8 + w * 4);
    }
    await sharp(pair, { raw: { width: w * 2, height: h, channels: 4 } }).jpeg({ quality: 88 }).toFile(path.join(OUT, `${ref.file}.jpg`));
    // Where they differ: ΔE2000 × 20 as grey (white = ΔE 12.75+), and the signed lightness error
    // (red: our render is darker than the reference, blue: lighter)
    const heat = Buffer.alloc(w * h * 3);
    scored.forEach((i, k) => {
      const v = Math.min(255, de[k] * 20);
      const dl = (out[i * 4] + out[i * 4 + 1] + out[i * 4 + 2] - target[i * 4] - target[i * 4 + 1] - target[i * 4 + 2]) / 3;
      heat[i * 3] = dl < 0 ? v : v * 0.3;
      heat[i * 3 + 1] = v * 0.3;
      heat[i * 3 + 2] = dl > 0 ? v : v * 0.3;
    });
    await sharp(heat, { raw: { width: w, height: h, channels: 3 } }).png().toFile(path.join(OUT, `${ref.file}-error.png`));
  }
  // Dark wood is a stain on real timber: its grain shows in the reference. The walnut scan,
  // stained to the fitted colour — every pixel scaled so the scan's mean is the reference's
  // albedo, its figure softened (the reference's grain is subtler than a raw walnut veneer)
  const wood = (report['dark-wood'] as { swatch: string } | undefined)?.swatch;
  if (wood) await stainScan('american_walnut_veneer', 'dark_walnut_stain', wood, 0.6);
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log('test-results/colour-match/ (render | reference)');
};

void main();
