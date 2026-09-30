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
      const { items } = await analyzeRoom(imageUrl, { onProgress: (l) => !cancelled && setStatus(l) });
      const item = items.find((i) => i.surfaceLabel === open.surface);
      if (!item?.anchor) {
        // Not proposed: start empty and draw it with the polygon or brush
        const img = new Image();
        img.src = imageUrl;
        await img.decode();
        const empty = document.createElement('canvas');
        empty.width = img.naturalWidth;
        empty.height = img.naturalHeight;
        return empty;
      }
      const cut = await cutSurface(imageUrl, item.anchor, { label: open.surface, onProgress: (l) => !cancelled && setStatus(l) });
      return unionMasks(cut.parts.map((p) => p.mask));
    })()
      .then((m) => {
        if (cancelled) return;
        setMask(m);
        setStatus(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : `${imageUrl} is missing — run npm run validation:fetch`);
        setStatus(null);
      });
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
    setStatus(null);
    if (!res.ok) {
      setError(body.error ?? 'Could not save');
      return;
    }
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
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={`px-2 py-1 rounded border ${category === c ? 'border-amber-400 text-amber-300' : 'border-white/10'}`}
              >
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
