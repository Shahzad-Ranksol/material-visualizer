import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Loader2, Play, RotateCcw, Save } from 'lucide-react';
import { AreaEditor } from '../AreaEditor';
import { ANALYSIS_VERSION, cutSurface } from '../../services/roomAnalysis';
import { acceptedArea } from '../../services/areaPreview';
import { loadMaskAsAlpha, unionMasks } from '../../services/maskCanvas';
import { SCENES } from '../../scenes/scenes';
import { BakeArea, bakeItem, saveBakedItem } from '../../scenes/sceneBake';
import { BakedScenes, Scene, SceneItem } from '../../scenes/types';

const TINTS = ['#f59e0b', '#22d3ee', '#a78bfa', '#34d399', '#f472b6', '#60a5fa'];

/**
 * Dev only: bakes every preset scene item — the "training" step. Auto-bake runs each item's
 * recipe (SAM cut + clip polygons) and saves it; open an item to correct it in the Area Editor
 * (Protect object, Include area, polygons, brush) and Save. Saved masks and planes are committed
 * and are all the studio ever renders from.
 */
export const SceneBakePage: React.FC = () => {
  const [baked, setBaked] = useState<BakedScenes>({});
  const [sceneId, setSceneId] = useState(SCENES[0].id);
  const [open, setOpen] = useState<SceneItem | null>(null);
  const [area, setArea] = useState<BakeArea | null>(null);
  const [edited, setEdited] = useState<HTMLCanvasElement | null>(null);
  const [dirty, setDirty] = useState(false);
  const [protectedMask, setProtectedMask] = useState<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [bust, setBust] = useState(0);
  const overviewRef = useRef<HTMLCanvasElement>(null);
  const scene = SCENES.find((s) => s.id === sceneId)!;

  const refresh = useCallback(
    () =>
      fetch('/__scenes/baked')
        .then((r) => r.json())
        .then((b: BakedScenes) => {
          setBaked(b);
          setBust(Date.now());
        }),
    []
  );
  useEffect(() => void refresh(), [refresh]);

  // ?run=all|missing[&scene=<id>] starts a bake on load (npm run scenes:bake drives this)
  const started = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const run = params.get('run');
    if (!run || started.current || bust === 0) return; // bust is set once the baked state has loaded
    started.current = true;
    const only = params.get('scene');
    if (only) setSceneId(only as typeof sceneId);
    void autoBake(only ? SCENES.filter((s) => s.id === only) : SCENES, run === 'missing');
  }, [bust]); // eslint-disable-line react-hooks/exhaustive-deps

  // Overview: every baked item of the scene tinted over the photo
  useEffect(() => {
    const canvas = overviewRef.current;
    if (!canvas || open) return;
    let cancelled = false;
    (async () => {
      const img = new Image();
      img.src = scene.photo;
      await img.decode();
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const items = baked[scene.id]?.items ?? {};
      for (const [i, item] of scene.items.entries()) {
        const b = items[item.id];
        if (!b) continue;
        const mask = unionMasks(await Promise.all(b.parts.map((p) => loadMaskAsAlpha(`${p.mask}?v=${bust}`))));
        const tint = document.createElement('canvas');
        tint.width = mask.width;
        tint.height = mask.height;
        const t = tint.getContext('2d')!;
        t.drawImage(mask, 0, 0);
        t.globalCompositeOperation = 'source-in';
        t.fillStyle = TINTS[i % TINTS.length];
        t.fillRect(0, 0, tint.width, tint.height);
        if (cancelled) return;
        ctx.globalAlpha = 0.55;
        ctx.drawImage(tint, 0, 0, canvas.width, canvas.height);
        ctx.globalAlpha = 1;
      }
    })().catch((err) => setError(String(err)));
    return () => {
      cancelled = true;
    };
  }, [scene, baked, bust, open]);

  const bakeAndSave = async (s: Scene, item: SceneItem) => {
    const result = await bakeItem(s, item, { onProgress: (l) => setStatus(`${s.title} · ${item.label}: ${l}`) });
    await saveBakedItem(s.id, item.id, result, { edited: false, analysisVersion: ANALYSIS_VERSION });
    return result;
  };

  const autoBake = async (scenes: Scene[], onlyMissing: boolean) => {
    setError(null);
    setLog([]);
    for (const s of scenes) {
      for (const item of s.items) {
        if (onlyMissing && baked[s.id]?.items[item.id]) continue;
        try {
          const r = await bakeAndSave(s, item);
          setLog((l) => [...l, `✓ ${s.id}/${item.id} — ${r.parts.length} plane(s), confidence ${Math.round(r.confidence * 100)}%`]);
        } catch (err) {
          setLog((l) => [...l, `✗ ${s.id}/${item.id} — ${err instanceof Error ? err.message : String(err)}`]);
        }
      }
    }
    setStatus(null);
    setLog((l) => [...l, 'Done.']);
    await refresh();
  };

  // Opening an item: its baked area if there is one, else a fresh run of its recipe
  const openItem = async (item: SceneItem, rerun = false) => {
    setOpen(item);
    setArea(null);
    setEdited(null);
    setDirty(false);
    setProtectedMask(null);
    setError(null);
    try {
      const b = baked[scene.id]?.items[item.id];
      let next: BakeArea;
      if (b && !rerun) {
        setStatus('Loading baked area…');
        next = {
          kind: item.kind,
          parts: await Promise.all(b.parts.map(async (p) => ({ mask: await loadMaskAsAlpha(`${p.mask}?v=${bust}`), geometry: p.plane }))),
          occluder: b.occluder ? await loadMaskAsAlpha(`${b.occluder}?v=${bust}`) : null,
          confidence: b.confidence,
        };
      } else {
        next = await bakeItem(scene, item, { onProgress: setStatus });
      }
      setArea(next);
      setEdited(unionMasks(next.parts.map((p) => p.mask)));
      setDirty(rerun || !b);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setStatus(null);
  };

  const save = async () => {
    if (!open || !area || !edited) return;
    setStatus('Saving…');
    try {
      const final = { ...area, ...acceptedArea({ parts: area.parts, occluder: area.occluder }, edited, dirty, protectedMask) };
      await saveBakedItem(scene.id, open.id, final, { edited: dirty, analysisVersion: ANALYSIS_VERSION });
      setOpen(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setStatus(null);
  };

  const sceneBaked = baked[scene.id]?.items ?? {};
  return (
    <div className="min-h-screen bg-[#0b0d12] text-slate-200 p-6 flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">Scene bake — prepare the studio's items</h1>
        <span className="text-xs text-slate-400">
          {SCENES.reduce((n, s) => n + s.items.filter((i) => baked[s.id]?.items[i.id]).length, 0)} of {SCENES.reduce((n, s) => n + s.items.length, 0)} items baked
        </span>
        <div className="ml-auto flex gap-2 text-xs">
          <button type="button" data-testid="bake-missing" onClick={() => autoBake(SCENES, true)} disabled={!!status} className="flex items-center gap-1 px-3 py-1.5 rounded border border-white/10 disabled:opacity-50">
            <Play className="w-3 h-3" /> Bake missing
          </button>
          <button type="button" data-testid="bake-all" onClick={() => autoBake(SCENES, false)} disabled={!!status} className="flex items-center gap-1 px-3 py-1.5 rounded bg-amber-500 text-slate-950 font-semibold disabled:opacity-50">
            <RotateCcw className="w-3 h-3" /> Re-bake everything
          </button>
        </div>
      </div>
      {status && (
        <p className="flex items-center gap-1.5 text-xs text-slate-400">
          <Loader2 className="w-3 h-3 animate-spin" /> {status}
        </p>
      )}
      {error && <p className="text-xs text-rose-300">{error}</p>}
      {log.length > 0 && (
        <pre data-testid="bake-log" className="text-[11px] text-slate-400 bg-black/30 rounded p-2 max-h-40 overflow-auto">
          {log.join('\n')}
        </pre>
      )}
      <div className="flex gap-2 text-xs">
        {SCENES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => {
              setOpen(null);
              setSceneId(s.id);
            }}
            className={`px-3 py-1 rounded border ${s.id === sceneId ? 'border-amber-400 text-amber-300' : 'border-white/10'}`}
          >
            {s.title} ({s.items.filter((i) => baked[s.id]?.items[i.id]).length}/{s.items.length})
          </button>
        ))}
      </div>
      {!open && (
        <div className="grid lg:grid-cols-[1fr_280px] gap-4">
          <canvas ref={overviewRef} className="w-full h-auto rounded-lg bg-slate-900" />
          <div className="flex flex-col gap-2">
            {scene.items.map((item, i) => {
              const b = sceneBaked[item.id];
              return (
                <button
                  key={item.id}
                  type="button"
                  data-testid="bake-item"
                  onClick={() => openItem(item)}
                  className="flex items-center gap-2 text-left text-xs px-3 py-2 rounded-lg border border-white/10 hover:border-amber-400/60"
                >
                  <span className="w-3 h-3 rounded-sm" style={{ background: TINTS[i % TINTS.length] }} />
                  <span className="flex-1">{item.label}</span>
                  {b ? (
                    <span className="flex items-center gap-1 text-emerald-400">
                      <Check className="w-3 h-3" /> {b.edited ? 'edited' : `${Math.round(b.confidence * 100)}%`}
                    </span>
                  ) : (
                    <span className="text-slate-500">not baked</span>
                  )}
                </button>
              );
            })}
            <p className="text-[11px] text-slate-500 mt-2">Photo: {scene.credit}</p>
          </div>
        </div>
      )}
      {open && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3 text-xs">
            <span className="font-medium">
              {scene.title} · {open.label}
            </span>
            <button type="button" onClick={() => setOpen(null)} className="ml-auto px-3 py-1.5 rounded border border-white/10">
              Back
            </button>
            <button type="button" onClick={() => openItem(open, true)} disabled={!!status} className="px-3 py-1.5 rounded border border-white/10 disabled:opacity-50">
              Re-run recipe
            </button>
            <button type="button" onClick={save} disabled={!edited || !!status} className="flex items-center gap-1 px-3 py-1.5 rounded bg-amber-500 text-slate-950 font-semibold disabled:opacity-50">
              <Save className="w-3 h-3" /> Save
            </button>
          </div>
          {edited && (
            <AreaEditor
              key={`${open.id}-${area?.confidence}`}
              imageUrl={scene.photo}
              initialMask={edited}
              label={open.label}
              onChange={(mask) => {
                setEdited(mask);
                setDirty(true);
              }}
              onProtectedChange={setProtectedMask}
              onInclude={(include, exclude) =>
                cutSurface(scene.photo, include[0] ?? { xPct: open.recipe.anchors[0].xPct * 100, yPct: open.recipe.anchors[0].yPct * 100 }, {
                  label: open.recipe.label,
                  include,
                  // Recipe points are fractions, the editor's (and the worker's) are percentages
                  exclude: [...(open.recipe.exclude ?? []).map((q) => ({ xPct: q.xPct * 100, yPct: q.yPct * 100 })), ...exclude],
                }).then((c) => unionMasks(c.parts.map((p) => p.mask)))
              }
            />
          )}
        </div>
      )}
    </div>
  );
};
