import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Scissors, CirclePlus, Pentagon, Hexagon, Brush, Eraser, Undo2, Redo2, ZoomIn, ZoomOut, Maximize, Loader2, Eye } from 'lucide-react';
import {
  AlphaMask,
  History,
  Pt,
  Rect,
  cloneMask,
  combine,
  coveragePct,
  createMaskHistory,
  diffRect,
  fillPolygon,
  isUsableObjectMask,
  maskOutline,
  paintStroke,
} from '../services/areaMaskOps';
import { alphaMaskToCanvas, canvasToAlphaMask, scaleMaskCanvas } from '../services/maskCanvas';
import { cutObject } from '../services/roomAnalysis';

export interface AreaEditorProps {
  imageUrl: string;
  // The starting area (the AI cut or a saved area): white, alpha = coverage
  initialMask: HTMLCanvasElement;
  label: string;
  // Called after every committed edit, with a fresh canvas
  onChange: (mask: HTMLCanvasElement) => void;
  // Renders the material on the current area; resolves to an image URL
  onPreview?: (mask: HTMLCanvasElement) => Promise<string>;
}

// Lives with the mask ops so services (areaPreview) can use it without importing a component
export { EMPTY_AREA_MESSAGE } from '../services/areaMaskOps';

type Tool = 'cut' | 'add' | 'polyAdd' | 'polyRemove' | 'brush' | 'erase';
type View = 'fill' | 'outline' | 'original';

const HISTORY_LIMIT = 30;
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const FLASH_MS = 400;
const CUT_DILATE_PX = 2;
const CLOSE_RADIUS_SCREEN_PX = 10;
const NO_OBJECT_MESSAGE = "Couldn't find a distinct object there — try the polygon tool";
const FILL_RGB = [251, 191, 36];
const OUTLINE_RGB = [34, 211, 238];
const CUT_RGB = [239, 68, 68];
const ADD_RGB = [34, 197, 94];

const TOOLS: Array<{ id: Tool; label: string; Icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'cut', label: 'Cut out object', Icon: Scissors },
  { id: 'add', label: 'Add object/area', Icon: CirclePlus },
  { id: 'polyAdd', label: 'Polygon: add', Icon: Pentagon },
  { id: 'polyRemove', label: 'Polygon: remove', Icon: Hexagon },
  { id: 'brush', label: 'Brush', Icon: Brush },
  { id: 'erase', label: 'Eraser', Icon: Eraser },
];

const HINTS: Record<Tool, string> = {
  cut: 'Click an object that should keep its look (a lamp, the headboard, a curtain) to cut it out.',
  add: 'Click a part of the surface that was missed to add it.',
  polyAdd: 'Click corners to outline an area to add. Click the first corner or double-click to finish · Backspace removes a corner · Esc cancels.',
  polyRemove: 'Click corners to outline an area to remove. Click the first corner or double-click to finish · Backspace removes a corner · Esc cancels.',
  brush: 'Paint to add to the area.',
  erase: 'Paint to remove from the area.',
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const newCanvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

const revokeIfBlob = (url: string | null) => {
  if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
};

/** Writes one rectangle of an alpha mask into its mirror canvas (white, alpha = coverage). */
const putAlphaRect = (canvas: HTMLCanvasElement, mask: AlphaMask, r: Rect) => {
  const img = new ImageData(r.width, r.height);
  const d = img.data;
  for (let y = 0; y < r.height; y++) {
    const row = (r.y + y) * mask.width + r.x;
    for (let x = 0; x < r.width; x++) {
      const j = (y * r.width + x) * 4;
      d[j] = 255;
      d[j + 1] = 255;
      d[j + 2] = 255;
      d[j + 3] = mask.alpha[row + x];
    }
  }
  canvas.getContext('2d')!.putImageData(img, r.x, r.y);
};

/** The image-space rectangle a brush segment can touch (matches paintStroke's disc stamps). */
const segmentRect = (mask: AlphaMask, from: Pt, to: Pt, radius: number): Rect | null => {
  const x0 = Math.max(0, Math.floor(Math.min(from.x, to.x) - radius));
  const y0 = Math.max(0, Math.floor(Math.min(from.y, to.y) - radius));
  const x1 = Math.min(mask.width - 1, Math.ceil(Math.max(from.x, to.x) + radius));
  const y1 = Math.min(mask.height - 1, Math.ceil(Math.max(from.y, to.y) + radius));
  return x1 < x0 || y1 < y0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
};

/**
 * The one place a surface's area is adjusted (hotspot editor and studio area check). Every tool
 * edits the mask directly, so each correction does exactly what it shows, and can be undone.
 */
export const AreaEditor: React.FC<AreaEditorProps> = ({ imageUrl, initialMask, label, onChange, onPreview }) => {
  const [mask, setMask] = useState<AlphaMask>(() => canvasToAlphaMask(initialMask));
  const history = useRef<History<AlphaMask> | null>(null);
  if (!history.current) history.current = createMaskHistory(mask, HISTORY_LIMIT);
  // Summed once per committed mask, not on every render (pan/zoom re-render constantly)
  const coverage = useMemo(() => coveragePct(mask), [mask]);
  const [, setHistoryVersion] = useState(0);
  const [tool, setTool] = useState<Tool>('cut');
  const [view, setView] = useState<View>('fill');
  const [opacity, setOpacity] = useState(0.45);
  const [brushPct, setBrushPct] = useState(2);
  const [transform, setTransform] = useState({ zoom: 1, x: 0, y: 0 });
  const [stage, setStage] = useState({ left: 0, top: 0, width: 0 });
  const [polygon, setPolygon] = useState<Pt[]>([]);
  const [flash, setFlash] = useState<{ mask: AlphaMask; mode: 'add' | 'subtract' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  // True for the duration of a brush/eraser drag — gates Undo/Redo the same way `busy` does
  const [strokeActive, setStrokeActive] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const stroke = useRef<{ working: AlphaMask; last: Pt } | null>(null);
  const panDrag = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null);
  const spaceHeld = useRef(false);
  const mountedRef = useRef(true);
  // Bumped on every committed edit; an in-flight preview whose id has fallen behind is discarded
  const previewRequestRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const pendingDrawRef = useRef<{ current: AlphaMask; strokePreview: boolean } | null>(null);
  // The displayed mask as a canvas (white, alpha = coverage), updated only where it changed.
  // The Fill view composites it; committed edits are handed out as copies of it.
  const mirrorRef = useRef<{ canvas: HTMLCanvasElement; of: AlphaMask } | null>(null);
  // Reused per-draw buffers for the Outline view
  const outlineBufRef = useRef<{ image: ImageData; edge: Uint8Array } | null>(null);
  // The preview URL on screen, so it can be revoked when replaced, cleared or unmounted
  const previewUrlRef = useRef<string | null>(null);

  /**
   * Brings the mirror canvas up to `next`. `changed` (a live brush segment) says `next` differs
   * from `changed.base` only inside `changed.rect`; it is used only if the mirror shows `base`,
   * otherwise the changed rectangle is found by comparing.
   */
  const syncMirror = useCallback((next: AlphaMask, changed?: { base: AlphaMask; rect: Rect | null }) => {
    const m = mirrorRef.current;
    if (!m || m.canvas.width !== next.width || m.canvas.height !== next.height) {
      mirrorRef.current = { canvas: alphaMaskToCanvas(next), of: next };
      return;
    }
    const rect = changed && m.of === changed.base ? changed.rect : m.of === next ? null : diffRect(m.of, next);
    if (rect) putAlphaRect(m.canvas, next, rect);
    m.of = next;
  }, []);

  /** A fresh canvas holding `next` (a GPU copy of the mirror, not a per-pixel rebuild). */
  const maskCanvasOf = useCallback(
    (next: AlphaMask) => {
      syncMirror(next);
      const src = mirrorRef.current!.canvas;
      const out = newCanvas(src.width, src.height);
      out.getContext('2d')!.drawImage(src, 0, 0);
      return out;
    },
    [syncMirror]
  );

  const showPreview = useCallback((url: string | null) => {
    if (previewUrlRef.current !== url) revokeIfBlob(previewUrlRef.current);
    previewUrlRef.current = url;
    setPreviewUrl(url);
  }, []);

  // StrictMode (dev) mounts, cleans up and re-mounts every effect once before the first paint —
  // this must set `mountedRef.current` back to `true` in the setup (not just `false` in cleanup),
  // and the cleanup must fully rewind the frame/pending-draw refs so the second mount starts clean.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      pendingDrawRef.current = null;
      revokeIfBlob(previewUrlRef.current);
      previewUrlRef.current = null;
    };
  }, []);

  const emit = useCallback(
    (next: AlphaMask) => {
      setMask(next);
      setHistoryVersion((v) => v + 1);
      showPreview(null);
      previewRequestRef.current++; // invalidate any preview request in flight against the old mask
      onChange(maskCanvasOf(next));
    },
    [onChange, showPreview, maskCanvasOf]
  );

  const commit = useCallback(
    (next: AlphaMask) => {
      history.current!.push(next);
      emit(next);
    },
    [emit]
  );

  // Undo/Redo are no-ops while a Cut/Add is in flight or a brush stroke is active — both cases
  // hold a snapshot that must not be clobbered by history navigating underneath it.
  const undo = useCallback(() => {
    if (busy || strokeActive) return;
    const state = history.current!.undo();
    if (state) emit(state);
  }, [emit, busy, strokeActive]);

  const redo = useCallback(() => {
    if (busy || strokeActive) return;
    const state = history.current!.redo();
    if (state) emit(state);
  }, [emit, busy, strokeActive]);

  // Fit the photo inside the viewport (the image keeps w-full h-auto inside the stage)
  const fitStage = useCallback(() => {
    const vp = viewportRef.current;
    const img = imgRef.current;
    if (!vp || !img || !img.naturalWidth) return;
    const vw = vp.clientWidth;
    const vh = vp.clientHeight;
    const width = Math.min(vw, vh * (img.naturalWidth / img.naturalHeight));
    const height = width * (img.naturalHeight / img.naturalWidth);
    setStage({ left: (vw - width) / 2, top: (vh - height) / 2, width });
  }, []);

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const observer = new ResizeObserver(fitStage);
    observer.observe(vp);
    return () => observer.disconnect();
  }, [fitStage]);

  // A flash canvas is built once per Cut/Add (opaque colour where the object is), not per draw
  const flashCanvas = useMemo(() => {
    if (!flash) return null;
    const { width: w, height: h, alpha } = flash.mask;
    const rgb = flash.mode === 'subtract' ? CUT_RGB : ADD_RGB;
    const img = new ImageData(w, h);
    const d = img.data;
    for (let i = 0; i < alpha.length; i++) {
      if (alpha[i] <= 127) continue;
      const j = i * 4;
      d[j] = rgb[0];
      d[j + 1] = rgb[1];
      d[j + 2] = rgb[2];
      d[j + 3] = 255;
    }
    const c = newCanvas(w, h);
    c.getContext('2d')!.putImageData(img, 0, 0);
    return c;
  }, [flash]);

  // The actual canvas paint. `strokePreview` swaps the (expensive, zoom-dependent) outline
  // recompute for the cheap fill-style pass — used while a brush stroke is live in Outline view,
  // see the call sites below. Fill and flash are GPU compositing of prebuilt canvases; only the
  // Outline view touches pixels in JavaScript, into a reused buffer.
  const drawOverlayNow = useCallback(
    (current: AlphaMask, strokePreview: boolean) => {
      const canvas = overlayRef.current;
      if (!canvas) return;
      if (canvas.width !== current.width) canvas.width = current.width;
      if (canvas.height !== current.height) canvas.height = current.height;
      const ctx = canvas.getContext('2d')!;
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (view === 'fill' || (view === 'outline' && strokePreview)) {
        // Amber at `opacity` x coverage: the mask, then colour kept only where it is
        syncMirror(current);
        ctx.drawImage(mirrorRef.current!.canvas, 0, 0);
        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = `rgb(${FILL_RGB.join(',')})`;
        ctx.globalAlpha = opacity;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      } else if (view === 'outline') {
        const n = current.width * current.height;
        let buf = outlineBufRef.current;
        if (!buf || buf.image.width !== current.width || buf.image.height !== current.height) {
          buf = { image: new ImageData(current.width, current.height), edge: new Uint8Array(n) };
          outlineBufRef.current = buf;
        }
        // About 2 screen pixels at any zoom
        const shown = imgRef.current?.getBoundingClientRect().width || current.width;
        const edge = maskOutline(current, Math.max(1, Math.round((2 * current.width) / shown)), buf.edge);
        const d = buf.image.data;
        d.fill(0);
        for (let i = 0; i < n; i++) {
          if (!edge[i]) continue;
          const j = i * 4;
          d[j] = OUTLINE_RGB[0];
          d[j + 1] = OUTLINE_RGB[1];
          d[j + 2] = OUTLINE_RGB[2];
          d[j + 3] = 255;
        }
        ctx.putImageData(buf.image, 0, 0);
      }
      if (flashCanvas) {
        // Replace (not blend) what's under the object, as a 170/255 wash of the flash colour
        ctx.globalCompositeOperation = 'destination-out';
        ctx.drawImage(flashCanvas, 0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 170 / 255;
        ctx.drawImage(flashCanvas, 0, 0, canvas.width, canvas.height);
        ctx.globalAlpha = 1;
      }
    },
    [view, opacity, flashCanvas, syncMirror]
  );

  // Kept in sync every render (not just when the memoized function identity changes) so a frame
  // already scheduled below always paints with the latest view/opacity/flash, never a closure
  // captured back when that frame was requested.
  const drawOverlayNowRef = useRef(drawOverlayNow);
  drawOverlayNowRef.current = drawOverlayNow;

  // Coalesces redraw requests (brush pointermove fires far faster than the screen refreshes) to
  // at most one paint per animation frame; the pending frame is cancelled on unmount above. Stable
  // identity (no deps) so an already-pending frame is never silently left pointing at a stale
  // `drawOverlayNow` — it always reads `drawOverlayNowRef.current` and the latest pending mask when
  // it fires.
  const drawOverlay = useCallback((current: AlphaMask, strokePreview = false) => {
    pendingDrawRef.current = { current, strokePreview };
    if (frameRef.current != null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const pending = pendingDrawRef.current;
      pendingDrawRef.current = null;
      if (pending) drawOverlayNowRef.current(pending.current, pending.strokePreview);
    });
  }, []);

  // `drawOverlay` itself never changes identity now, so this effect must list everything that
  // should trigger a repaint explicitly. Outline thickness is defined in screen px, so only it
  // needs to react to zoom/resize; Fill's opacity wash is defined in mask space and doesn't.
  // `previewUrl`/`view` are included so the overlay canvas (unmounted while a preview is showing,
  // see the JSX below) is redrawn as soon as it remounts, instead of staying blank until some
  // other dep happens to change.
  const zoomRelevant = view === 'outline';
  useEffect(() => {
    drawOverlay(mask);
  }, [mask, drawOverlay, view, opacity, flash, previewUrl, zoomRelevant ? transform.zoom : 0, zoomRelevant ? stage.width : 0]);

  const zoomAt = useCallback((cx: number, cy: number, factor: number) => {
    setTransform((t) => {
      const zoom = clamp(t.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      if (zoom === MIN_ZOOM) return { zoom, x: 0, y: 0 };
      const k = zoom / t.zoom;
      return { zoom, x: cx - (cx - t.x) * k, y: cy - (cy - t.y) * k };
    });
  }, []);

  // Wheel / trackpad pinch zoom around the cursor (non-passive so the page doesn't scroll)
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = vp.getBoundingClientRect();
      zoomAt(e.clientX - rect.left - stage.left, e.clientY - rect.top - stage.top, Math.exp(-e.deltaY * 0.0015));
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, [zoomAt, stage.left, stage.top]);

  const zoomButton = (factor: number) => {
    const vp = viewportRef.current;
    if (!vp) return;
    zoomAt(vp.clientWidth / 2 - stage.left, vp.clientHeight / 2 - stage.top, factor);
  };

  const toImagePoint = (clientX: number, clientY: number): Pt | null => {
    const rect = imgRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return null;
    return { x: ((clientX - rect.left) / rect.width) * mask.width, y: ((clientY - rect.top) / rect.height) * mask.height };
  };

  // Image pixels per screen pixel at the current zoom
  const imagePxPerScreenPx = () => mask.width / (imgRef.current?.getBoundingClientRect().width || mask.width);

  const closePolygon = (points: Pt[]) => {
    if (points.length < 3) return;
    commit(fillPolygon(mask, points, tool === 'polyAdd' ? 'add' : 'remove'));
    setPolygon([]);
  };

  const handlePolygonClick = (p: Pt) => {
    const tolerance = CLOSE_RADIUS_SCREEN_PX * imagePxPerScreenPx();
    if (polygon.length >= 3 && Math.hypot(p.x - polygon[0].x, p.y - polygon[0].y) <= tolerance) {
      closePolygon(polygon);
      return;
    }
    const last = polygon[polygon.length - 1];
    // The second click of a double-click lands on the last corner: not a new corner
    if (last && Math.hypot(p.x - last.x, p.y - last.y) <= tolerance / 5) return;
    setPolygon([...polygon, p]);
  };

  const runObjectTool = async (p: Pt) => {
    setBusy(true);
    setMessage(null);
    try {
      const canvas = await cutObject(imageUrl, { xPct: (p.x / mask.width) * 100, yPct: (p.y / mask.height) * 100 });
      if (!mountedRef.current) return;
      const object = canvas ? canvasToAlphaMask(scaleMaskCanvas(canvas, mask.width, mask.height)) : null;
      if (!object || !isUsableObjectMask(object)) {
        setMessage(NO_OBJECT_MESSAGE);
        return;
      }
      const mode = tool === 'cut' ? 'subtract' : 'add';
      setFlash({ mask: object, mode });
      await new Promise((resolve) => setTimeout(resolve, FLASH_MS));
      if (!mountedRef.current) return;
      setFlash(null);
      // Base the combine on the history's current state, not the `mask` closed over at click
      // time — Undo/Redo are disabled while busy (see `undo`/`redo` above), but this keeps the
      // result correct even if that guard is ever loosened.
      commit(combine(history.current!.current(), object, mode, mode === 'subtract' ? CUT_DILATE_PX : 0));
    } catch (err) {
      if (!mountedRef.current) return;
      setMessage(err instanceof Error ? err.message : 'Could not outline that object.');
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const brushRadius = () => ((brushPct / 100) * mask.width) / 2;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button === 1 || (e.button === 0 && spaceHeld.current)) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      panDrag.current = { startX: e.clientX, startY: e.clientY, x: transform.x, y: transform.y };
      return;
    }
    if (e.button !== 0 || busy || previewUrl) return;
    const p = toImagePoint(e.clientX, e.clientY);
    if (!p) return;
    if (tool === 'brush' || tool === 'erase') {
      e.currentTarget.setPointerCapture(e.pointerId);
      const working = cloneMask(mask);
      const radius = brushRadius();
      paintStroke(working, p, p, radius, tool === 'brush' ? 'add' : 'erase');
      // The mirror shows `mask` already, so only the first stamp's rectangle needs writing
      syncMirror(working, { base: mask, rect: segmentRect(working, p, p, radius) });
      stroke.current = { working, last: p };
      setStrokeActive(true);
      drawOverlay(working, true);
    } else if (tool === 'cut' || tool === 'add') {
      runObjectTool(p);
    } else {
      handlePolygonClick(p);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (panDrag.current) {
      const d = panDrag.current;
      setTransform((t) => (t.zoom === MIN_ZOOM ? t : { ...t, x: d.x + e.clientX - d.startX, y: d.y + e.clientY - d.startY }));
      return;
    }
    if (!stroke.current) return;
    const p = toImagePoint(e.clientX, e.clientY);
    if (!p) return;
    const radius = brushRadius();
    const { working, last } = stroke.current;
    paintStroke(working, last, p, radius, tool === 'brush' ? 'add' : 'erase');
    // Written now, not in the (coalesced) frame, so no segment's rectangle is ever skipped
    syncMirror(working, { base: working, rect: segmentRect(working, last, p, radius) });
    stroke.current.last = p;
    drawOverlay(stroke.current.working, true);
  };

  const handlePointerUp = () => {
    panDrag.current = null;
    if (!stroke.current) return;
    const { working } = stroke.current;
    stroke.current = null;
    setStrokeActive(false);
    commit(working);
  };

  // Keyboard: undo/redo, polygon corners, Space to pan
  useEffect(() => {
    // Text entry only — a focused range/checkbox/radio/button input shouldn't swallow Ctrl/Cmd+Z
    const typing = (t: EventTarget | null) => {
      if (!(t instanceof HTMLElement)) return false;
      if (t.tagName === 'TEXTAREA' || t.isContentEditable) return true;
      if (t.tagName === 'INPUT') {
        const type = (t as HTMLInputElement).type;
        return type !== 'range' && type !== 'checkbox' && type !== 'radio' && type !== 'button';
      }
      return false;
    };
    // Outside the editor, a focused button/select/input/textarea/contentEditable should still
    // receive Space (e.g. to activate a focused button elsewhere on the page).
    const interactive = (t: EventTarget | null) =>
      t instanceof HTMLElement &&
      (t.tagName === 'BUTTON' || t.tagName === 'SELECT' || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    const onKeyDown = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (e.key === ' ') {
        spaceHeld.current = true;
        // Inside the editor, Space is always the pan shortcut — even over a focused toolbar
        // button (which keeps focus after being clicked), so releasing it doesn't re-click that
        // button or discard an in-progress polygon. Outside the editor, don't steal Space from
        // whatever else on the page has focus.
        const insideEditor = rootRef.current && e.target instanceof Node && rootRef.current.contains(e.target);
        if (insideEditor || !interactive(e.target)) e.preventDefault();
        return;
      }
      if (polygon.length && e.key === 'Backspace') {
        e.preventDefault();
        setPolygon((prev) => prev.slice(0, -1));
      }
      if (polygon.length && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setPolygon([]);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== ' ') return;
      spaceHeld.current = false;
      // Same rule as keydown: releasing Space over a focused toolbar button mustn't click it
      const insideEditor = rootRef.current && e.target instanceof Node && rootRef.current.contains(e.target);
      if (insideEditor) e.preventDefault();
    };
    const onBlur = () => {
      spaceHeld.current = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [undo, redo, polygon.length]);

  const selectTool = (next: Tool) => {
    setTool(next);
    setPolygon([]);
    setMessage(null);
  };

  const runPreview = async () => {
    if (!onPreview) return;
    const requestId = ++previewRequestRef.current;
    const isStale = () => !mountedRef.current || previewRequestRef.current !== requestId;
    setPreviewing(true);
    setMessage(null);
    try {
      const url = await onPreview(maskCanvasOf(mask));
      if (isStale()) {
        revokeIfBlob(url); // the mask changed (or another preview started) while this was in flight
        return;
      }
      showPreview(url);
    } catch (err) {
      if (isStale()) return;
      setMessage(err instanceof Error ? err.message : 'Could not render a preview.');
    } finally {
      // Always clear the spinner if we're still mounted, even for a stale/superseded result —
      // otherwise the Preview button stays disabled forever once a newer request has taken over.
      if (mountedRef.current) setPreviewing(false);
    }
  };

  const button = (active: boolean) =>
    `flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors disabled:opacity-40 ${
      active ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'bg-white/[0.03] text-slate-300 border-white/[0.08] hover:bg-white/[0.07]'
    }`;
  const polyStroke = 2 * imagePxPerScreenPx();

  return (
    <div ref={rootRef} className="flex flex-col gap-3 min-h-0">
      <div className="flex flex-wrap items-center gap-1.5">
        {TOOLS.map(({ id, label: toolLabel, Icon }) => (
          <button key={id} type="button" aria-label={toolLabel} title={toolLabel} onClick={() => selectTool(id)} className={button(tool === id)}>
            <Icon className="w-3.5 h-3.5" /> <span className="hidden md:inline">{toolLabel}</span>
          </button>
        ))}
        {(tool === 'brush' || tool === 'erase') && (
          <label className="flex items-center gap-1.5 text-[11px] text-slate-400 ml-1">
            Size
            <input type="range" min={0.5} max={12} step={0.5} value={brushPct} onChange={(e) => setBrushPct(Number(e.target.value))} className="w-20 accent-amber-500" />
          </label>
        )}
        <span className="w-px h-5 bg-white/10 mx-1" />
        <button
          type="button"
          aria-label="Undo"
          title="Undo (Ctrl+Z)"
          onClick={undo}
          disabled={busy || strokeActive || !history.current!.canUndo()}
          className={button(false)}
        >
          <Undo2 className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          aria-label="Redo"
          title="Redo (Ctrl+Shift+Z)"
          onClick={redo}
          disabled={busy || strokeActive || !history.current!.canRedo()}
          className={button(false)}
        >
          <Redo2 className="w-3.5 h-3.5" />
        </button>
        <span className="w-px h-5 bg-white/10 mx-1" />
        <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoomButton(1 / 1.5)} className={button(false)}>
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoomButton(1.5)} className={button(false)}>
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button type="button" aria-label="Fit" title="Fit" onClick={() => setTransform({ zoom: 1, x: 0, y: 0 })} className={button(false)}>
          <Maximize className="w-3.5 h-3.5" />
        </button>
        <span className="w-px h-5 bg-white/10 mx-1" />
        {(['fill', 'outline', 'original'] as View[]).map((v) => (
          <button key={v} type="button" onClick={() => setView(v)} className={button(view === v)}>
            {v === 'fill' ? 'Fill' : v === 'outline' ? 'Outline' : 'Original'}
          </button>
        ))}
        {view === 'fill' && (
          <input
            type="range"
            aria-label="Fill strength"
            min={0.15}
            max={0.9}
            step={0.05}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            className="w-20 accent-amber-500"
          />
        )}
      </div>

      <div
        ref={viewportRef}
        data-testid="area-editor-viewport"
        className="relative overflow-hidden rounded-xl bg-black h-[62vh] select-none touch-none"
        style={{ cursor: busy ? 'progress' : tool === 'brush' || tool === 'erase' ? 'cell' : 'crosshair' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={() => (tool === 'polyAdd' || tool === 'polyRemove') && closePolygon(polygon)}
        onAuxClick={(e) => e.preventDefault()}
      >
        <div
          className="absolute"
          style={{
            left: stage.left,
            top: stage.top,
            width: stage.width || '100%',
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.zoom})`,
            transformOrigin: '0 0',
          }}
        >
          <img
            ref={imgRef}
            src={previewUrl ?? imageUrl}
            crossOrigin="anonymous"
            draggable={false}
            alt=""
            onLoad={fitStage}
            className="block w-full h-auto"
          />
          {view !== 'original' && !previewUrl && <canvas ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none" />}
          {polygon.length > 0 && !previewUrl && (
            <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox={`0 0 ${mask.width} ${mask.height}`} preserveAspectRatio="none">
              <polygon
                points={polygon.map((p) => `${p.x},${p.y}`).join(' ')}
                fill={tool === 'polyAdd' ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}
                stroke="#38bdf8"
                strokeWidth={polyStroke}
              />
              {polygon.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={polyStroke * (i === 0 ? 3 : 2)} fill={i === 0 ? '#fbbf24' : '#38bdf8'} />
              ))}
            </svg>
          )}
        </div>
        {busy && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/70 text-[11px] text-slate-200">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Outlining the object…
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[11px]">
        <span data-testid="area-coverage" className="text-slate-300 font-medium">
          {label}: {coverage.toFixed(1)}% of photo
        </span>
        <span className="text-slate-500">{HINTS[tool]} · Scroll to zoom · Space+drag to pan</span>
        {message && <span className="text-rose-300">{message}</span>}
        {onPreview && (
          <button
            type="button"
            aria-label="Preview"
            onClick={previewUrl ? () => showPreview(null) : runPreview}
            disabled={previewing}
            className={`ml-auto ${button(Boolean(previewUrl))}`}
          >
            {previewing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
            {previewUrl ? 'Back to editing' : 'Preview'}
          </button>
        )}
      </div>
    </div>
  );
};
