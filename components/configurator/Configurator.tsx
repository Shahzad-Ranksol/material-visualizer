import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { APP } from '../../apps';
import { APP_SCENES } from '../../scenes/appScenes';
import { BAKED } from '../../scenes/baked';
import { materialById } from '../../scenes/materials';
import { decodeLook, encodeLook, initialStudioState, studioReducer } from '../../scenes/studioState';
import { ORIGINAL } from '../../scenes/styles';
import { styleBake } from '../../scenes/stylesBaked';
import { SceneCategory } from '../../scenes/types';
import { SceneCanvas } from '../studio/SceneCanvas';
import { useComposedScene } from '../studio/useComposedScene';
import { useLookRender } from '../studio/useLookRender';
import { useSceneMasks } from '../studio/useSceneMasks';
import { BrandBar } from './BrandBar';
import { FinishChoices } from './FinishChoices';
import { StyleChoices } from './StyleChoices';
import { SummaryStep } from './SummaryStep';
import { lookLabel, stepItems, stepMaterial, stepOfItem, wizardSteps } from './wizard';

// A look shared by link (?scene=…&styles=…&look=…&step=…), else the app's first scene, step 0
const initialLook = () => {
  const shared = decodeLook(
    window.location.search,
    (id) => APP_SCENES.some((s) => s.id === id),
    (sceneId, itemId) => !!APP_SCENES.find((s) => s.id === sceneId)?.items.some((i) => i.id === itemId),
    (id) => !!materialById(id),
    (sceneId, groupId, optionId) => !!styleBake(sceneId, groupId, optionId)
  );
  return {
    state: shared ? initialStudioState(shared.sceneId, shared.assignments, shared.styles) : initialStudioState(APP_SCENES[0].id),
    step: shared?.step ?? 0,
  };
};

/**
 * The configurator: the scene pinned on top (or on the left on wide screens), one question per
 * step below it, and Back / Next. Each answer is rendered on the real photo straight away —
 * designs from the baked AI styles, finishes by the WebGL renderer — so the customer watches
 * their room change as they go. The look and step live in the URL: that's the share link.
 */
export const Configurator: React.FC = () => (APP_SCENES.length ? <Wizard /> : <Navigate to="/" replace />);

const Wizard: React.FC = () => {
  const initial = useMemo(initialLook, []);
  const [state, dispatch] = useReducer(studioReducer, initial.state);
  const scene = APP_SCENES.find((s) => s.id === state.sceneId)!;
  const baked = BAKED[scene.id];
  const steps = useMemo(() => wizardSteps(APP, scene, (id) => !!baked?.items[id], APP_SCENES.length), [scene, baked]);
  const [index, setIndex] = useState(() => Math.min(initial.step, steps.length - 1));
  const step = steps[Math.min(index, steps.length - 1)];
  const last = steps.length - 1;
  const [compare, setCompare] = useState(false);

  // The picture and the styles really drawn in it: masks follow those, never a style still loading
  const { url: photoUrl, drawn, error: styleError, bakedLight } = useComposedScene(scene, state.styles);
  const light = new URLSearchParams(window.location.search).get('light') === 'recovered' ? undefined : bakedLight;
  const masks = useSceneMasks(scene, drawn);
  const { url: renderUrl, rendering, error: renderError } = useLookRender(scene, state.assignments, drawn, photoUrl, light);
  const error = renderError ?? styleError;

  // The last design change sweeps a soft light over its area, once the new design is on screen
  const [sweep, setSweep] = useState<{ rect: { x: number; y: number; w: number; h: number }; token: number } | null>(null);
  const pendingSweep = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const shownUrl = renderUrl ?? photoUrl;
  useEffect(() => {
    if (!pendingSweep.current || rendering) return;
    setSweep({ rect: pendingSweep.current, token: Date.now() });
    pendingSweep.current = null;
  }, [shownUrl, rendering]);
  // The finish just applied, rolled on over its items when its look arrives
  const [paint, setPaint] = useState<{ itemIds: string[]; token: number } | null>(null);

  // The step's items get the brass outline for a moment when it opens, to show what it changes
  const [flash, setFlash] = useState<string[]>([]);
  useEffect(() => {
    const items = stepItems(step);
    setFlash(items);
    const t = setTimeout(() => setFlash([]), 1400);
    return () => clearTimeout(t);
  }, [step]);

  const query = encodeLook({ ...state, step: index });
  useEffect(() => window.history.replaceState(null, '', `${window.location.pathname}?${query}`), [query]);
  // The share link opens on the summary
  const shareUrl = `${window.location.origin}${window.location.pathname}?${encodeLook({ ...state, step: last })}`;

  const panel = useRef<HTMLDivElement>(null);
  const go = (to: number) => {
    setCompare(false);
    setIndex(Math.max(0, Math.min(last, to)));
    panel.current?.scrollTo?.({ top: 0 });
    // On phones the panel is below the picture: bring the new question into view
    if (window.innerWidth < 1024) panel.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  };

  const pickScene = (id: SceneCategory) => {
    setPaint(null);
    dispatch({ type: 'scene', sceneId: id });
  };

  const look = lookLabel(steps, state.styles, state.assignments);
  const designSteps = steps.filter((s) => s.kind === 'design').length;

  return (
    <div className="min-h-screen bg-paper font-grotesk text-spruce">
      <BrandBar note={`Step ${index + 1} of ${steps.length}`} progress={{ at: index, of: steps.length }} />

      <main className="mx-auto grid max-w-[1280px] gap-5 px-4 pb-32 pt-2 sm:px-8 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-10 lg:pb-12 lg:pt-4">
        {/* The picture: pinned under the header on phones, sticky on the left on wide screens */}
        <div className="sticky top-[76px] z-20 -mx-4 self-start bg-paper px-4 pb-2 sm:mx-0 sm:px-0 lg:top-24">
          <div className="relative overflow-hidden rounded-2xl shadow-[0_24px_50px_-32px_rgba(30,43,41,0.55)] ring-1 ring-black/5">
            <SceneCanvas
              scene={scene}
              renderUrl={renderUrl}
              masks={masks}
              selected={flash}
              rendering={rendering}
              compare={compare}
              paint={paint}
              sweep={sweep && baked ? { ...sweep, width: baked.width, height: baked.height } : null}
              onSelect={(id) => {
                const to = id ? stepOfItem(steps, id) : -1;
                if (to >= 0 && to !== index) go(to);
              }}
            />
            {!compare && (
              <span data-testid="look-chip" className="pointer-events-none absolute left-3 top-3 max-w-[70%] truncate rounded-full bg-paper/95 px-3 py-1 text-[12px] font-medium text-spruce shadow-[0_4px_14px_-6px_rgba(30,43,41,0.4)]">
                {look || `${scene.title} · as shown`}
              </span>
            )}
            <button
              type="button"
              data-testid="compare-toggle"
              onClick={() => setCompare((c) => !c)}
              disabled={!renderUrl}
              aria-pressed={compare}
              className={`absolute bottom-3 right-3 rounded-full px-3 py-1.5 text-[12px] font-medium shadow-[0_4px_14px_-6px_rgba(30,43,41,0.45)] transition disabled:hidden ${
                compare ? 'bg-spruce text-paper' : 'bg-paper/95 text-spruce hover:bg-paper'
              }`}
            >
              {compare ? 'Done' : 'Before / after'}
            </button>
          </div>
          {error && <p className="mt-2 text-sm text-[#9b3d33]">{error}</p>}
          {scene.source === 'unsplash' && <p className="mt-1.5 hidden text-[11px] text-spruce-soft/80 lg:block">Photo by {scene.credit.replace(/ \(.*\)$/, '')} on Unsplash</p>}
        </div>

        <div ref={panel} className="scroll-mt-[60vh] lg:flex lg:max-h-[calc(100vh-7rem)] lg:flex-col lg:self-start lg:rounded-2xl lg:border lg:border-line lg:bg-white/60 lg:sticky lg:top-24">
          <div key={step.id} className="motion-safe:animate-[pop-in_220ms_ease-out] lg:flex-1 lg:overflow-y-auto lg:p-6">
            <h1 className="font-serif text-[28px] leading-[1.1] text-spruce sm:text-[32px]">{step.title}</h1>
            <p className="mt-1.5 text-[14px] leading-relaxed text-spruce-soft">{step.hint}</p>

            <div className="mt-5 space-y-6">
              {step.kind === 'scene' && (
                <div className="grid grid-cols-2 gap-2.5">
                  {APP_SCENES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      aria-pressed={s.id === scene.id}
                      onClick={() => pickScene(s.id)}
                      className={`rounded-xl border bg-white p-2 text-left transition ${s.id === scene.id ? 'border-spruce' : 'border-line hover:border-spruce/40'}`}
                    >
                      <img src={s.thumbnail} alt="" className="aspect-[4/3] w-full rounded-lg object-cover" />
                      <span className="mt-2 block px-1 text-[13px] font-semibold">{s.title}</span>
                    </button>
                  ))}
                </div>
              )}

              {step.kind === 'design' && step.styleGroup && baked && (
                <div>
                  {step.finishItems && <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-spruce-soft">Design</h2>}
                  <StyleChoices
                    scene={scene}
                    group={step.styleGroup}
                    width={baked.width}
                    height={baked.height}
                    activeId={state.styles[step.styleGroup.id] ?? ORIGINAL}
                    onPick={(optionId) => {
                      setCompare(false);
                      setPaint(null);
                      const bake = styleBake(scene.id, step.styleGroup!.id, optionId) ?? styleBake(scene.id, step.styleGroup!.id, state.styles[step.styleGroup!.id] ?? ORIGINAL);
                      if (bake) pendingSweep.current = bake.rect;
                      dispatch({ type: 'style', groupId: step.styleGroup!.id, optionId });
                    }}
                  />
                </div>
              )}

              {step.kind === 'design' && step.finishItems && step.materials && (
                <div>
                  {step.styleGroup && <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-spruce-soft">{step.finish?.label ?? 'Finish'}</h2>}
                  <FinishChoices
                    materials={step.materials}
                    activeId={stepMaterial(step, state.assignments)?.id ?? null}
                    onPick={(materialId) => {
                      setCompare(false);
                      if (materialId) {
                        setPaint({ itemIds: step.finishItems!, token: Date.now() });
                        dispatch({ type: 'assign', itemIds: step.finishItems!, materialId });
                      } else {
                        setPaint(null);
                        for (const itemId of step.finishItems!) dispatch({ type: 'remove', itemId });
                      }
                    }}
                  />
                </div>
              )}

              {step.kind === 'summary' && (
                <SummaryStep
                  scene={scene}
                  steps={steps}
                  styles={state.styles}
                  assignments={state.assignments}
                  renderUrl={renderUrl}
                  shareUrl={shareUrl}
                  onEdit={go}
                  onReset={() => {
                    setPaint(null);
                    dispatch({ type: 'reset' });
                    go(0);
                  }}
                />
              )}
            </div>
          </div>

          {/* Back / Next: fixed to the bottom on phones, the foot of the panel on wide screens */}
          <nav
            aria-label="Steps"
            className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper/95 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 backdrop-blur lg:static lg:rounded-b-2xl lg:bg-white/80 lg:px-6 lg:pb-5"
          >
            <div className="mx-auto flex max-w-[1280px] items-center gap-3">
              <p className="min-w-0 flex-1 truncate text-[12px] leading-tight text-spruce-soft">
                {step.kind === 'summary' ? `${designSteps} ${designSteps === 1 ? 'choice' : 'choices'}` : step.kind === 'design' ? (look ? 'Your design so far' : 'Pick one, or skip with Next') : ''}
                {step.kind !== 'summary' && look && <span className="block truncate text-[13px] font-medium text-spruce">{look}</span>}
              </p>
              <button
                type="button"
                data-testid="back"
                aria-label="Back"
                onClick={() => go(index - 1)}
                disabled={index === 0}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-line bg-white text-spruce transition hover:border-spruce/40 disabled:opacity-35"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              {index < last && (
                <button
                  type="button"
                  data-testid="next"
                  onClick={() => go(index + 1)}
                  className="h-11 shrink-0 rounded-full bg-spruce px-7 text-sm font-semibold text-paper transition hover:bg-[#2a3a37]"
                >
                  {index === last - 1 ? 'See my design' : 'Next'}
                </button>
              )}
            </div>
          </nav>
        </div>
      </main>
    </div>
  );
};
