import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { SCENES, sceneById } from './scenes/scenes';
import { BAKED } from './scenes/baked';
import { materialById, materialsFor } from './scenes/materials';
import { decodeLook, encodeLook, initialStudioState, studioReducer } from './scenes/studioState';
import { SceneCanvas } from './components/studio/SceneCanvas';
import { FinishPopover } from './components/studio/FinishPopover';
import { DesignSummary } from './components/studio/DesignSummary';
import { useSceneMasks } from './components/studio/useSceneMasks';
import { useLookRender } from './components/studio/useLookRender';
import { Box, maskBounds, unionBounds } from './components/studio/geometry';
import { StylePicker } from './components/studio/StylePicker';
import { useComposedScene } from './components/studio/useComposedScene';
import { groupOfItem, ORIGINAL, STYLE_GROUPS } from './scenes/styles';
import { styleBake } from './scenes/stylesBaked';

// A look shared by link (?scene=…&look=item:material,…), else the first scene
const initialState = () => {
  const shared = decodeLook(
    window.location.search,
    (id) => !!sceneById(id),
    (sceneId, itemId) => !!sceneById(sceneId)?.items.some((i) => i.id === itemId),
    (id) => !!materialById(id),
    (sceneId, groupId, optionId) => !!styleBake(sceneId, groupId, optionId)
  );
  return shared ? initialStudioState(shared.sceneId, shared.assignments, shared.styles) : initialStudioState(SCENES[0].id);
};

/**
 * The finish studio: pick a preset scene, click items in it and try finishes on them. Every item
 * was baked ahead of time (/dev/scenes), so nothing is uploaded and no model runs here.
 */
const App: React.FC = () => {
  const [state, dispatch] = useReducer(studioReducer, undefined, initialState);
  const [compare, setCompare] = useState(false);
  const scene = sceneById(state.sceneId)!;
  const baked = BAKED[scene.id]?.items ?? {};
  // The picture and the styles really drawn in it: masks follow those, never a style still loading
  const { url: photoUrl, drawn, error: styleError, bakedLight } = useComposedScene(scene, state.styles);
  // `?light=recovered` renders without the baked light (the older estimate), for comparison
  const light = new URLSearchParams(window.location.search).get('light') === 'recovered' ? undefined : bakedLight;
  const masks = useSceneMasks(scene, drawn);
  const { url: renderUrl, rendering, error: renderError } = useLookRender(scene, state.assignments, drawn, photoUrl, light);
  const error = renderError ?? styleError;
  // The style groups the selection touches, in catalogue order (doors + worktop shows both)
  const selectedGroupIds = new Set(state.selected.map((id) => groupOfItem(scene.id, id)?.id));
  const styleGroups = STYLE_GROUPS.filter((g) => selectedGroupIds.has(g.id));
  // The last style change, for the reveal sweep over that group's area
  const [sweep, setSweep] = useState<{ rect: { x: number; y: number; w: number; h: number }; token: number } | null>(null);
  // …played once the new design is actually on screen (composing it takes a moment)
  const pendingSweep = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const shownUrl = renderUrl ?? photoUrl;
  useEffect(() => {
    if (!pendingSweep.current || rendering) return;
    setSweep({ rect: pendingSweep.current, token: Date.now() });
    pendingSweep.current = null;
  }, [shownUrl, rendering]);
  // The finish just applied, rolled on over its items when its look arrives
  const [paint, setPaint] = useState<{ itemIds: string[]; token: number } | null>(null);

  const query = encodeLook(state);
  useEffect(() => window.history.replaceState(null, '', `${window.location.pathname}?${query}`), [query]);
  const shareUrl = `${window.location.origin}${window.location.pathname}?${query}`;

  const selectedItems = scene.items.filter((i) => state.selected.includes(i.id));
  const materials = useMemo(() => materialsFor(scene.id, [...new Set(selectedItems.map((i) => i.role))]), [scene.id, selectedItems]);
  const shared = new Set(selectedItems.map((i) => state.assignments[i.id]));
  const activeId = shared.size === 1 ? ([...shared][0] ?? null) : null;
  const finishedCount = Object.keys(state.assignments).length;

  // The picture's box on screen, and the selected area in it, for the finish popover
  const stage = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStageSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const anchor = useMemo((): Box | null => {
    const picked = masks.filter((m) => state.selected.includes(m.id));
    const box = unionBounds(picked.map((m) => maskBounds(m.mask)).filter((b): b is Box => !!b));
    if (!box || !stageSize.w) return null;
    const k = stageSize.w / picked[0].mask.width;
    return { x: box.x * k, y: box.y * k, w: box.w * k, h: box.h * k };
  }, [masks, state.selected.join(), stageSize.w]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickScene = (id: (typeof SCENES)[number]['id']) => {
    setCompare(false);
    setPaint(null);
    dispatch({ type: 'scene', sceneId: id });
  };
  const clearSelection = useMemo(() => () => dispatch({ type: 'clearSelection' }), []);

  return (
    <div className="min-h-screen bg-paper font-grotesk text-spruce">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-10 gap-y-3 px-4 py-4 sm:px-8">
          <Link to="/" className="text-[13px] font-semibold uppercase tracking-[0.28em] text-spruce">
            Finish<span className="text-brass">·</span>Studio
          </Link>
          <nav aria-label="Scenes" className="-mx-4 flex flex-1 gap-1 overflow-x-auto px-4 sm:mx-0 sm:gap-2 sm:px-0">
            {SCENES.map((s) => {
              const active = s.id === scene.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  data-testid="scene-tab"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => pickScene(s.id)}
                  className={`relative flex shrink-0 items-center gap-2 px-2 py-1.5 text-sm transition after:absolute after:inset-x-2 after:-bottom-[17px] after:h-0.5 after:rounded-full after:transition ${
                    active ? 'font-semibold text-spruce after:bg-brass' : 'text-spruce-soft after:bg-transparent hover:text-spruce'
                  }`}
                >
                  <img src={s.thumbnail} alt="" className={`h-6 w-6 rounded-full object-cover ring-1 transition ${active ? 'ring-brass' : 'ring-line'}`} />
                  {s.title}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1440px] gap-8 px-4 pb-14 pt-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-brass">Finish studio</p>
              <h1 className="mt-1 font-serif text-4xl leading-[1.05] text-spruce sm:text-5xl">{scene.title}</h1>
              <p className="mt-2 text-sm text-spruce-soft">
                {scene.tagline}
                <span className="mx-2 text-line">|</span>
                {finishedCount} of {scene.items.length} finished
              </p>
            </div>
            <button
              type="button"
              data-testid="compare-toggle"
              onClick={() => setCompare((c) => !c)}
              disabled={!renderUrl}
              aria-pressed={compare}
              className={`rounded-full px-4 py-2 text-sm font-medium transition disabled:opacity-35 ${
                compare ? 'bg-spruce text-paper' : 'border border-line bg-white text-spruce hover:border-spruce/40'
              }`}
            >
              {compare ? 'Back to editing' : 'Compare with original'}
            </button>
          </div>

          <div ref={stage} className="relative">
            <SceneCanvas
              scene={scene}
              renderUrl={renderUrl}
              masks={masks}
              selected={state.selected}
              rendering={rendering}
              compare={compare}
              paint={paint}
              sweep={sweep && BAKED[scene.id] ? { ...sweep, width: BAKED[scene.id]!.width, height: BAKED[scene.id]!.height } : null}
              onSelect={(id, additive) => (id ? dispatch({ type: 'select', itemId: id, additive }) : dispatch({ type: 'clearSelection' }))}
            />
            {!state.selected.length && !finishedCount && !compare && (
              <div className="pointer-events-none absolute left-4 top-4 rounded-full bg-paper/95 px-4 py-2 text-[13px] text-spruce shadow-[0_6px_20px_-8px_rgba(30,43,41,0.4)]">
                Click anything in the room to change its finish
              </div>
            )}
            {selectedItems.length > 0 && !compare && (
              <FinishPopover
                key={scene.id}
                labels={selectedItems.map((i) => i.label)}
                materials={materials}
                activeId={activeId}
                anchor={anchor}
                container={stageSize}
                onClose={clearSelection}
                onApply={(materialId) => {
                  setCompare(false);
                  setPaint({ itemIds: [...state.selected], token: Date.now() });
                  dispatch({ type: 'apply', materialId });
                }}
              >
                {BAKED[scene.id] &&
                  styleGroups.map((styleGroup) => (
                    <StylePicker
                      key={styleGroup.id}
                      scene={scene}
                      group={styleGroup}
                      width={BAKED[scene.id]!.width}
                      height={BAKED[scene.id]!.height}
                      activeId={state.styles[styleGroup.id] ?? ORIGINAL}
                      onPick={(optionId) => {
                        setCompare(false);
                        setPaint(null);
                        const bake = styleBake(scene.id, styleGroup.id, optionId) ?? styleBake(scene.id, styleGroup.id, state.styles[styleGroup.id] ?? ORIGINAL);
                        if (bake) pendingSweep.current = bake.rect;
                        dispatch({ type: 'style', groupId: styleGroup.id, optionId });
                      }}
                    />
                  ))}
              </FinishPopover>
            )}
          </div>
          {error && <p className="mt-3 text-sm text-[#9b3d33]">{error}</p>}

          <div className="mt-5 flex flex-wrap items-center gap-2" role="group" aria-label="Items in this scene">
            {scene.items.map((item) => {
              const ready = !!baked[item.id];
              const on = state.selected.includes(item.id);
              const finish = materialById(state.assignments[item.id] ?? '');
              return (
                <button
                  key={item.id}
                  type="button"
                  data-testid="item-chip"
                  data-item={item.id}
                  aria-pressed={on}
                  disabled={!ready}
                  title={ready ? undefined : 'Not prepared yet'}
                  onClick={() => {
                    setCompare(false);
                    // Chips toggle, so several items can be picked without a modifier key
                    dispatch({ type: 'select', itemId: item.id, additive: true });
                  }}
                  className={`flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition disabled:opacity-40 ${
                    on ? 'border-spruce bg-spruce text-paper' : 'border-line bg-white text-spruce hover:border-spruce/40'
                  }`}
                >
                  {finish && <img src={finish.thumbnail} alt="" className="h-4 w-4 rounded-full object-cover ring-1 ring-black/10" />}
                  {item.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => dispatch({ type: 'selectAll', itemIds: scene.items.filter((i) => baked[i.id]).map((i) => i.id) })}
              className="ml-auto px-2 text-[13px] text-spruce-soft underline-offset-4 hover:text-spruce hover:underline"
            >
              Select all
            </button>
          </div>
          {scene.source === 'unsplash' && <p className="mt-6 text-[11px] text-spruce-soft/80">Photo by {scene.credit.replace(/ \(.*\)$/, '')} on Unsplash</p>}
        </div>

        <aside className="rounded-xl border border-line bg-white p-6 shadow-[0_20px_50px_-30px_rgba(30,43,41,0.35)] lg:sticky lg:top-6 lg:self-start">
          <DesignSummary
            scene={scene}
            assignments={state.assignments}
            renderUrl={renderUrl}
            shareUrl={shareUrl}
            onRemove={(itemId) => {
              setPaint(null);
              dispatch({ type: 'remove', itemId });
            }}
            onReset={() => {
              setPaint(null);
              dispatch({ type: 'reset' });
            }}
            onSelect={(itemId) => dispatch({ type: 'select', itemId, additive: false })}
          />
        </aside>
      </main>
    </div>
  );
};

export default App;
