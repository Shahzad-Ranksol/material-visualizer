// Golden-image checks for the one render path (services/renderer/materialRenderer.ts), run in
// a real browser because the renderer needs WebGL2. Every scene is synthetic, so the expected
// result is known exactly: the page renders, measures, and hands plain numbers to
// tests/e2e/golden.spec.ts, which holds the pass/fail thresholds.
import { Material, RenderableSurface, SurfaceGeometry, SurfaceCalibration } from '../../../types';
import { renderMaterial } from '../../../services/renderer/materialRenderer';
import { buildSurfaceMapping, mapPixelToPlaneMm, SurfaceMapping } from '../../../services/renderer/surfaceMapping';
import { srgbToLinear } from '../../../services/renderer/colorSpace';

const W = 384;
const H = 384;
const SURFACE = { x0: 48, y0: 40, x1: 336, y1: 344 };
const OCCLUDER = { x0: 150, y0: 150, x1: 200, y1: 210 };
// sRGB byte whose linear luminance is the renderer's "normally exposed neutral paint"
const NEUTRAL_WALL = 179;

type Rect = { x0: number; y0: number; x1: number; y1: number };
const inRect = (r: Rect, x: number, y: number) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;

const canvasOf = (w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  return c;
};

const rectMask = (r: Rect) =>
  canvasOf(W, H, (ctx) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
  });

// A room with detail everywhere (so any stray write outside the surface is visible), a
// neutral wall, and a red "vase" in front of it
const roomUrl = (opts: { evenWall?: boolean; neutralFloor?: boolean } = {}) =>
  canvasOf(W, H, (ctx) => {
    const img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = (y * W + x) * 4;
        let r = (x * 7 + y * 13) % 256;
        let g = (x * 3 + y * 5) % 256;
        let b = (x * 11 + y * 2) % 256;
        if (inRect(SURFACE, x, y)) {
          const shade = opts.evenWall ? 0 : Math.round(((x - SURFACE.x0) / (SURFACE.x1 - SURFACE.x0)) * 40 - 20);
          r = g = b = NEUTRAL_WALL + shade;
        }
        if (opts.neutralFloor && inRect(FLOOR_AREA, x, y)) r = g = b = NEUTRAL_WALL;
        if (inRect(OCCLUDER, x, y)) [r, g, b] = [200, 30, 40];
        img.data.set([r, g, b, 255], p);
      }
    }
    ctx.putImageData(img, 0, 0);
  }).toDataURL('image/png');

const solidUrl = (hex: string) =>
  canvasOf(64, 64, (ctx) => {
    ctx.fillStyle = hex;
    ctx.fillRect(0, 0, 64, 64);
  }).toDataURL('image/png');

// Smooth and exactly periodic, so any jump at a repeat edge comes from the renderer
const periodicUrl = () =>
  canvasOf(256, 256, (ctx) => {
    const img = ctx.createImageData(256, 256);
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const t = (2 * Math.PI) / 256;
        const v = 128 + 45 * Math.sin(t * x + 0.7) + 30 * Math.cos(t * 2 * y + 1.3) + 20 * Math.sin(t * (x + 3 * y));
        img.data.set([v, v * 0.9, v * 0.8, 255], (y * 256 + x) * 4);
      }
    }
    ctx.putImageData(img, 0, 0);
  }).toDataURL('image/png');

let materialSeq = 0;
const material = (overrides: Partial<Material>): Material => ({
  id: `golden-${++materialSeq}`,
  tenantId: null,
  name: 'Golden test material',
  category: 'tile',
  description: '',
  thumbnail: overrides.albedoUrl ?? '',
  finishType: 'matte',
  colorTone: '',
  realWidthMm: 300,
  realHeightMm: 300,
  repeatMode: 'tile',
  orientationDeg: 0,
  jointWidthMm: 6,
  jointColor: '#101010',
  roughness: 1,
  metallic: 0,
  normalStrength: 0,
  ...overrides,
});

// Wall 1m in front of the camera, facing it
const HEAD_ON: SurfaceGeometry = { normal: [0, 0, 1], origin: [0, 0, 1], axisU: [1, 0, 0], axisV: [0, 1, 0] };
// Floor 1.2m below a level camera: strongly foreshortened
const FLOOR: SurfaceGeometry = { normal: [0, 1, 0], origin: [0, 1.2, 0], axisU: [1, 0, 0], axisV: [0, 0, 1] };
const FLOOR_AREA: Rect = { x0: 0, y0: 250, x1: W, y1: H };

const pixelsOf = async (url: string) => {
  const img = new Image();
  img.src = url;
  await img.decode();
  return canvasOf(W, H, (ctx) => ctx.drawImage(img, 0, 0)).getContext('2d')!.getImageData(0, 0, W, H).data;
};

const originalPixels = (dataUrl: string) => pixelsOf(dataUrl);

const lum = (d: Uint8ClampedArray, i: number) => 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];

const sha256 = async (d: Uint8ClampedArray) => {
  const buf = await crypto.subtle.digest('SHA-256', d);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

// Distance of a surface point from the nearest joint centreline, in mm
const jointDistanceMm = (u: number, v: number, tile: number) => {
  const du = ((u % tile) + tile) % tile;
  const dv = ((v % tile) + tile) % tile;
  return Math.min(du, tile - du, dv, tile - dv);
};

/**
 * Pixel-by-pixel agreement between the GPU output and the joint layout predicted from the CPU
 * mapping (a separate implementation of the same camera maths). Straight, correctly converging
 * joints at the right spacing is the only way to agree everywhere.
 */
const layoutAgreement = (px: Uint8ClampedArray, mapping: SurfaceMapping, area: Rect, tileMm: number, jointMm: number) => {
  let agree = 0;
  let total = 0;
  for (let y = area.y0 + 2; y < area.y1 - 2; y++) {
    for (let x = area.x0 + 2; x < area.x1 - 2; x++) {
      if (inRect({ x0: OCCLUDER.x0 - 2, y0: OCCLUDER.y0 - 2, x1: OCCLUDER.x1 + 2, y1: OCCLUDER.y1 + 2 }, x, y)) continue;
      const here = mapPixelToPlaneMm(mapping, x + 0.5, y + 0.5, W, H);
      const right = mapPixelToPlaneMm(mapping, x + 1.5, y + 0.5, W, H);
      const down = mapPixelToPlaneMm(mapping, x + 0.5, y + 1.5, W, H);
      if (!here || !right || !down) continue;
      const pixelMm = Math.max(Math.hypot(right.u - here.u, right.v - here.v), Math.hypot(down.u - here.u, down.v - here.v));
      const d = jointDistanceMm(here.u, here.v, tileMm);
      // Pixels straddling a joint edge are legitimately mixed; judge only clear-cut ones
      if (Math.abs(d - jointMm / 2) < pixelMm * 1.5) continue;
      const predictedJoint = d < jointMm / 2;
      const renderedJoint = lum(px, y * W + x) < 90;
      total++;
      if (predictedJoint === renderedJoint) agree++;
    }
  }
  return { agree, total, fraction: total ? agree / total : 0 };
};

// Joint spacing along one image row, in pixels (median gap between joint centres). A joint
// thinner than a pixel only darkens it partly, so any clear dip below the tile tone counts.
const JOINT_DIP = 185;
const jointSpacingPx = (px: Uint8ClampedArray, row: number, area: Rect) => {
  const centres: number[] = [];
  let start = -1;
  for (let x = area.x0 + 2; x < area.x1 - 2; x++) {
    const dark = lum(px, row * W + x) < JOINT_DIP;
    if (dark && start < 0) start = x;
    if (!dark && start >= 0) {
      centres.push((start + x - 1) / 2);
      start = -1;
    }
  }
  const gaps = centres.slice(1).map((c, i) => c - centres[i]).sort((a, b) => a - b);
  return gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
};

// CIEDE2000 between two sRGB colours (0–255)
const toLab = ([r, g, b]: number[]) => {
  const [lr, lg, lb] = [r, g, b].map((c) => srgbToLinear(c / 255));
  const X = (0.4124 * lr + 0.3576 * lg + 0.1805 * lb) / 0.95047;
  const Y = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
  const Z = (0.0193 * lr + 0.1192 * lg + 0.9505 * lb) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
};
const deltaE2000 = (c1: number[], c2: number[]) => {
  const [L1, a1, b1] = toLab(c1);
  const [L2, a2, b2] = toLab(c2);
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1p = a1 * (1 + G);
  const a2p = a2 * (1 + G);
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hp = (a: number, b: number) => (a === 0 && b === 0 ? 0 : (Math.atan2(b, a) / rad + 360) % 360);
  const h1p = hp(a1p, b1);
  const h2p = hp(a2p, b2);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = h2p - h1p;
  if (C1p * C2p === 0) dhp = 0;
  else if (dhp > 180) dhp -= 360;
  else if (dhp < -180) dhp += 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lmp = (L1 + L2) / 2;
  const Cmp = (C1p + C2p) / 2;
  let hmp = h1p + h2p;
  if (C1p * C2p !== 0) hmp = Math.abs(h1p - h2p) > 180 ? (h1p + h2p + (h1p + h2p < 360 ? 360 : -360)) / 2 : (h1p + h2p) / 2;
  const T = 1 - 0.17 * Math.cos((hmp - 30) * rad) + 0.24 * Math.cos(2 * hmp * rad) + 0.32 * Math.cos((3 * hmp + 6) * rad) - 0.2 * Math.cos((4 * hmp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hmp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cmp ** 7 / (Cmp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lmp - 50) ** 2) / Math.sqrt(20 + (Lmp - 50) ** 2);
  const Sc = 1 + 0.045 * Cmp;
  const Sh = 1 + 0.015 * Cmp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
};

const errorName = (p: Promise<unknown>) =>
  p.then(
    () => 'resolved',
    (e: Error) => e?.name || 'Error'
  );

export const runGolden = async () => {
  const room = roomUrl();
  const original = await originalPixels(room);
  const wallMask = rectMask(SURFACE);
  const occluderMask = rectMask(OCCLUDER);
  const tiles = material({ albedoUrl: solidUrl('#e6e6e6') });
  const wall: RenderableSurface = { kind: 'wall', mask: wallMask, occluderMask, plane: HEAD_ON };

  // 1–2. Preservation outside the surface and in front of it; 7. determinism
  const first = await pixelsOf(await renderMaterial(room, [{ surface: wall, material: tiles }]));
  const second = await pixelsOf(await renderMaterial(room, [{ surface: wall, material: tiles }]));
  const grown = { x0: SURFACE.x0 - 2, y0: SURFACE.y0 - 2, x1: SURFACE.x1 + 2, y1: SURFACE.y1 + 2 };
  let outsideChanged = 0;
  let occluderChanged = 0;
  let surfaceChanged = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const same = first[i] === original[i] && first[i + 1] === original[i + 1] && first[i + 2] === original[i + 2];
      if (!inRect(grown, x, y) && !same) outsideChanged++;
      if (inRect(OCCLUDER, x, y) && !same) occluderChanged++;
      if (inRect(SURFACE, x, y) && !inRect(OCCLUDER, x, y) && !same) surfaceChanged++;
    }
  }
  const surfacePixels = (SURFACE.x1 - SURFACE.x0) * (SURFACE.y1 - SURFACE.y0) - (OCCLUDER.x1 - OCCLUDER.x0) * (OCCLUDER.y1 - OCCLUDER.y0);

  // 3–4. Perspective and physical scale
  const headOnMapping = buildSurfaceMapping(HEAD_ON, W, H)!;
  const headOn = layoutAgreement(first, headOnMapping, SURFACE, 300, 6);
  const mmPerPx = 1000 / (headOnMapping.kind === 'plane' ? headOnMapping.intrinsics.fx * W : 1);
  const headOnSpacing = { measured: jointSpacingPx(first, 100, SURFACE), expected: 300 / mmPerPx };

  const floorMask = rectMask(FLOOR_AREA);
  const floor = await pixelsOf(
    await renderMaterial(roomUrl({ neutralFloor: true }), [{ surface: { kind: 'floor', mask: floorMask, plane: FLOOR }, material: tiles }])
  );
  const floorAgreement = layoutAgreement(floor, buildSurfaceMapping(FLOOR, W, H)!, FLOOR_AREA, 300, 6);

  // One known distance across the wall: 60% of the image width is really 1.2m
  const calibration: SurfaceCalibration = { p1: [0.2, 0.3], p2: [0.8, 0.3], distanceMm: 1200 };
  const calibrated = await pixelsOf(
    await renderMaterial(room, [{ surface: { ...wall, calibration }, material: tiles }])
  );
  const calibratedMapping = buildSurfaceMapping(HEAD_ON, W, H, calibration)!;
  const calibratedAgreement = layoutAgreement(calibrated, calibratedMapping, SURFACE, 300, 6);
  const calibratedSpacing = { measured: jointSpacingPx(calibrated, 100, SURFACE), expected: (300 / 1200) * (0.6 * W) };

  // 5. Colour fidelity on an evenly lit neutral wall
  const albedoHex = '#9a6b4a';
  const evenRoom = roomUrl({ evenWall: true });
  const paint = material({ albedoUrl: solidUrl(albedoHex), repeatMode: 'seamless', jointWidthMm: null, category: 'paint' });
  const colour = await pixelsOf(await renderMaterial(evenRoom, [{ surface: wall, material: paint }]));
  const sum = [0, 0, 0];
  let n = 0;
  for (let y = SURFACE.y0 + 4; y < SURFACE.y1 - 4; y++) {
    for (let x = SURFACE.x0 + 4; x < SURFACE.x1 - 4; x++) {
      if (inRect({ x0: OCCLUDER.x0 - 4, y0: OCCLUDER.y0 - 4, x1: OCCLUDER.x1 + 4, y1: OCCLUDER.y1 + 4 }, x, y)) continue;
      const i = (y * W + x) * 4;
      sum[0] += colour[i];
      sum[1] += colour[i + 1];
      sum[2] += colour[i + 2];
      n++;
    }
  }
  const renderedColour = sum.map((s) => s / n);
  const target = [1, 3, 5].map((k) => parseInt(albedoHex.slice(k, k + 2), 16));

  // 6. Seams: gradient across repeat edges vs gradient inside the texture
  const seamless = material({ albedoUrl: periodicUrl(), repeatMode: 'seamless', jointWidthMm: null, realHeightMm: 300 });
  const seamPx = await pixelsOf(await renderMaterial(evenRoom, [{ surface: { ...wall, occluderMask: null }, material: seamless }]));
  let seamGrad = 0;
  let seamCount = 0;
  let bodyGrad = 0;
  let bodyCount = 0;
  for (let y = SURFACE.y0 + 3; y < SURFACE.y1 - 3; y++) {
    for (let x = SURFACE.x0 + 3; x < SURFACE.x1 - 4; x++) {
      const a = mapPixelToPlaneMm(headOnMapping, x + 0.5, y + 0.5, W, H)!;
      const b = mapPixelToPlaneMm(headOnMapping, x + 1.5, y + 0.5, W, H)!;
      const g = Math.abs(lum(seamPx, y * W + x + 1) - lum(seamPx, y * W + x));
      if (Math.floor(a.u / 300) !== Math.floor(b.u / 300)) {
        seamGrad = Math.max(seamGrad, g);
        seamCount++;
      } else {
        bodyGrad = Math.max(bodyGrad, g);
        bodyCount++;
      }
    }
  }

  // 8. Safe failure: never a silent or fallback render
  const failures = {
    noLayers: await errorName(renderMaterial(room, [])),
    emptyMask: await errorName(renderMaterial(room, [{ surface: { ...wall, mask: rectMask({ x0: 0, y0: 0, x1: 0, y1: 0 }) }, material: tiles }])),
    brokenTexture: await errorName(
      renderMaterial(room, [{ surface: wall, material: material({ albedoUrl: 'http://127.0.0.1:9/missing.png' }) }])
    ),
  };

  return {
    outsideChanged,
    occluderChanged,
    surfaceChangedFraction: surfaceChanged / surfacePixels,
    deterministic: (await sha256(first)) === (await sha256(second)),
    headOn,
    headOnSpacing,
    floorAgreement,
    calibratedAgreement,
    calibratedSpacing,
    colour: { rendered: renderedColour, target, deltaE: deltaE2000(renderedColour, target) },
    seams: { seamGrad, bodyGrad, seamCount, bodyCount },
    failures,
  };
};

(window as unknown as { runGolden: typeof runGolden }).runGolden = runGolden;
