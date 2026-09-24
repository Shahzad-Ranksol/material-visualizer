import React, { useMemo, useRef } from 'react';
import { PlanePoint, SurfaceCalibration, SurfaceGeometry, SurfacePlane } from '../types';
import { buildSurfaceMapping, projectPlaneMmToPixel, surfaceExtentMm } from '../services/renderer/surfaceMapping';

interface PlaneOverlayProps {
  geometry: SurfaceGeometry;
  calibration?: SurfaceCalibration | null;
  // The surface's mask (sets the grid's extent) at the photo's natural size
  mask: HTMLCanvasElement;
  // Real-world module drawn as a preview grid (e.g. a 1220x2440mm sheet)
  gridMm: { width: number; height: number };
  // Only the four-corner fallback can be dragged; fitted 3D planes are converted first
  editable: boolean;
  onCornersChange: (corners: SurfacePlane['corners']) => void;
  // Calibration ruler endpoints (fractions of the photo) while measuring
  rulerPoints?: PlanePoint[];
}

const MAX_GRID_LINES = 60;

// Perspective preview over the photo: the real-world module grid exactly as the renderer will
// lay it out (same mapping maths), the four draggable corners of a manual plane, and the
// calibration ruler. Sits inside HotspotImage's overlay slot so percentages line up.
export const PlaneOverlay: React.FC<PlaneOverlayProps> = ({ geometry, calibration, mask, gridMm, editable, onCornersChange, rulerPoints = [] }) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ geometry, onCornersChange });
  latest.current = { geometry, onCornersChange };
  const w = mask.width;
  const h = mask.height;

  const lines = useMemo(() => {
    const mapping = buildSurfaceMapping(geometry, w, h, calibration);
    if (!mapping) return [];
    const extent = surfaceExtentMm(mapping, mask);
    if (!extent) return [];
    const toPct = (u: number, v: number) => {
      const p = projectPlaneMmToPixel(mapping, u, v, w, h);
      return p ? { x: (p.x / w) * 100, y: (p.y / h) * 100 } : null;
    };
    const out: Array<[{ x: number; y: number }, { x: number; y: number }]> = [];
    const firstU = Math.ceil(extent.minU / gridMm.width) * gridMm.width;
    const firstV = Math.ceil(extent.minV / gridMm.height) * gridMm.height;
    for (let u = firstU, n = 0; u < extent.maxU && n < MAX_GRID_LINES; u += gridMm.width, n++) {
      const a = toPct(u, extent.minV);
      const b = toPct(u, extent.maxV);
      if (a && b) out.push([a, b]);
    }
    for (let v = firstV, n = 0; v < extent.maxV && n < MAX_GRID_LINES; v += gridMm.height, n++) {
      const a = toPct(extent.minU, v);
      const b = toPct(extent.maxU, v);
      if (a && b) out.push([a, b]);
    }
    return out;
  }, [geometry, calibration, mask, gridMm.width, gridMm.height, w, h]);

  const corners = geometry.homographyFallback?.corners;

  const startDrag = (index: number) => {
    const move = (e: PointerEvent) => {
      const rect = boxRef.current?.getBoundingClientRect();
      const fallback = latest.current.geometry.homographyFallback;
      if (!rect || !fallback) return;
      const next = [...fallback.corners] as SurfacePlane['corners'];
      next[index] = {
        xPct: Math.max(-20, Math.min(120, ((e.clientX - rect.left) / rect.width) * 100)),
        yPct: Math.max(-20, Math.min(120, ((e.clientY - rect.top) / rect.height) * 100)),
      };
      latest.current.onCornersChange(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div ref={boxRef} className="absolute inset-0 pointer-events-none">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full overflow-visible">
        {lines.map(([a, b], i) => (
          <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(255,255,255,0.6)" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray="4 3" />
        ))}
        {corners && (
          <polygon points={corners.map((c) => `${c.xPct},${c.yPct}`).join(' ')} fill="none" stroke="rgb(56,189,248)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        )}
        {rulerPoints.length === 2 && (
          <line
            x1={rulerPoints[0].xPct}
            y1={rulerPoints[0].yPct}
            x2={rulerPoints[1].xPct}
            y2={rulerPoints[1].yPct}
            stroke="rgb(244,114,182)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {rulerPoints.map((p, i) => (
        <div key={i} className="absolute w-3 h-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-pink-400 border-2 border-white" style={{ left: `${p.xPct}%`, top: `${p.yPct}%` }} />
      ))}
      {editable &&
        corners?.map((c, i) => (
          <div
            key={i}
            role="slider"
            aria-label={['Top-left', 'Top-right', 'Bottom-right', 'Bottom-left'][i] + ' corner'}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              startDrag(i);
            }}
            onClick={(e) => e.stopPropagation()}
            className="absolute w-4 h-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-400 border-2 border-white shadow-lg cursor-move pointer-events-auto touch-none"
            style={{ left: `${c.xPct}%`, top: `${c.yPct}%` }}
          />
        ))}
    </div>
  );
};

/** Corners (and height) of a 4-corner plane equivalent to a geometry over the surface's extent. */
export const toManualCorners = (geometry: SurfaceGeometry, mask: HTMLCanvasElement, calibration?: SurfaceCalibration | null): SurfacePlane | null => {
  const w = mask.width;
  const h = mask.height;
  const mapping = buildSurfaceMapping(geometry, w, h, calibration);
  if (!mapping) return null;
  const e = surfaceExtentMm(mapping, mask);
  if (!e) return null;
  const pts = [
    projectPlaneMmToPixel(mapping, e.minU, e.minV, w, h),
    projectPlaneMmToPixel(mapping, e.maxU, e.minV, w, h),
    projectPlaneMmToPixel(mapping, e.maxU, e.maxV, w, h),
    projectPlaneMmToPixel(mapping, e.minU, e.maxV, w, h),
  ];
  if (pts.some((p) => !p)) return null;
  return {
    corners: pts.map((p) => ({ xPct: (p!.x / w) * 100, yPct: (p!.y / h) * 100 })) as SurfacePlane['corners'],
    heightMm: e.maxV - e.minV,
  };
};
