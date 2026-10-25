import React, { useEffect, useRef, useState } from 'react';
import { maskOutline } from '../../services/areaMaskOps';
import { hitTest } from '../../scenes/recipeMask';
import { Scene } from '../../scenes/types';
import { ItemMask } from './useSceneMasks';

interface Props {
  scene: Scene;
  renderUrl: string | null;
  masks: ItemMask[];
  rendering: boolean;
  compare: boolean;
  // A design style just changed: a soft light sweeps across that area (photo px)
  sweep?: { rect: { x: number; y: number; w: number; h: number }; token: number; width: number; height: number } | null;
  onSelect: (itemId: string | null, additive: boolean) => void;
}

// Only the item under the pointer is outlined: a fine white line with a dark halo so it reads
// on light and dark finishes alike. Nothing is tinted — the picture stays the picture
const LINE = [255, 255, 255, 235];
const HALO = [20, 28, 27, 90];

/**
 * The scene itself: the current look over the photo. The item under the pointer gets a fine
 * outline and its name; clicking picks it (Shift/⌘ adds to the selection). A new look fades in
 * over the previous one. In compare mode a handle wipes between the original photo (left) and
 * the look (right).
 */
export const SceneCanvas: React.FC<Props> = ({ scene, renderUrl, masks, rendering, compare, sweep, onSelect }) => {
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [split, setSplit] = useState(50);
  const dragging = useRef(false);
  // The look on screen and the one fading in over it
  const [shown, setShown] = useState<string | null>(renderUrl);
  const [incoming, setIncoming] = useState<string | null>(null);
  useEffect(() => {
    if (renderUrl === shown) return;
    if (!renderUrl) {
      setShown(null);
      setIncoming(null);
    } else setIncoming(renderUrl);
  }, [renderUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setSplit(50), [scene.id, compare]);
  // Another scene: never fade from the previous scene's picture
  useEffect(() => {
    setShown(null);
    setIncoming(renderUrl);
    setHover(null);
  }, [scene.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas || !masks.length) return;
    const { width: w, height: h } = masks[0].mask;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(w, h);
    const hovered = !compare && hover && masks.find((m) => m.id === hover.id);
    if (hovered) {
      const halo = maskOutline(hovered.mask, 3);
      const line = maskOutline(hovered.mask, 1);
      for (let i = 0; i < w * h; i++) {
        if (line[i]) img.data.set(LINE, i * 4);
        else if (halo[i]) img.data.set(HALO, i * 4);
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [masks, hover?.id, compare]); // eslint-disable-line react-hooks/exhaustive-deps

  const pct = (e: React.PointerEvent) => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  const onMove = (e: React.PointerEvent) => {
    const p = pct(e);
    if (compare) {
      if (dragging.current) setSplit(Math.min(100, Math.max(0, p.x * 100)));
      return;
    }
    const id = hitTest(masks, p.x, p.y);
    setHover(id ? { id, x: p.x, y: p.y } : null);
  };

  const label = hover && scene.items.find((i) => i.id === hover.id)?.label;

  return (
    <div
      ref={boxRef}
      data-testid="scene-canvas"
      className={`relative select-none overflow-hidden rounded-[22px] bg-black/30 ring-1 ring-white/10 shadow-[0_40px_100px_-30px_rgba(0,0,0,0.9)] touch-none ${compare ? 'cursor-ew-resize' : hover ? 'cursor-pointer' : 'cursor-default'}`}
      onPointerMove={onMove}
      onPointerLeave={() => setHover(null)}
      onPointerDown={(e) => {
        if (!compare) return;
        dragging.current = true;
        (e.target as Element).setPointerCapture?.(e.pointerId);
        setSplit(Math.min(100, Math.max(0, pct(e).x * 100)));
      }}
      onPointerUp={() => (dragging.current = false)}
      onClick={(e) => {
        if (compare) return;
        const p = pct(e as unknown as React.PointerEvent);
        onSelect(hitTest(masks, p.x, p.y), e.shiftKey || e.metaKey || e.ctrlKey);
      }}
    >
      <img src={scene.photo} alt={`${scene.title} scene`} className="block w-full h-auto" draggable={false} />
      {shown && (
        <img
          src={shown}
          alt={`${scene.title} with your finishes`}
          data-testid={incoming ? undefined : 'look-image'}
          className="absolute inset-0 w-full h-full"
          style={compare ? { clipPath: `inset(0 0 0 ${split}%)` } : undefined}
          draggable={false}
        />
      )}
      {incoming && (
        <img
          key={incoming}
          src={incoming}
          alt=""
          className="absolute inset-0 w-full h-full opacity-0 motion-safe:transition-opacity motion-safe:duration-500"
          style={compare ? { clipPath: `inset(0 0 0 ${split}%)` } : undefined}
          draggable={false}
          onLoad={(e) => {
            const el = e.currentTarget;
            requestAnimationFrame(() => (el.style.opacity = '1'));
            const done = () => {
              setShown(incoming);
              setIncoming(null);
            };
            // A timer, not transitionend: that event never comes if the browser skips the transition
            window.setTimeout(done, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 520);
          }}
        />
      )}
      <canvas ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none" />
      {sweep && !compare && (
        <div
          key={sweep.token}
          aria-hidden
          className="pointer-events-none absolute overflow-hidden motion-reduce:hidden"
          style={{
            left: `${(sweep.rect.x / sweep.width) * 100}%`,
            top: `${(sweep.rect.y / sweep.height) * 100}%`,
            width: `${(sweep.rect.w / sweep.width) * 100}%`,
            height: `${(sweep.rect.h / sweep.height) * 100}%`,
          }}
        >
          <div className="absolute inset-y-[-50%] w-[45%] animate-[style-sweep_900ms_ease-out_forwards] bg-gradient-to-r from-transparent via-white/35 to-transparent [transform:skewX(-18deg)]" />
        </div>
      )}

      {compare && (
        <div className="absolute inset-y-0 pointer-events-none" style={{ left: `${split}%` }}>
          <div className="absolute inset-y-0 -translate-x-1/2 w-[2px] bg-white/90 shadow-[0_0_0_1px_rgba(30,43,41,0.25)]" />
          <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-white text-[#1c1915] grid place-items-center text-sm font-semibold shadow-lg">
            ⇆
          </div>
        </div>
      )}
      {compare && (
        <>
          <span className="pointer-events-none absolute top-3 left-3 rounded-full bg-black/55 px-2.5 py-1 text-[11px] text-white backdrop-blur-md">Original</span>
          <span className="pointer-events-none absolute top-3 right-3 rounded-full bg-[#d9b77a] px-2.5 py-1 text-[11px] font-semibold text-[#1c1915]">Your design</span>
        </>
      )}

      {label && !compare && (
        <span
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-[140%] rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white backdrop-blur-md"
          style={{ left: `${hover!.x * 100}%`, top: `${hover!.y * 100}%` }}
        >
          {label}
        </span>
      )}

      {rendering && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full bg-black/55 px-4 py-2 text-xs font-medium text-[#f4efe6] backdrop-blur-md">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#d9b77a]" /> Applying finish…
        </div>
      )}
    </div>
  );
};
