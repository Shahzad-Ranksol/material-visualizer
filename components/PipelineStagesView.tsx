import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { CutSurface, cutToRenderables } from '../services/roomAnalysis';
import { CUT_STAGES, CUT_STAGE_LABELS, CutStage } from '../services/analysis/protocol';
import { selectedAreaAlpha } from '../services/renderer/materialRenderer';

interface PipelineStagesViewProps {
  imageUrl: string;
  // A cut made with `debugStages`
  cut: CutSurface;
  onClose: () => void;
}

type View = CutStage | 'classMap' | 'occluder' | 'final';

const AMBER = [251, 191, 36];
const CYAN = [34, 211, 238];
const ADDED = [34, 197, 94];
const REMOVED = [239, 68, 68];
const CLASS_COLOURS = [
  [239, 68, 68], [59, 130, 246], [34, 197, 94], [234, 179, 8], [168, 85, 247],
  [20, 184, 166], [249, 115, 22], [236, 72, 153], [132, 204, 22], [99, 102, 241],
];

const count = (m: Uint8Array) => m.reduce((s, v) => s + v, 0);

/**
 * Staff view of a surface cut, stage by stage: what SegFormer proposed, what SAM returned, what
 * each clean-up step added or removed, the occluders, and the exact area `renderMaterial()`
 * paints. Tells a segmentation fault from an alignment or rendering one at a glance.
 */
export const PipelineStagesView: React.FC<PipelineStagesViewProps> = ({ imageUrl, cut, onClose }) => {
  const stages = cut.stages!;
  const { width: w, height: h } = stages;
  const [view, setView] = useState<View>('final');
  const [changes, setChanges] = useState(false);
  const [finalAlpha, setFinalAlpha] = useState<Float32Array | null>(null);
  const [finalError, setFinalError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    selectedAreaAlpha(imageUrl, cutToRenderables(cut))
      .then((r) => {
        if (cancelled) return;
        // The renderer sizes masks to the photo it draws; a different size here is an alignment fault
        if (r.width !== w || r.height !== h) setFinalError(`Photo decodes at ${r.width}×${r.height} but the masks are ${w}×${h}`);
        setFinalAlpha(r.alpha);
      })
      .catch((err: unknown) => !cancelled && setFinalError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [imageUrl, cut]);

  // Classes present, largest first, for the class-map legend
  const classes = useMemo(() => {
    const counts = new Map<number, number>();
    for (const v of stages.labelMap) if (v !== 255) counts.set(v, (counts.get(v) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([v, n]) => ({ v, name: stages.labels[v] ?? String(v), pct: (n / (w * h)) * 100 }));
  }, [stages, w, h]);

  const stats = useMemo(
    () =>
      CUT_STAGES.map((stage, k) => {
        const m = stages.masks[stage];
        const prev = k > 0 ? stages.masks[CUT_STAGES[k - 1]] : null;
        let added = 0;
        let removed = 0;
        if (prev) for (let i = 0; i < m.length; i++) (m[i] && !prev[i] ? added++ : !m[i] && prev[i] ? removed++ : 0);
        return { stage, pct: (count(m) / (w * h)) * 100, added, removed };
      }),
    [stages, w, h]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(w, h);
    const d = img.data;
    const put = (i: number, rgb: number[], a: number) => {
      d[i * 4] = rgb[0];
      d[i * 4 + 1] = rgb[1];
      d[i * 4 + 2] = rgb[2];
      d[i * 4 + 3] = a;
    };
    if (view === 'classMap') {
      const colourOf = new Map(classes.map((c, k) => [c.v, CLASS_COLOURS[k % CLASS_COLOURS.length]]));
      for (let i = 0; i < w * h; i++) {
        const v = stages.labelMap[i];
        if (v !== 255) put(i, colourOf.get(v)!, 140);
      }
    } else if (view === 'occluder') {
      for (let i = 0; i < w * h; i++) if (stages.occluder[i]) put(i, CYAN, 150);
    } else if (view === 'final') {
      if (finalAlpha) for (let i = 0; i < w * h; i++) if (finalAlpha[i] > 0) put(i, AMBER, Math.round(finalAlpha[i] * 170));
    } else {
      const k = CUT_STAGES.indexOf(view);
      const m = stages.masks[view];
      const prev = k > 0 ? stages.masks[CUT_STAGES[k - 1]] : null;
      for (let i = 0; i < w * h; i++) {
        if (changes && prev) {
          if (m[i] && !prev[i]) put(i, ADDED, 200);
          else if (!m[i] && prev[i]) put(i, REMOVED, 200);
        } else if (m[i]) put(i, AMBER, 130);
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [view, changes, stages, classes, finalAlpha, w, h]);

  const tab = (v: View, label: React.ReactNode, key = v) => (
    <button
      key={key}
      type="button"
      onClick={() => setView(v)}
      className={`w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] ${view === v ? 'bg-amber-500/15 text-amber-200 border border-amber-500/40' : 'text-slate-300 hover:bg-white/[0.05] border border-transparent'}`}
    >
      {label}
    </button>
  );

  return (
    <div data-testid="pipeline-stages" className="fixed inset-0 z-[130] bg-black/95 flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">Pipeline stages — {cut.label}</h3>
          <p className="text-[10px] text-slate-400">Staff only. Each stage is the whole surface as that step left it; “Show changes” colours what it added (green) or removed (red).</p>
        </div>
        <button type="button" aria-label="Close pipeline stages" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06]">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 min-h-0 flex gap-3">
        <div className="w-64 shrink-0 overflow-y-auto flex flex-col gap-1">
          {tab('classMap', 'SegFormer class map')}
          {stats.map((s) =>
            tab(
              s.stage,
              <span className="flex flex-col">
                <span>{CUT_STAGE_LABELS[s.stage]}</span>
                <span className="font-mono text-[9px] text-slate-500">
                  {s.pct.toFixed(1)}% of photo
                  {s.stage !== 'classCandidate' && ` · +${s.added} / −${s.removed} px`}
                </span>
              </span>
            )
          )}
          {tab('occluder', 'Occluders (restored on top)')}
          {tab('final', <span className="flex flex-col"><span>Final render mask</span><span className="text-[9px] text-slate-500">exactly what renderMaterial() paints</span></span>)}
          <label className="mt-2 flex items-center gap-2 text-[11px] text-slate-300">
            <input type="checkbox" checked={changes} onChange={(e) => setChanges(e.target.checked)} /> Show changes
          </label>
          {view === 'classMap' && (
            <ul className="mt-2 text-[10px] text-slate-400 space-y-0.5">
              {classes.slice(0, 14).map((c, k) => (
                <li key={c.v} className="flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: `rgb(${CLASS_COLOURS[k % CLASS_COLOURS.length].join(',')})` }} />
                  {c.name} <span className="font-mono text-slate-500">{c.pct.toFixed(1)}%</span>
                </li>
              ))}
            </ul>
          )}
          {finalError && <p className="mt-2 text-[10px] text-rose-300">{finalError}</p>}
        </div>
        <div className="flex-1 min-w-0 overflow-auto flex items-start justify-center">
          <div className="relative w-full max-w-5xl">
            <img src={imageUrl} alt="" crossOrigin="anonymous" className="block w-full h-auto" />
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
            {view === 'final' && !finalAlpha && !finalError && (
              <p className="absolute top-2 left-2 flex items-center gap-1 text-[10px] text-slate-300 bg-black/60 rounded px-2 py-1">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading the render mask…
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
