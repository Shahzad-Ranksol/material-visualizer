import React, { useEffect, useRef, useState } from 'react';
import { maskOutline } from '../../services/areaMaskOps';
import { hitTest } from '../../scenes/recipeMask';
import { Scene } from '../../scenes/types';
import { ItemMask } from './useSceneMasks';
import { Box, maskBounds, unionBounds } from './geometry';
import { drawStrokes, PAINT_MS, rollerStrokes } from './paintReveal';

interface Props {
  scene: Scene;
  renderUrl: string | null;
  masks: ItemMask[];
  // Selected items: outlined in brass
  selected: string[];
  rendering: boolean;
  compare: boolean;
  // A finish was just applied to these items: the next look is rolled on over them
  paint: { itemIds: string[]; token: number } | null;
  // A design style just changed: a soft light sweeps across that area (photo px)
  sweep?: { rect: { x: number; y: number; w: number; h: number }; token: number; width: number; height: number } | null;
  onSelect: (itemId: string | null, additive: boolean) => void;
}

// The item under the pointer: a fine white line with a dark halo, so it reads on light and dark
// finishes alike. Selected items: a fine brass line. Nothing is tinted — the picture stays the picture
const LINE = [255, 255, 255, 235];
const HALO = [20, 28, 27, 90];
const SELECTED = [201, 160, 98, 255];
const SELECTED_HALO = [255, 250, 240, 150];

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The union of some items' masks as a white canvas with their alpha, at the masks' size. */
const unionCanvas = (masks: ItemMask[]): HTMLCanvasElement | null => {
  if (!masks.length) return null;
  const { width: w, height: h } = masks[0].mask;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    let a = 0;
    for (const m of masks) a = Math.max(a, m.mask.alpha[i]);
    if (a) img.data.set([255, 255, 255, a], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
};

/**
 * The scene itself: the current look over the photo. The item under the pointer gets a fine
 * outline and its name, selected items a brass one. A finish just applied is rolled on over its
 * items in a few overlapping strokes, then a wet sheen passes over it; any other new look fades
 * in over the previous one. In compare mode a handle wipes between the original photo (left) and
 * the look (right).
 */
export const SceneCanvas: React.FC<Props> = ({ scene, renderUrl, masks, selected, rendering, compare, paint, sweep, onSelect }) => {
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const paintRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [split, setSplit] = useState(50);
  const dragging = useRef(false);
  // The look on screen and the one coming in over it
  const [shown, setShown] = useState<string | null>(renderUrl);
  const [incoming, setIncoming] = useState<string | null>(null);
  // How the incoming look arrives: rolled on over the painted items, or faded in
  const [rolling, setRolling] = useState(false);
  // The wet sheen over the area just painted (its mask as an image, and its box in mask px)
  const [sheen, setSheen] = useState<{ mask: string; box: Box; width: number; height: number; token: number } | null>(null);
  // The latest paint not yet played: each apply rolls on once, on the look it produces
  const pendingPaint = useRef<Props['paint']>(null);
  const playedToken = useRef<number | null>(null);
  useEffect(() => {
    pendingPaint.current = paint && paint.token !== playedToken.current ? paint : null;
  }, [paint]);

  // The fade timer / roll animation of the look coming in: cancelled when another look (or none)
  // replaces it, so an animation armed for a picture that is gone never puts it back on screen
  const fadeTimer = useRef<number | null>(null);
  const frame = useRef<number | null>(null);
  const cancelArrival = () => {
    if (fadeTimer.current !== null) window.clearTimeout(fadeTimer.current);
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    fadeTimer.current = null;
    frame.current = null;
  };
  useEffect(() => {
    cancelArrival();
    setRolling(false);
  }, [incoming]);
  useEffect(() => cancelArrival, []);
  useEffect(() => {
    // No look: the bare photo, and drop any look still on its way in
    if (!renderUrl) {
      setShown(null);
      setIncoming(null);
    } else if (renderUrl !== shown) setIncoming(renderUrl);
  }, [renderUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setSplit(50), [scene.id, compare]);
  // Another scene: never fade from the previous scene's picture, nor roll a paint meant for it
  useEffect(() => {
    setShown(null);
    setIncoming(renderUrl);
    setHover(null);
    setSheen(null);
    pendingPaint.current = null;
  }, [scene.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas || !masks.length) return;
    const { width: w, height: h } = masks[0].mask;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(w, h);
    if (!compare) {
      for (const m of masks.filter((m) => selected.includes(m.id))) {
        const halo = maskOutline(m.mask, 2);
        const line = maskOutline(m.mask, 1);
        for (let i = 0; i < w * h; i++) {
          if (line[i]) img.data.set(SELECTED, i * 4);
          else if (halo[i]) img.data.set(SELECTED_HALO, i * 4);
        }
      }
      const hovered = hover && !selected.includes(hover.id) && masks.find((m) => m.id === hover.id);
      if (hovered) {
        const halo = maskOutline(hovered.mask, 3);
        const line = maskOutline(hovered.mask, 1);
        for (let i = 0; i < w * h; i++) {
          if (line[i]) img.data.set(LINE, i * 4);
          else if (halo[i]) img.data.set(HALO, i * 4);
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [masks, hover?.id, compare, selected.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const promote = (url: string) => {
    setShown(url);
    setIncoming(null);
  };

  const fadeIn = (el: HTMLImageElement, url: string) => {
    requestAnimationFrame(() => (el.style.opacity = '1'));
    // A timer, not transitionend: that event never comes if the browser skips the transition
    fadeTimer.current = window.setTimeout(() => promote(url), reducedMotion() ? 0 : 520);
  };

  /** Rolls `img` on over the items' area: each frame, the new look through the strokes so far. */
  const rollIn = (img: HTMLImageElement, url: string, items: ItemMask[]) => {
    const area = unionCanvas(items);
    const box = unionBounds(items.map((m) => maskBounds(m.mask)).filter((b): b is Box => !!b));
    const out = paintRef.current;
    if (!area || !box || !out) return false;
    const strokes = rollerStrokes(box);
    const reveal = document.createElement('canvas');
    reveal.width = area.width;
    reveal.height = area.height;
    const r = reveal.getContext('2d')!;
    out.width = img.naturalWidth;
    out.height = img.naturalHeight;
    const o = out.getContext('2d')!;
    // A soft wet edge, about 1% of the area's longer side
    const blur = Math.max(1.5, Math.max(box.w, box.h) * 0.01);
    const begin = performance.now();
    setRolling(true);
    const step = (now: number) => {
      const t = Math.min(1, (now - begin) / PAINT_MS);
      r.globalCompositeOperation = 'source-over';
      r.clearRect(0, 0, reveal.width, reveal.height);
      drawStrokes(r, strokes, t, blur);
      r.globalCompositeOperation = 'destination-in';
      r.drawImage(area, 0, 0);
      o.globalCompositeOperation = 'source-over';
      o.clearRect(0, 0, out.width, out.height);
      o.drawImage(img, 0, 0);
      o.globalCompositeOperation = 'destination-in';
      o.drawImage(reveal, 0, 0, out.width, out.height);
      if (t < 1) {
        frame.current = requestAnimationFrame(step);
        return;
      }
      frame.current = null;
      promote(url);
      setSheen({ mask: area.toDataURL(), box, width: area.width, height: area.height, token: now });
    };
    frame.current = requestAnimationFrame(step);
    return true;
  };

  const onIncomingLoad = (el: HTMLImageElement, url: string) => {
    const p = pendingPaint.current;
    if (p && !reducedMotion()) {
      pendingPaint.current = null;
      playedToken.current = p.token;
      const items = masks.filter((m) => p.itemIds.includes(m.id));
      if (items.length && rollIn(el, url, items)) return;
    }
    fadeIn(el, url);
  };

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

  const label = hover && !selected.includes(hover.id) && scene.items.find((i) => i.id === hover.id)?.label;
  const clip = compare ? { clipPath: `inset(0 0 0 ${split}%)` } : undefined;
  const boxStyle = (b: Box, w: number, h: number) => ({ left: `${(b.x / w) * 100}%`, top: `${(b.y / h) * 100}%`, width: `${(b.w / w) * 100}%`, height: `${(b.h / h) * 100}%` });

  return (
    <div
      ref={boxRef}
      data-testid="scene-canvas"
      className={`relative select-none overflow-hidden rounded-xl bg-mist ring-1 ring-line shadow-[0_24px_60px_-28px_rgba(30,43,41,0.45)] touch-none ${compare ? 'cursor-ew-resize' : hover ? 'cursor-pointer' : 'cursor-default'}`}
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
          style={clip}
          draggable={false}
        />
      )}
      {incoming && (
        <img
          key={incoming}
          src={incoming}
          alt=""
          className="absolute inset-0 w-full h-full opacity-0 motion-safe:transition-opacity motion-safe:duration-500"
          style={clip}
          draggable={false}
          onLoad={(e) => onIncomingLoad(e.currentTarget, incoming)}
        />
      )}
      {/* The finish being rolled on */}
      <canvas ref={paintRef} aria-hidden className={`pointer-events-none absolute inset-0 w-full h-full ${rolling ? '' : 'hidden'}`} style={clip} />
      {sheen && !compare && (
        <div
          key={sheen.token}
          aria-hidden
          className="pointer-events-none absolute inset-0 motion-reduce:hidden"
          style={{ WebkitMaskImage: `url(${sheen.mask})`, maskImage: `url(${sheen.mask})`, WebkitMaskSize: '100% 100%', maskSize: '100% 100%' }}
          onAnimationEnd={() => setSheen(null)}
        >
          <div className="absolute overflow-hidden" style={boxStyle(sheen.box, sheen.width, sheen.height)}>
            <div className="absolute inset-y-[-40%] left-0 w-[45%] bg-gradient-to-r from-transparent via-white/45 to-transparent mix-blend-soft-light animate-[wet-sheen_750ms_ease-out_forwards]" />
          </div>
        </div>
      )}
      <canvas ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none" />
      {sweep && !compare && (
        <div key={sweep.token} aria-hidden className="pointer-events-none absolute overflow-hidden motion-reduce:hidden" style={boxStyle(sweep.rect, sweep.width, sweep.height)}>
          <div className="absolute inset-y-[-50%] w-[45%] animate-[style-sweep_900ms_ease-out_forwards] bg-gradient-to-r from-transparent via-white/35 to-transparent [transform:skewX(-18deg)]" />
        </div>
      )}

      {compare && (
        <div className="absolute inset-y-0 pointer-events-none" style={{ left: `${split}%` }}>
          <div className="absolute inset-y-0 -translate-x-1/2 w-px bg-white shadow-[0_0_0_1px_rgba(30,43,41,0.2)]" />
          <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 grid h-10 w-10 place-items-center rounded-full bg-paper text-sm font-semibold text-spruce shadow-[0_6px_20px_-6px_rgba(30,43,41,0.5)] ring-1 ring-line">
            ⇆
          </div>
        </div>
      )}
      {compare && (
        <>
          <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-paper/90 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-spruce-soft">Original</span>
          <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-spruce px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-paper">Your design</span>
        </>
      )}

      {label && !compare && (
        <span
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-[150%] rounded-full bg-paper/95 px-3 py-1 text-xs font-medium text-spruce shadow-[0_4px_14px_-4px_rgba(30,43,41,0.35)]"
          style={{ left: `${hover!.x * 100}%`, top: `${hover!.y * 100}%` }}
        >
          {label}
        </span>
      )}

      {rendering && (
        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-paper/95 px-4 py-2 text-xs font-medium text-spruce shadow-[0_6px_20px_-8px_rgba(30,43,41,0.4)]">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brass" /> Preparing your finish…
        </div>
      )}
    </div>
  );
};
