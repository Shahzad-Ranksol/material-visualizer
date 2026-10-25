import React, { useEffect, useState } from 'react';
import { Check, Loader2, Sparkles } from 'lucide-react';
import { SCENES } from '../../scenes/scenes';
import { groupsFor, optionsFor, StyleGroup, StyleOption, styleKey } from '../../scenes/styles';
import { acceptCandidate, Candidate, generateCandidates, groupRegion, rgbaCanvas } from '../../scenes/styleGen';
import { BakedScenes, StyleBakes } from '../../scenes/types';

/**
 * Dev only: the style lab. For a scene's style group, the image AI redesigns only the group's
 * area (Generate), you pick the candidate that looks right (Use this) — that is the quality gate —
 * and its patch is saved and its items baked for the studio. Needs GEMINI_API_KEY or
 * OPENAI_API_KEY in .env (read by the dev server only).
 */
export const StyleLabPage: React.FC = () => {
  const [baked, setBaked] = useState<BakedScenes>({});
  const [styles, setStyles] = useState<StyleBakes>({});
  const [provider, setProvider] = useState<string | null | undefined>(undefined);
  const [sceneId, setSceneId] = useState(SCENES[0].id);
  const [open, setOpen] = useState<{ group: StyleGroup; option: StyleOption } | null>(null);
  const [candidates, setCandidates] = useState<Array<Candidate & { preview: string }>>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scene = SCENES.find((s) => s.id === sceneId)!;

  const refresh = () =>
    Promise.all([fetch('/__scenes/baked').then((r) => r.json()), fetch('/__styles/baked').then((r) => r.json()), fetch('/__styles/provider').then((r) => r.json())]).then(
      ([b, s, p]) => {
        setBaked(b);
        setStyles(s);
        setProvider(p.provider);
      }
    );
  useEffect(() => void refresh(), []);

  const generate = async (group: StyleGroup, option: StyleOption, reuse = true) => {
    setOpen({ group, option });
    setCandidates([]);
    setError(null);
    try {
      setStatus(reuse ? 'Loading…' : 'Asking the AI for 4 designs… (about 20–60 s)');
      const region = await groupRegion(baked, scene, group);
      const { candidates: got, errors } = await generateCandidates(scene, group, option, region, 4, reuse);
      setCandidates(got.map((c) => ({ ...c, preview: rgbaCanvas(c.blended).toDataURL('image/jpeg', 0.9) })));
      if (errors.length) setError(`${errors.length} of 4 failed: ${errors[0]}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setStatus(null);
  };

  const accept = async (c: Candidate) => {
    if (!open) return;
    setError(null);
    try {
      const region = await groupRegion(baked, scene, open.group);
      await acceptCandidate(baked, scene, open.group, open.option, region, c, provider ?? 'unknown', setStatus);
      setOpen(null);
      setCandidates([]);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setStatus(null);
  };

  const sceneStyles = styles[scene.id] ?? {};
  return (
    <div className="min-h-screen bg-[#0b0d12] text-slate-200 p-6 flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">Style lab — AI design styles</h1>
        <span className={`text-xs ${provider ? 'text-emerald-400' : 'text-amber-300'}`}>
          {provider === undefined ? '…' : provider ? `Image AI: ${provider}` : 'No image AI key — set GEMINI_API_KEY or OPENAI_API_KEY in .env and restart npm run dev'}
        </span>
      </div>
      <div className="flex gap-2 text-xs">
        {SCENES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => {
              setSceneId(s.id);
              setOpen(null);
              setCandidates([]);
            }}
            className={`px-3 py-1 rounded border ${s.id === sceneId ? 'border-amber-400 text-amber-300' : 'border-white/10'}`}
          >
            {s.title}
          </button>
        ))}
      </div>
      {status && (
        <p className="flex items-center gap-1.5 text-xs text-slate-400">
          <Loader2 className="w-3 h-3 animate-spin" /> {status}
        </p>
      )}
      {error && <p className="text-xs text-rose-300">{error}</p>}

      <div className="grid lg:grid-cols-[320px_1fr] gap-6">
        <div className="flex flex-col gap-4">
          {groupsFor(scene.id).map((group) => (
            <div key={group.id}>
              <h2 className="text-sm font-semibold mb-2">{group.label}</h2>
              <div className="flex flex-col gap-1.5">
                {optionsFor(group.id).map((option) => {
                  const done = sceneStyles[styleKey(group.id, option.id)];
                  const baked = done && group.itemIds.every((id) => done.items[id]);
                  return (
                    <button
                      key={option.id}
                      type="button"
                      data-testid="style-option"
                      disabled={!provider || !!status}
                      onClick={() => generate(group, option)}
                      className={`flex items-center gap-2 text-left text-xs px-3 py-2 rounded-lg border disabled:opacity-50 ${
                        open?.option === option ? 'border-amber-400' : 'border-white/10 hover:border-amber-400/60'
                      }`}
                    >
                      <Sparkles className="w-3 h-3 text-amber-300" />
                      <span className="flex-1">{option.label}</span>
                      {baked ? (
                        <span className="flex items-center gap-1 text-emerald-400">
                          <Check className="w-3 h-3" /> ready
                        </span>
                      ) : done ? (
                        <span className="text-amber-300">not baked</span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div>
          {!open && <img src={scene.photo} alt="" className="w-full rounded-lg" />}
          {open && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <p className="text-xs text-slate-400">
                  {open.group.label} → {open.option.label}. Pick the candidate whose seams, perspective and lighting look right; Generate again if none do.
                </p>
                <button
                  type="button"
                  disabled={!!status}
                  onClick={() => generate(open.group, open.option, false)}
                  className="ml-auto shrink-0 px-3 py-1.5 rounded border border-white/15 text-xs disabled:opacity-50"
                >
                  Generate again
                </button>
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                {candidates.map((c, i) => (
                  <div key={i} className="flex flex-col gap-2">
                    <img src={c.preview} alt={`Candidate ${i + 1}`} className="w-full rounded-lg" />
                    <button
                      type="button"
                      disabled={!!status}
                      onClick={() => accept(c)}
                      className="self-start px-3 py-1.5 rounded bg-amber-500 text-slate-950 text-xs font-semibold disabled:opacity-50"
                    >
                      Use this
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
