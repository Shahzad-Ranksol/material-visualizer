import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { SCENES, sceneById } from './scenes/scenes';
import { BAKED } from './scenes/baked';
import { materialById, materialsFor } from './scenes/materials';
import { decodeLook, encodeLook, initialStudioState, studioReducer } from './scenes/studioState';
import { SceneCanvas } from './components/studio/SceneCanvas';
import { FinishPanel } from './components/studio/FinishPanel';
import { DesignSummary } from './components/studio/DesignSummary';
import { useSceneMasks } from './components/studio/useSceneMasks';
import { useLookRender } from './components/studio/useLookRender';
import { Ambient } from './components/studio/Ambient';
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
  const photoUrl = useComposedScene(scene, state.styles);
  const masks = useSceneMasks(scene, state.styles);
  const { url: renderUrl, rendering, error } = useLookRender(scene, state.assignments, state.styles, photoUrl);
  // The style group of the selection, when every selected item belongs to the same one
  const selectedGroups = [...new Set(state.selected.map((id) => groupOfItem(scene.id, id)?.id))];
  const styleGroup = selectedGroups.length === 1 && selectedGroups[0] ? STYLE_GROUPS.find((g) => g.id === selectedGroups[0]) : undefined;
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

  const query = encodeLook(state);
  useEffect(() => window.history.replaceState(null, '', `${window.location.pathname}?${query}`), [query]);
  const shareUrl = `${window.location.origin}${window.location.pathname}?${query}`;

  const selectedItems = scene.items.filter((i) => state.selected.includes(i.id));
  const materials = useMemo(() => materialsFor(scene.id, [...new Set(selectedItems.map((i) => i.role))]), [scene.id, selectedItems]);
  const shared = new Set(selectedItems.map((i) => state.assignments[i.id]));
  const activeId = shared.size === 1 ? ([...shared][0] ?? null) : null;
  const finishedCount = Object.keys(state.assignments).length;

  const pickScene = (id: (typeof SCENES)[number]['id']) => {
    setCompare(false);
    dispatch({ type: 'scene', sceneId: id });
  };

  return (
    <div className="relative min-h-screen font-grotesk text-[#f4efe6]">
      <Ambient src={renderUrl ?? photoUrl} />
      <header className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-6 gap-y-3 px-4 pt-5 sm:px-8">
        <Link to="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-[#e6c88f] to-[#a9824a] text-xs font-black text-[#1c1915]">F</span>
          Finish Studio
        </Link>
        <nav aria-label="Scenes" className="-mx-4 flex flex-1 gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          {SCENES.map((s) => {
            const active = s.id === scene.id;
            return (
              <button
                key={s.id}
                type="button"
                data-testid="scene-tab"
                aria-current={active ? 'page' : undefined}
                onClick={() => pickScene(s.id)}
                className={`flex shrink-0 items-center gap-2 rounded-full py-1 pl-1 pr-4 text-sm font-medium backdrop-blur-md transition ${
                  active ? 'bg-[#f4efe6] text-[#1c1915] shadow-[0_6px_20px_-6px_rgba(0,0,0,0.6)]' : 'bg-white/[0.07] text-[#f4efe6]/85 ring-1 ring-white/10 hover:bg-white/15'
                }`}
              >
                <img src={s.thumbnail} alt="" className="h-7 w-7 rounded-full object-cover" />
                {s.title}
              </button>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto grid max-w-[1500px] gap-6 px-4 pb-10 pt-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-4xl font-semibold leading-none tracking-[-0.035em] sm:text-6xl">{scene.title}</h1>
              <p className="mt-2 text-[#a39e94]">{scene.tagline}</p>
            </div>
            <button
              type="button"
              data-testid="compare-toggle"
              onClick={() => setCompare((c) => !c)}
              disabled={!renderUrl}
              aria-pressed={compare}
              className={`rounded-full px-4 py-2 text-sm font-medium backdrop-blur-md transition disabled:opacity-40 ${
                compare ? 'bg-[#d9b77a] text-[#1c1915]' : 'bg-white/10 text-[#f4efe6] ring-1 ring-white/15 hover:bg-white/20'
              }`}
            >
              {compare ? 'Back to editing' : 'Compare with original'}
            </button>
          </div>

          <div className="relative">
            <SceneCanvas
              scene={scene}
              renderUrl={renderUrl}
              masks={masks}
              rendering={rendering}
              compare={compare}
              sweep={sweep && BAKED[scene.id] ? { ...sweep, width: BAKED[scene.id]!.width, height: BAKED[scene.id]!.height } : null}
              onSelect={(id, additive) => (id ? dispatch({ type: 'select', itemId: id, additive }) : dispatch({ type: 'clearSelection' }))}
            />
            {!state.selected.length && !finishedCount && !compare && (
              <div className="pointer-events-none absolute left-4 top-4 rounded-full bg-black/45 px-4 py-2 text-sm text-[#f4efe6] backdrop-blur-md">
                Click anything in the room to change its finish
              </div>
            )}
          </div>
          {error && <p className="mt-3 text-sm text-red-300">{error}</p>}

          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl bg-white/[0.05] p-2 ring-1 ring-white/10 backdrop-blur-md" role="group" aria-label="Items in this scene">
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
                  className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium transition disabled:opacity-40 ${
                    on ? 'bg-[#d9b77a] text-[#1c1915] shadow-[0_0_20px_-4px_rgba(217,183,122,0.7)]' : 'bg-white/[0.06] text-[#f4efe6]/90 hover:bg-white/15'
                  }`}
                >
                  {finish && <img src={finish.thumbnail} alt="" className="h-4 w-4 rounded-full object-cover ring-1 ring-white/40" />}
                  {item.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => dispatch({ type: 'selectAll', itemIds: scene.items.filter((i) => baked[i.id]).map((i) => i.id) })}
              className="ml-auto px-3 text-sm text-[#a39e94] underline-offset-2 hover:text-[#f4efe6] hover:underline"
            >
              Select all
            </button>
          </div>
          <p className="mt-4 text-xs text-[#a39e94]">
            {scene.source === 'unsplash' ? `Photo by ${scene.credit.replace(/ \(.*\)$/, '')} on Unsplash · ` : ''}
            {finishedCount} of {scene.items.length} items finished
          </p>
        </div>

        <aside className="flex flex-col gap-6 rounded-3xl bg-[#1c1915]/70 p-5 ring-1 ring-white/10 backdrop-blur-xl shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)] lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto">
          {styleGroup && BAKED[scene.id] && (
            <StylePicker
              scene={scene}
              group={styleGroup}
              width={BAKED[scene.id]!.width}
              height={BAKED[scene.id]!.height}
              activeId={state.styles[styleGroup.id] ?? ORIGINAL}
              onPick={(optionId) => {
                setCompare(false);
                const bake = styleBake(scene.id, styleGroup.id, optionId) ?? styleBake(scene.id, styleGroup.id, state.styles[styleGroup.id] ?? ORIGINAL);
                if (bake) pendingSweep.current = bake.rect;
                dispatch({ type: 'style', groupId: styleGroup.id, optionId });
              }}
            />
          )}
          <FinishPanel
            selectedLabels={selectedItems.map((i) => i.label)}
            materials={materials}
            activeId={activeId}
            onApply={(materialId) => {
              setCompare(false);
              dispatch({ type: 'apply', materialId });
            }}
          />
          <DesignSummary
            scene={scene}
            assignments={state.assignments}
            renderUrl={renderUrl}
            shareUrl={shareUrl}
            onRemove={(itemId) => dispatch({ type: 'remove', itemId })}
            onReset={() => dispatch({ type: 'reset' })}
            onSelect={(itemId) => dispatch({ type: 'select', itemId, additive: false })}
          />
        </aside>
      </main>
    </div>
  );
};

export default App;
