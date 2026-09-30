import React, { useEffect, useState } from 'react';
import { X, Loader2, Check } from 'lucide-react';
import { DetectedItem, Material } from '../types';
import { AreaEditor, EMPTY_AREA_MESSAGE } from './AreaEditor';
import { cutSurface, cutToRenderables, CutSurface, isAbortError } from '../services/roomAnalysis';
import { useSlowJob } from './useSlowJob';
import { SlowJobNotice } from './SlowJobNotice';
import { canvasToAlphaMask, unionMasks } from '../services/maskCanvas';
import { coveragePct } from '../services/areaMaskOps';
import { acceptedArea, previewArea } from '../services/areaPreview';
import { PipelineStagesView } from './PipelineStagesView';

interface SurfaceReviewModalProps {
  imageUrl: string;
  item: DetectedItem;
  // The studio's current material, for the Preview button
  previewMaterial?: Material | null;
  onClose: () => void;
  // The corrected surface, ready to render
  onAccept: (item: DetectedItem) => void;
  // Staff (OWNER/ADMIN): the cut also returns every pipeline stage, viewable in PipelineStagesView
  showDebugTools?: boolean;
}

/**
 * "Confirm only when needed": shown for a surface whose analysis confidence is below the auto
 * threshold. The user sees the exact area and adjusts it in the AreaEditor.
 */
export const SurfaceReviewModal: React.FC<SurfaceReviewModalProps> = ({ imageUrl, item, previewMaterial, onClose, onAccept, showDebugTools = false }) => {
  const [stagesOpen, setStagesOpen] = useState(false);
  const job = useSlowJob();
  // The cut remembers which photo and surface it was made for: on the render where those change
  // (before the effect below clears it) the old cut is already treated as gone
  const [loaded, setLoaded] = useState<{ cut: CutSurface; imageUrl: string; anchor: typeof item.anchor; label: typeof item.surfaceLabel } | null>(null);
  const cut = loaded && loaded.imageUrl === imageUrl && loaded.anchor === item.anchor && loaded.label === item.surfaceLabel ? loaded.cut : null;
  const [editedState, setEdited] = useState<HTMLCanvasElement | null>(null);
  const edited = cut ? editedState : null;
  const [dirty, setDirty] = useState(false);
  // Objects protected in the editor: restored on top of the material
  const [protectedMask, setProtectedMask] = useState<HTMLCanvasElement | null>(null);
  // A Cut/Add or stroke still in progress in the editor: accepting now would drop it
  const [editorBusy, setEditorBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // A new photo or surface: the previous cut (and an enabled "Use this area") must not survive
    setLoaded(null);
    setEdited(null);
    setDirty(false);
    setProtectedMask(null);
    setError(null);
    if (!item.anchor) {
      setError(`"${item.name}" has no detected area to check.`);
      return;
    }
    let cancelled = false;
    const { signal, onProgress } = job.start();
    cutSurface(imageUrl, item.anchor, { label: item.surfaceLabel, debugStages: showDebugTools, signal, onProgress })
      .then((result) => {
        if (cancelled) return;
        job.finish();
        setLoaded({ cut: result, imageUrl, anchor: item.anchor, label: item.surfaceLabel });
        setEdited(unionMasks(result.parts.map((p) => p.mask)));
      })
      .catch((err: unknown) => {
        if (cancelled || isAbortError(err)) return;
        job.finish();
        setError(err instanceof Error ? err.message : 'Could not load the area.');
      });
    return () => {
      cancelled = true;
      job.cancel();
    };
  }, [imageUrl, item.anchor, item.surfaceLabel, item.name, showDebugTools]);

  const accept = () => {
    if (!cut || !edited) return;
    if (coveragePct(canvasToAlphaMask(edited)) === 0) {
      setError(EMPTY_AREA_MESSAGE);
      return;
    }
    // Parts the edit emptied are dropped (with their planes), so every layer can render
    const { parts, occluder } = acceptedArea(cut, edited, dirty, protectedMask);
    if (!parts.length) {
      setError(EMPTY_AREA_MESSAGE);
      return;
    }
    const surfaces = cutToRenderables({ ...cut, occluder, parts });
    // The user has now checked this area
    onAccept({ ...item, surfaces, confidence: Math.round(cut.confidence * 100), needsReview: false, reviewDecision: 'auto' });
  };

  return (
    <div className="fixed inset-0 z-[110] bg-black/90 backdrop-blur-sm flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-baseline gap-2">
            <h3 className="text-sm font-semibold text-white">Check the “{item.name}” area</h3>
            {cut && (
              <span data-testid="surface-review-confidence" className="text-[10px] text-slate-500 font-mono">
                Confidence {Math.round(cut.confidence * 100)}%
              </span>
            )}
            {cut?.stages && (
              <button type="button" onClick={() => setStagesOpen(true)} className="text-[10px] px-2 py-0.5 rounded-md border border-white/[0.1] text-slate-300 hover:text-white">
                Pipeline stages
              </button>
            )}
          </div>
          <p className="text-[10px] text-slate-400">The amber area is exactly what gets the new material. Every step can be undone.</p>
          {cut && cut.reviewReasons.length > 0 && (
            <ul data-testid="surface-review-reasons" className="mt-1 text-[10px] text-amber-300/90 list-disc list-inside">
              {cut.reviewReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </div>
        <button type="button" aria-label="Close" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06]">
          <X className="w-4 h-4" />
        </button>
      </div>
      {!cut && !error && (
        <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> {job.label ?? 'Loading the area…'}
        </p>
      )}
      {!cut && !error && <SlowJobNotice slow={job.slow} label={job.label} onCancel={onClose} />}
      {cut && edited && (
        <AreaEditor
          imageUrl={imageUrl}
          initialMask={edited}
          label={item.name}
          onBusyChange={setEditorBusy}
          onChange={(mask) => {
            setEdited(mask);
            setDirty(true);
            setError(null);
          }}
          onPreview={
            previewMaterial
              ? (mask) => previewArea(imageUrl, { kind: cut.kind, parts: cut.parts, occluder: cut.occluder }, mask, dirty, previewMaterial, null, protectedMask)
              : undefined
          }
          onProtectedChange={setProtectedMask}
          // Include area: the same surface re-cut with the user's include/exclude prompts
          onInclude={(include, exclude) =>
            cutSurface(imageUrl, item.anchor!, { label: item.surfaceLabel, include, exclude }).then((c) => unionMasks(c.parts.map((p) => p.mask)))
          }
        />
      )}
      {error && <p className="text-[11px] text-rose-300">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-white/[0.05] border border-white/[0.08] text-xs text-slate-300 hover:text-white">
          Cancel
        </button>
        <button
          type="button"
          onClick={accept}
          disabled={!cut || editorBusy}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600 text-slate-950 text-xs font-semibold disabled:opacity-60"
        >
          <Check className="w-3.5 h-3.5" /> Use this area
        </button>
      </div>
      {stagesOpen && cut?.stages && <PipelineStagesView imageUrl={imageUrl} cut={cut} onClose={() => setStagesOpen(false)} />}
    </div>
  );
};
