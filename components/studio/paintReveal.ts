import { Box } from './geometry';

// The paint-roller reveal of a newly applied finish (unit-tested maths; drawn by SceneCanvas):
// a few overlapping lanes rolled along the area's longer side, one after another, alternating
// direction like a real roller, each with a soft, slightly wavy wet edge. Coordinates are those
// of the box given (the item masks' pixels).

export const PAINT_MS = 1400;
// Each lane's share of the timeline; lanes start staggered so the last one ends at 1
const LANE_DUR = 0.5;

export interface Stroke {
  // The direction of travel ('y': rolled up/down a tall area, 'x': along a wide one)
  axis: 'x' | 'y';
  // The lane across the travel axis
  lane0: number;
  lane1: number;
  // Travel from → to (either direction), past both ends of the area
  from: number;
  to: number;
  // Its slot on the 0–1 timeline
  start: number;
  dur: number;
  // The wavy edge: amplitude (px) and phase
  amp: number;
  phase: number;
}

// Gentle: a roller moves at a steady pace, slowing a little at the end of its run
const easeOut = (t: number) => 1 - (1 - t) ** 2;

/** The lanes for an area: 3–7, overlapping by 15%, alternating direction. Deterministic. */
export const rollerStrokes = (b: Box): Stroke[] => {
  const axis: 'x' | 'y' = b.h > b.w ? 'y' : 'x';
  const long = axis === 'y' ? b.h : b.w;
  const short = axis === 'y' ? b.w : b.h;
  const longStart = axis === 'y' ? b.y : b.x;
  const shortStart = axis === 'y' ? b.x : b.y;
  const n = Math.max(3, Math.min(7, Math.ceil(short / 60)));
  // Lanes of width `lane`, each starting 85% of a lane after the last, spanning `short` exactly
  const lane = short / (1 + 0.85 * (n - 1));
  // A little past the area's sides, so the soft edge never leaves a margin unpainted
  const pad = Math.max(2, short * 0.03);
  const amp = Math.max(2, long * 0.025);
  const reach = amp + Math.max(4, long * 0.04);
  return Array.from({ length: n }, (_, i) => {
    const a = shortStart + i * lane * 0.85;
    const forward = i % 2 === 0;
    return {
      axis,
      lane0: i === 0 ? a - pad : a,
      lane1: i === n - 1 ? a + lane + pad : a + lane,
      from: forward ? longStart - reach : longStart + long + reach,
      to: forward ? longStart + long + reach : longStart - reach,
      start: n === 1 ? 0 : (i * (1 - LANE_DUR)) / (n - 1),
      dur: LANE_DUR,
      amp,
      phase: i * 1.7,
    };
  });
};

/** A lane's painted region at time t (0–1) as a polygon in box coordinates; empty before it starts. */
export const strokePolygon = (s: Stroke, t: number): Array<{ x: number; y: number }> => {
  const local = Math.max(0, Math.min(1, (t - s.start) / s.dur));
  if (local <= 0) return [];
  const p = easeOut(local);
  const dir = Math.sign(s.to - s.from);
  // The head pulls back by the wave's amplitude at most, so it still covers the lane at p = 1
  const head = s.from + (s.to - s.from) * p - dir * s.amp;
  const steps = 10;
  const pts: Array<[number, number]> = [
    [s.from, s.lane0],
    [s.from, s.lane1],
  ];
  for (let k = steps; k >= 0; k--) {
    const u = k / steps;
    const across = s.lane0 + (s.lane1 - s.lane0) * u;
    const wave = s.amp * (0.5 + 0.5 * Math.sin(u * Math.PI * 2.2 + s.phase));
    pts.push([head + dir * wave, across]);
  }
  return pts.map(([along, across]) => (s.axis === 'y' ? { x: across, y: along } : { x: along, y: across }));
};

/** Fills the strokes at time t into `ctx` (white, softened by `blurPx`), in the strokes' coordinates. */
export const drawStrokes = (ctx: CanvasRenderingContext2D, strokes: Stroke[], t: number, blurPx: number) => {
  ctx.save();
  ctx.fillStyle = '#fff';
  if (blurPx > 0) ctx.filter = `blur(${blurPx}px)`;
  for (const s of strokes) {
    const poly = strokePolygon(s, t);
    if (!poly.length) continue;
    ctx.beginPath();
    ctx.moveTo(poly[0].x, poly[0].y);
    for (const q of poly.slice(1)) ctx.lineTo(q.x, q.y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
};
