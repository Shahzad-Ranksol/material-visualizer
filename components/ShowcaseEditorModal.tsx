import React, { useEffect, useRef, useState } from 'react';
import { X, MapPin, Trash2, Loader2, AlertCircle, Plus, Pencil, ScanSearch, RefreshCw, Check, Grid3x3, Ruler } from 'lucide-react';
import { RemoteShowcaseImage, RemoteHotspot, NewShowcaseImageInput, NewHotspotInput, NewSurfaceInput, RemoteSurface } from '../services/apiClient';
import { analyzeRoom, cutSurface, surfaceKindFor, ANALYSIS_VERSION, MODEL_VERSIONS } from '../services/roomAnalysis';
import { HotspotImage, HotspotViewModel } from './HotspotImage';
import { SurfaceMaskOverlay } from './SurfaceMaskOverlay';
import { AreaEditor, EMPTY_AREA_MESSAGE } from './AreaEditor';
import { previewArea } from '../services/areaPreview';
import { coveragePct } from '../services/areaMaskOps';
import { PlaneOverlay, toManualCorners } from './PlaneOverlay';
import { DetectedItem, Material, PlanePoint, SurfaceCalibration, SurfaceGeometry, SurfaceKind } from '../types';
import { ReviewDecision, reviewDecision } from '../services/qualityGate';
import { alphaMaskToPngBlob, applyEditsToParts, canvasToAlphaMask, clearOccluderUnder, loadMaskAsAlpha, unionMasks } from '../services/maskCanvas';
import { MATERIAL_CATEGORIES, CURATED_ROOMS } from '../constants';

type PendingForm =
  | { mode: 'create'; xPct: number; yPct: number }
  | { mode: 'edit'; hotspot: RemoteHotspot; xPct: number; yPct: number }
  | null;

type Analysis =
  | { status: 'loading'; imageUrl: string }
  | { status: 'ready'; imageUrl: string; items: DetectedItem[]; warnings: string[]; geometryAvailable: boolean }
  | { status: 'error'; imageUrl: string; error: string };

type AreaStatus = 'idle' | 'detecting' | 'loading' | 'ready' | 'error';
// What a click on the photo does while a hotspot is open
type ClickTool = 'move' | 'ruler';

interface AreaState {
  label: string; // ADE20K class the area was cut from
  kind: SurfaceKind;
  // One part per physical plane; part 0 is the main surface
  parts: Array<{ mask: HTMLCanvasElement; geometry: SurfaceGeometry | null }>;
  occluder: HTMLCanvasElement | null;
  confidence: number;
  decision: ReviewDecision;
}

const PENDING_PIN_ID = '__pending';

const titleCase = (label: string) => label.replace(/\b\w/g, (c) => c.toUpperCase());

// Preview grid for the perspective plane: the vendor's real product module where known
const GRID_BY_CATEGORY: Record<string, { width: number; height: number }> = {
  sheet: { width: 1220, height: 2440 },
  tile: { width: 600, height: 600 },
};
const DEFAULT_GRID = { width: 1000, height: 1000 };

const DECISION_STYLE: Record<ReviewDecision, { text: string; className: string }> = {
  auto: { text: 'Looks reliable', className: 'bg-emerald-500/15 text-emerald-300' },
  confirm: { text: 'Please check the area', className: 'bg-amber-500/15 text-amber-300' },
  correct: { text: 'Needs correction before use', className: 'bg-rose-500/15 text-rose-300' },
};

interface ShowcaseEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  images: RemoteShowcaseImage[] | null;
  imagesError: string | null;
  storefrontSlug?: string;
  // The vendor's own material category, preselected for new hotspots
  defaultCategory?: string;
  addImageLoading: boolean;
  addImageError: string | null;
  onAddImage: (input: NewShowcaseImageInput) => void;
  onUpdateImage: (id: string, input: NewShowcaseImageInput) => void;
  onDeleteImage: (id: string) => void;
  hotspotLoading: boolean;
  hotspotError: string | null;
  onCreateHotspot: (imageId: string, input: NewHotspotInput) => void;
  onUpdateHotspot: (id: string, input: NewHotspotInput) => void;
  onDeleteHotspot: (id: string) => void;
  // Stores a mask image and resolves to its public URL
  onUploadMask: (mask: Blob) => Promise<string>;
  // Creates (surfaceId null) or updates a saved surface of an image
  onSaveSurface: (imageId: string, surfaceId: string | null, input: Partial<NewSurfaceInput>) => Promise<RemoteSurface>;
  onDeleteSurface: (imageId: string, surfaceId: string) => Promise<void>;
  // The studio's current material, for the Area Editor's Preview button
  previewMaterial?: Material | null;
}

export const ShowcaseEditorModal: React.FC<ShowcaseEditorModalProps> = ({
  isOpen,
  onClose,
  images,
  imagesError,
  storefrontSlug,
  defaultCategory,
  addImageLoading,
  addImageError,
  onAddImage,
  onUpdateImage,
  onDeleteImage,
  hotspotLoading,
  hotspotError,
  onCreateHotspot,
  onUpdateHotspot,
  onDeleteHotspot,
  onUploadMask,
  onSaveSurface,
  onDeleteSurface,
  previewMaterial,
}) => {
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [newImageName, setNewImageName] = useState('');
  const [newImageUrl, setNewImageUrl] = useState('');
  const [editingImageId, setEditingImageId] = useState<string | null>(null);
  const [pendingForm, setPendingForm] = useState<PendingForm>(null);
  const [formLabel, setFormLabel] = useState('');
  const [formCategories, setFormCategories] = useState<Set<string>>(new Set());

  // Local room analysis for the selected image
  const [analysis, setAnalysis] = useState<Analysis | null>(null);

  // The hotspot area being created/edited
  const [area, setArea] = useState<AreaState | null>(null);
  // Union of the parts: what the overlay shows and the Area Editor edits
  const [areaMask, setAreaMask] = useState<HTMLCanvasElement | null>(null);
  const [areaStatus, setAreaStatus] = useState<AreaStatus>('idle');
  const [areaError, setAreaError] = useState<string | null>(null);
  const [connectedOnly, setConnectedOnly] = useState(true);
  const [maskDirty, setMaskDirty] = useState(false);
  // Anything saved with the surface changed (re-cut, corners, calibration)
  const [areaDirty, setAreaDirty] = useState(false);
  const [clickTool, setClickTool] = useState<ClickTool>('move');
  const [areaEditorOpen, setAreaEditorOpen] = useState(false);
  const [calibration, setCalibration] = useState<SurfaceCalibration | null>(null);
  const [rulerPoints, setRulerPoints] = useState<PlanePoint[]>([]);
  const [rulerMetres, setRulerMetres] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const areaRequest = useRef(0);

  const selectedImage = images?.find((img) => img.id === selectedImageId) || null;
  const selectedImageUrl = selectedImage?.imageUrl ?? null;

  // Analyze each room photo as soon as it's opened (cached per photo)
  useEffect(() => {
    if (!isOpen || !selectedImageUrl) {
      setAnalysis(null);
      return;
    }
    let cancelled = false;
    setAnalysis({ status: 'loading', imageUrl: selectedImageUrl });
    analyzeRoom(selectedImageUrl)
      .then(({ items, warnings, geometryAvailable }) => {
        if (!cancelled) setAnalysis({ status: 'ready', imageUrl: selectedImageUrl, items, warnings, geometryAvailable });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setAnalysis({ status: 'error', imageUrl: selectedImageUrl, error: err instanceof Error ? err.message : 'Could not analyze this photo.' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, selectedImageUrl]);

  if (!isOpen) return null;

  const setAreaState = (next: AreaState | null) => {
    // A new area replaces whatever an open Area Editor was working on
    setAreaEditorOpen(false);
    setArea(next);
    setAreaMask(next ? unionMasks(next.parts.map((p) => p.mask)) : null);
  };

  const resetArea = () => {
    areaRequest.current++;
    setAreaState(null);
    setAreaStatus('idle');
    setAreaError(null);
    setMaskDirty(false);
    setAreaDirty(false);
    setAreaEditorOpen(false);
    setClickTool('move');
    setCalibration(null);
    setRulerPoints([]);
    setRulerMetres('');
    setSaveError(null);
  };

  // SAM-refined cut of the surface at a point (adjusted afterwards in the Area Editor)
  const detectArea = async (point: PlanePoint, label?: string, connected = connectedOnly) => {
    if (!selectedImage) return;
    const request = ++areaRequest.current;
    setAreaStatus('detecting');
    setAreaError(null);
    try {
      const cut = await cutSurface(selectedImage.imageUrl, point, { label, connectedOnly: connected });
      if (request !== areaRequest.current) return;
      setAreaState({ label: cut.label, kind: cut.kind, parts: cut.parts, occluder: cut.occluder, confidence: cut.confidence, decision: cut.decision });
      setMaskDirty(false);
      setAreaDirty(true);
      setAreaStatus('ready');
      setFormLabel((prev) => prev || titleCase(cut.label));
    } catch (err) {
      if (request !== areaRequest.current) return;
      setAreaStatus('error');
      setAreaError(err instanceof Error ? err.message : 'Could not detect a surface here.');
    }
  };

  const selectImage = (id: string) => {
    setSelectedImageId(id);
    setPendingForm(null);
    resetArea();
  };

  const startEditImage = (img: RemoteShowcaseImage) => {
    setEditingImageId(img.id);
    setNewImageName(img.name);
    setNewImageUrl(img.imageUrl);
  };

  const cancelEditImage = () => {
    setEditingImageId(null);
    setNewImageName('');
    setNewImageUrl('');
  };

  const handleSubmitImageForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newImageName.trim() || !newImageUrl.trim()) return;
    if (editingImageId) {
      onUpdateImage(editingImageId, { name: newImageName.trim(), imageUrl: newImageUrl.trim() });
    } else {
      onAddImage({ name: newImageName.trim(), imageUrl: newImageUrl.trim() });
    }
    setEditingImageId(null);
    setNewImageName('');
    setNewImageUrl('');
  };

  const toggleCategory = (cat: string) => {
    setFormCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const startCreateHotspot = (xPct: number, yPct: number, surfaceLabel?: string) => {
    resetArea();
    setPendingForm({ mode: 'create', xPct, yPct });
    setFormLabel(surfaceLabel ? titleCase(surfaceLabel) : '');
    setFormCategories(new Set(defaultCategory ? [defaultCategory] : []));
    // Walls: just the wall at the pin. Floors/ceilings: all of it (rugs and furniture split them up).
    const connected = !surfaceLabel || !/floor|ceiling/.test(surfaceLabel);
    setConnectedOnly(connected);
    detectArea({ xPct, yPct }, surfaceLabel, connected);
  };

  const startEditHotspot = (hotspot: RemoteHotspot) => {
    resetArea();
    setPendingForm({ mode: 'edit', hotspot, xPct: hotspot.xPct, yPct: hotspot.yPct });
    setFormLabel(hotspot.label);
    setFormCategories(new Set(hotspot.allowedCategories));
    const main = selectedImage?.surfaces.find((sf) => sf.id === hotspot.surfaceId);
    if (!main || !selectedImage) return;
    const all = [main, ...selectedImage.surfaces.filter((sf) => sf.parentSurfaceId === main.id)];
    const request = ++areaRequest.current;
    setAreaStatus('loading');
    Promise.all([Promise.all(all.map((s) => loadMaskAsAlpha(s.maskUrl))), main.occluderMaskUrl ? loadMaskAsAlpha(main.occluderMaskUrl) : null])
      .then(([masks, occluder]) => {
        if (request !== areaRequest.current) return;
        setAreaState({
          label: main.kind,
          kind: main.kind,
          parts: all.map((s, k) => ({ mask: masks[k], geometry: s.plane ?? null })),
          occluder,
          confidence: main.confidence,
          decision: reviewDecision(main.confidence),
        });
        setCalibration(main.calibration ?? null);
        setAreaStatus('ready');
      })
      .catch((err: unknown) => {
        if (request !== areaRequest.current) return;
        setAreaStatus('error');
        setAreaError(err instanceof Error ? err.message : 'Could not load the saved area.');
      });
  };

  const cancelForm = () => {
    setPendingForm(null);
    resetArea();
  };

  // A click on the photo: new hotspot, move + re-detect, or a ruler point
  const handleImageClick = (xPct: number, yPct: number) => {
    if (!pendingForm) {
      startCreateHotspot(xPct, yPct);
      return;
    }
    const point = { xPct, yPct };
    if (clickTool === 'ruler') {
      setRulerPoints((prev) => (prev.length >= 2 ? [point] : [...prev, point]));
      return;
    }
    setPendingForm({ ...pendingForm, xPct, yPct });
    detectArea(point, undefined, connectedOnly);
  };

  const applyCalibration = () => {
    const metres = Number(rulerMetres);
    if (rulerPoints.length !== 2 || !(metres > 0)) return;
    setCalibration({
      p1: [rulerPoints[0].xPct / 100, rulerPoints[0].yPct / 100],
      p2: [rulerPoints[1].xPct / 100, rulerPoints[1].yPct / 100],
      distanceMm: metres * 1000,
    });
    setAreaDirty(true);
    setRulerPoints([]);
    setClickTool('move');
  };

  const convertToManualCorners = (k: number) => {
    if (!area) return;
    const part = area.parts[k];
    if (!part.geometry) return;
    const manual = toManualCorners(part.geometry, part.mask, calibration);
    if (!manual) return;
    const parts = area.parts.map((p, i) => (i === k ? { ...p, geometry: { homographyFallback: manual } } : p));
    // Only the geometry changes: keep `areaMask` (and any Area Editor edits in it) as is
    setArea({ ...area, parts });
    setAreaDirty(true);
  };

  const setPartCorners = (k: number, corners: NonNullable<SurfaceGeometry['homographyFallback']>['corners']) => {
    if (!area) return;
    setArea({
      ...area,
      parts: area.parts.map((p, i) =>
        i === k && p.geometry?.homographyFallback ? { ...p, geometry: { homographyFallback: { ...p.geometry.homographyFallback, corners } } } : p
      ),
    });
    setAreaDirty(true);
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingForm || !selectedImage || !formLabel.trim() || formCategories.size === 0) return;
    if (area && areaMask && coveragePct(canvasToAlphaMask(areaMask)) === 0) {
      setSaveError(EMPTY_AREA_MESSAGE);
      return;
    }
    const allowedCategories = Array.from<string>(formCategories);
    setSaving(true);
    setSaveError(null);
    try {
      // The area becomes (or updates) a saved surface — plus one child surface per extra plane
      let surfaceId = pendingForm.mode === 'edit' ? pendingForm.hotspot.surfaceId ?? null : null;
      if (area && areaMask && (areaDirty || maskDirty || !surfaceId)) {
        // Parts the edit emptied are dropped with their planes (the first survivor becomes the
        // main surface), so no saved layer is too small to render
        const parts = maskDirty ? applyEditsToParts(area.parts, areaMask) : area.parts;
        if (!parts.length) throw new Error(EMPTY_AREA_MESSAGE);
        const [maskUrls, occluderMaskUrl] = await Promise.all([
          Promise.all(parts.map(async (p) => onUploadMask(await alphaMaskToPngBlob(p.mask)))),
          area.occluder
            ? onUploadMask(await alphaMaskToPngBlob(maskDirty ? clearOccluderUnder(area.occluder, areaMask) : area.occluder))
            : Promise.resolve(null),
        ]);
        const common = {
          kind: area.kind === 'custom' ? surfaceKindFor(area.label) : area.kind,
          label: formLabel.trim(),
          occluderMaskUrl,
          analysisVersion: ANALYSIS_VERSION,
          modelVersions: MODEL_VERSIONS,
          confidence: Math.min(1, Math.max(0, area.confidence)),
          // Reviewed by the vendor in this editor
          needsReview: false,
          calibration,
        };
        const main = await onSaveSurface(selectedImage.id, surfaceId, {
          ...common,
          maskUrl: maskUrls[0],
          plane: parts[0].geometry,
          parentSurfaceId: null,
        });
        // Replace the extra planes
        const oldParts = selectedImage.surfaces.filter((s) => s.parentSurfaceId === main.id);
        await Promise.all(oldParts.map((s) => onDeleteSurface(selectedImage.id, s.id)));
        for (let k = 1; k < parts.length; k++) {
          await onSaveSurface(selectedImage.id, null, {
            ...common,
            label: `${formLabel.trim()} (${k + 1})`,
            maskUrl: maskUrls[k],
            plane: parts[k].geometry,
            parentSurfaceId: main.id,
          });
        }
        surfaceId = main.id;
      }
      const input: NewHotspotInput = {
        label: formLabel.trim(),
        xPct: pendingForm.xPct,
        yPct: pendingForm.yPct,
        allowedCategories,
        surfaceId,
      };
      if (pendingForm.mode === 'create') onCreateHotspot(selectedImage.id, input);
      else onUpdateHotspot(pendingForm.hotspot.id, input);
      setPendingForm(null);
      resetArea();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save the hotspot area.');
    } finally {
      setSaving(false);
    }
  };

  const handleHotspotDragEnd = (hotspotId: string, xPct: number, yPct: number) => {
    if (hotspotId === PENDING_PIN_ID) {
      handleImageClick(xPct, yPct);
      return;
    }
    const hotspot = selectedImage?.hotspots.find((h) => h.id === hotspotId);
    if (!hotspot) return;
    if (pendingForm?.mode === 'edit' && pendingForm.hotspot.id === hotspotId) {
      setPendingForm({ ...pendingForm, xPct, yPct });
    }
    onUpdateHotspot(hotspotId, { label: hotspot.label, xPct, yPct, allowedCategories: hotspot.allowedCategories });
  };

  const hotspotViewModels: HotspotViewModel[] = (selectedImage?.hotspots || []).map((h) => ({
    id: h.id,
    label: h.label,
    xPct: pendingForm?.mode === 'edit' && pendingForm.hotspot.id === h.id ? pendingForm.xPct : h.xPct,
    yPct: pendingForm?.mode === 'edit' && pendingForm.hotspot.id === h.id ? pendingForm.yPct : h.yPct,
  }));
  if (pendingForm?.mode === 'create') {
    hotspotViewModels.push({ id: PENDING_PIN_ID, label: formLabel || 'New hotspot', xPct: pendingForm.xPct, yPct: pendingForm.yPct });
  }

  const readyAnalysis = analysis?.status === 'ready' && analysis.imageUrl === selectedImage?.imageUrl ? analysis : null;
  const existingLabels = new Set((selectedImage?.hotspots || []).map((h) => h.label.toLowerCase()));
  const areaPoint = pendingForm ? { xPct: pendingForm.xPct, yPct: pendingForm.yPct } : null;
  const grid = GRID_BY_CATEGORY[defaultCategory ?? ''] ?? DEFAULT_GRID;
  const toolsIdle = clickTool === 'move';

  const toolButton = (tool: ClickTool, label: string, Icon: React.ComponentType<{ className?: string }>) => (
    <button
      type="button"
      onClick={() => {
        setClickTool((prev) => (prev === tool ? 'move' : tool));
      }}
      className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
        clickTool === tool ? 'bg-sky-500/20 text-sky-300 border-sky-500/40' : 'bg-white/[0.03] text-slate-300 border-white/[0.08] hover:bg-white/[0.07]'
      }`}
    >
      <Icon className="w-3 h-3" /> {label}
    </button>
  );

  const areaEditorLayer =
    areaEditorOpen && area && areaMask && selectedImage ? (
      <div className="fixed inset-0 z-[120] bg-black/90 backdrop-blur-sm flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white">Adjust the &#8220;{formLabel || titleCase(area.label)}&#8221; area</h3>
            <p className="text-[10px] text-slate-400">The amber area is exactly what gets the new material. Every step can be undone.</p>
          </div>
          <button
            type="button"
            onClick={() => setAreaEditorOpen(false)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600 text-slate-950 text-xs font-semibold"
          >
            <Check className="w-3.5 h-3.5" /> Done
          </button>
        </div>
        <AreaEditor
          imageUrl={selectedImage.imageUrl}
          initialMask={areaMask}
          label={formLabel || titleCase(area.label)}
          onChange={(mask) => {
            setAreaMask(mask);
            setMaskDirty(true);
            setSaveError(null);
          }}
          onPreview={previewMaterial ? (mask) => previewArea(selectedImage.imageUrl, area, mask, previewMaterial, calibration) : undefined}
        />
      </div>
    ) : null;

  return (
    <>
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
      <div className="relative w-full max-w-5xl bg-[#14161f] border border-white/[0.1] rounded-2xl shadow-2xl overflow-hidden my-8">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] bg-[#171a24]">
          <div className="flex items-center gap-2.5">
            <MapPin className="w-4 h-4 text-amber-400" />
            <div>
              <h3 className="text-sm font-semibold text-white">Showcase &amp; Hotspots</h3>
              <p className="text-[10px] text-slate-400">
                {storefrontSlug ? `Public URL: /store/${storefrontSlug}` : 'Build your public showroom'}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 grid grid-cols-1 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-6 max-h-[80vh] overflow-y-auto custom-scrollbar">
          {/* Left: image list + add form */}
          <div className="space-y-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Showcase Images</span>

            {imagesError && <p className="text-[11px] text-rose-300">{imagesError}</p>}

            <div className="space-y-2">
              {(images || []).map((img) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => selectImage(img.id)}
                  className={`w-full flex items-center gap-3 p-2 rounded-xl border text-left transition-colors ${
                    selectedImageId === img.id
                      ? 'bg-amber-500/[0.08] border-amber-500/40'
                      : 'bg-[#12141c] border-white/[0.06] hover:border-white/20'
                  }`}
                >
                  <img src={img.imageUrl} alt={img.name} className="w-12 h-12 rounded-lg object-cover shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-slate-200 truncate">{img.name}</p>
                    <p className="text-[10px] text-slate-500">{img.hotspots.length} hotspot{img.hotspots.length === 1 ? '' : 's'}</p>
                  </div>
                  <span className="flex items-center gap-1.5 shrink-0">
                    <span
                      role="button"
                      tabIndex={0}
                      title="Edit image"
                      onClick={(e) => {
                        e.stopPropagation();
                        startEditImage(img);
                      }}
                      className="w-6 h-6 rounded-full bg-black/40 hover:bg-amber-500/80 flex items-center justify-center text-slate-400 hover:text-slate-950 transition-colors"
                    >
                      <Pencil className="w-3 h-3" />
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      title="Delete image"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (selectedImageId === img.id) selectImage('');
                        if (editingImageId === img.id) cancelEditImage();
                        onDeleteImage(img.id);
                      }}
                      className="w-6 h-6 rounded-full bg-black/40 hover:bg-rose-500/80 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </span>
                  </span>
                </button>
              ))}
              {images && images.length === 0 && (
                <p className="text-[11px] text-slate-500">No showcase images yet — add one below.</p>
              )}
            </div>

            <div className="space-y-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Or pick a template room</span>
              <div className="grid grid-cols-3 gap-2">
                {CURATED_ROOMS.map((room) => (
                  <button
                    key={room.id}
                    type="button"
                    onClick={() => onAddImage({ name: room.title, imageUrl: room.fullImage })}
                    disabled={addImageLoading}
                    title={`Add "${room.title}"`}
                    className="group relative rounded-lg overflow-hidden border border-white/[0.08] hover:border-amber-400/60 aspect-square disabled:opacity-50 transition-colors"
                  >
                    <img src={room.thumbnail} alt={room.title} className="w-full h-full object-cover" />
                    <span className="absolute inset-x-0 bottom-0 bg-black/70 text-[9px] text-slate-200 px-1 py-0.5 truncate">
                      {room.title}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <form
              onSubmit={handleSubmitImageForm}
              className={`p-3 rounded-xl bg-[#0d0e14] border space-y-2 ${
                editingImageId ? 'border-amber-500/30' : 'border-white/[0.08]'
              }`}
            >
              {editingImageId && (
                <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400">Editing Image</span>
              )}
              <input
                type="text"
                value={newImageName}
                onChange={(e) => setNewImageName(e.target.value)}
                placeholder="Image name (e.g. Living Room)"
                className="w-full bg-[#12141a] border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-400"
              />
              <input
                type="url"
                value={newImageUrl}
                onChange={(e) => setNewImageUrl(e.target.value)}
                placeholder="Image URL"
                className="w-full bg-[#12141a] border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-400"
              />
              {addImageError && (
                <div className="flex items-start gap-1.5 text-[11px] text-rose-300">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{addImageError}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                {editingImageId && (
                  <button
                    type="button"
                    onClick={cancelEditImage}
                    className="flex-1 px-3 py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.09] border border-white/[0.08] text-xs font-medium text-slate-300 hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="submit"
                  disabled={addImageLoading}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-xs font-semibold disabled:opacity-60 transition-colors"
                >
                  {addImageLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {!editingImageId && <Plus className="w-3.5 h-3.5" />}
                  {editingImageId ? 'Save Changes' : 'Add Image'}
                </button>
              </div>
            </form>
          </div>

          {/* Right: selected image + hotspots */}
          <div className="space-y-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Hotspots</span>
            {!selectedImage ? (
              <p className="text-[11px] text-slate-500">Select or add an image on the left to set up its hotspots.</p>
            ) : (
              <>
                {/* Local surface detection */}
                <div className="p-3 rounded-xl bg-[#0d0e14] border border-white/[0.08] space-y-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-300">
                    <ScanSearch className="w-3.5 h-3.5 text-amber-400" />
                    Detected surfaces
                  </div>
                  {analysis?.status === 'loading' && (
                    <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Analyzing the room (surfaces + 3D geometry)… about half a minute the first time.
                    </p>
                  )}
                  {analysis?.status === 'error' && (
                    <p className="text-[11px] text-rose-300">
                      Could not analyze this photo: {analysis.error}. You can still click the photo to place hotspots.
                    </p>
                  )}
                  {readyAnalysis?.warnings.map((w) => (
                    <p key={w} className="text-[10px] text-amber-300/80">
                      {w}
                    </p>
                  ))}
                  {readyAnalysis && readyAnalysis.items.length === 0 && (
                    <p className="text-[11px] text-slate-500">No large surfaces found — click the photo to place a hotspot.</p>
                  )}
                  {readyAnalysis && readyAnalysis.items.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {readyAnalysis.items.map((item) => {
                        const added = existingLabels.has(item.name.toLowerCase());
                        return (
                          <button
                            key={item.id}
                            type="button"
                            disabled={added || !item.anchor}
                            onClick={() => item.anchor && startCreateHotspot(item.anchor.xPct, item.anchor.yPct, item.surfaceLabel)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium border bg-white/[0.03] border-white/[0.1] text-slate-200 hover:border-amber-400/60 disabled:opacity-50 disabled:hover:border-white/[0.1] transition-colors"
                          >
                            {added ? <Check className="w-3 h-3 text-emerald-400" /> : <Plus className="w-3 h-3 text-amber-400" />}
                            {item.name}
                            {item.areaPct !== undefined && <span className="text-slate-500">{Math.round(item.areaPct)}%</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <HotspotImage
                  imageUrl={selectedImage.imageUrl}
                  hotspots={hotspotViewModels}
                  onImageClick={handleImageClick}
                  onHotspotDragEnd={handleHotspotDragEnd}
                  overlay={
                    areaMask && area ? (
                      <>
                        <SurfaceMaskOverlay mask={areaMask} />
                        {area.parts.map((part, k) =>
                          part.geometry ? (
                            <PlaneOverlay
                              key={k}
                              geometry={part.geometry}
                              calibration={calibration}
                              mask={part.mask}
                              gridMm={grid}
                              editable={toolsIdle && Boolean(part.geometry.homographyFallback)}
                              onCornersChange={(corners) => setPartCorners(k, corners)}
                              rulerPoints={k === 0 ? rulerPoints : []}
                            />
                          ) : null
                        )}
                      </>
                    ) : null
                  }
                  renderPin={(hotspot) => {
                    if (hotspot.id === PENDING_PIN_ID) {
                      return (
                        <div className="w-6 h-6 rounded-full bg-white text-amber-600 border-2 border-amber-400 shadow-lg flex items-center justify-center animate-pulse">
                          <MapPin className="w-3 h-3" />
                        </div>
                      );
                    }
                    const full = selectedImage.hotspots.find((h) => h.id === hotspot.id)!;
                    return (
                      <div className="relative group">
                        <button
                          type="button"
                          onClick={() => startEditHotspot(full)}
                          title={hotspot.label}
                          className="w-6 h-6 rounded-full bg-amber-400 text-slate-950 border-2 border-white/80 shadow-lg flex items-center justify-center hover:scale-110 transition-transform"
                        >
                          <MapPin className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (pendingForm?.mode === 'edit' && pendingForm.hotspot.id === hotspot.id) cancelForm();
                            onDeleteHotspot(hotspot.id);
                          }}
                          title="Delete hotspot"
                          className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-rose-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    );
                  }}
                />
                <p className="text-[10px] text-slate-500">
                  {!pendingForm
                    ? 'Add a detected surface above, or click the photo to place a hotspot. Click a pin to edit it.'
                    : clickTool === 'ruler'
                      ? 'Click two points on the surface a known distance apart (e.g. floor to ceiling, a door\'s height).'
                      : 'Click the photo to move this hotspot and re-detect the surface there. The amber area is exactly what gets re-surfaced — use Adjust area to fix it.'}
                </p>

                {pendingForm && (
                  <form onSubmit={submitForm} className="p-3 rounded-xl bg-[#0d0e14] border border-amber-500/30 space-y-3">
                    {/* Area: SAM-refined surface, adjusted in the Area Editor */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Area</span>
                        {areaStatus === 'detecting' && (
                          <span className="flex items-center gap-1 text-[10px] text-slate-400">
                            <Loader2 className="w-3 h-3 animate-spin" /> Detecting surface…
                          </span>
                        )}
                        {areaStatus === 'loading' && (
                          <span className="flex items-center gap-1 text-[10px] text-slate-400">
                            <Loader2 className="w-3 h-3 animate-spin" /> Loading saved area…
                          </span>
                        )}
                        {area && areaStatus === 'ready' && (
                          <span className={`text-[10px] px-2 py-0.5 rounded-md ${DECISION_STYLE[area.decision].className}`}>
                            {DECISION_STYLE[area.decision].text} · {Math.round(area.confidence * 100)}%
                          </span>
                        )}
                      </div>

                      {areaStatus === 'error' && <p className="text-[11px] text-rose-300">{areaError}</p>}
                      {!area && areaStatus === 'idle' && (
                        <p className="text-[11px] text-slate-500">This hotspot has no surface yet — customers can't preview it until you detect one.</p>
                      )}

                      <div className="flex flex-wrap items-center gap-2">
                        <label className="flex items-center gap-1.5 text-[11px] text-slate-300">
                          <input
                            type="checkbox"
                            checked={connectedOnly}
                            onChange={(e) => {
                              setConnectedOnly(e.target.checked);
                              if (areaPoint) detectArea(areaPoint, area?.label, e.target.checked);
                            }}
                            className="accent-amber-500"
                          />
                          Only the area around the pin
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            if (areaPoint) detectArea(areaPoint, area?.label, connectedOnly);
                          }}
                          disabled={areaStatus === 'detecting'}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-slate-300 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] disabled:opacity-50"
                        >
                          <RefreshCw className="w-3 h-3" /> {area ? 'Re-detect' : 'Detect area'}
                        </button>
                      </div>

                      {/* Not while a re-detect/load is in flight: its result would replace the area under the editor */}
                      {area && areaMask && (
                        <button
                          type="button"
                          onClick={() => setAreaEditorOpen(true)}
                          disabled={areaStatus !== 'ready'}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/40 hover:bg-amber-500/25 disabled:opacity-50"
                        >
                          <Pencil className="w-3 h-3" /> Adjust area
                        </button>
                      )}
                    </div>

                    {/* Perspective & scale */}
                    {area && (
                      <div className="space-y-2">
                        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                          <Grid3x3 className="w-3 h-3 text-sky-400" /> Perspective &amp; scale
                        </span>
                        {area.parts.map((part, k) => (
                          <div key={k} className="flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
                            <span className="text-slate-400">{area.parts.length > 1 ? `Plane ${k + 1}:` : 'Plane:'}</span>
                            {part.geometry?.normal ? (
                              <>
                                <span>3D geometry fitted</span>
                                <button type="button" onClick={() => convertToManualCorners(k)} className="px-2 py-0.5 rounded-md border border-white/[0.08] text-slate-400 hover:text-slate-200">
                                  Edit corners manually
                                </button>
                              </>
                            ) : part.geometry?.homographyFallback ? (
                              <>
                                <span>Manual corners — drag the blue handles</span>
                                <label className="flex items-center gap-1 text-slate-400">
                                  height
                                  <input
                                    type="number"
                                    min={0.3}
                                    max={50}
                                    step={0.1}
                                    value={Math.round(part.geometry.homographyFallback.heightMm / 100) / 10}
                                    onChange={(e) => {
                                      const metres = Number(e.target.value);
                                      if (!(metres > 0) || !part.geometry?.homographyFallback) return;
                                      const hf = part.geometry.homographyFallback;
                                      setArea({ ...area, parts: area.parts.map((p, i) => (i === k ? { ...p, geometry: { homographyFallback: { ...hf, heightMm: metres * 1000 } } } : p)) });
                                      setAreaDirty(true);
                                    }}
                                    className="w-14 bg-[#12141a] border border-white/[0.08] rounded-md px-1.5 py-0.5 text-[11px] text-slate-200"
                                  />
                                  m
                                </label>
                              </>
                            ) : (
                              <span className="text-rose-300">No perspective — redraw the area</span>
                            )}
                          </div>
                        ))}
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
                          {toolButton('ruler', 'Measure', Ruler)}
                          {clickTool === 'ruler' && rulerPoints.length === 2 && (
                            <>
                              <input
                                type="number"
                                min={0.05}
                                step={0.01}
                                value={rulerMetres}
                                onChange={(e) => setRulerMetres(e.target.value)}
                                placeholder="real length"
                                className="w-24 bg-[#12141a] border border-white/[0.08] rounded-md px-1.5 py-0.5 text-[11px] text-slate-200"
                              />
                              m
                              <button type="button" onClick={applyCalibration} className="px-2 py-0.5 rounded-md bg-sky-500/20 text-sky-300 border border-sky-500/40">
                                Set scale
                              </button>
                            </>
                          )}
                          {calibration && (
                            <span className="text-slate-400">
                              Scale set from a {(calibration.distanceMm / 1000).toFixed(2)} m measurement
                              <button type="button" onClick={() => { setCalibration(null); setAreaDirty(true); }} className="ml-1.5 text-slate-500 hover:text-slate-300">
                                clear
                              </button>
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-500">
                          The dashed grid shows how your {defaultCategory === 'sheet' ? '1220×2440mm sheets' : defaultCategory === 'tile' ? '600mm tiles' : '1m modules'} will lie. For exact sizes, measure one known length.
                        </p>
                      </div>
                    )}

                    <input
                      type="text"
                      value={formLabel}
                      onChange={(e) => setFormLabel(e.target.value)}
                      placeholder="Hotspot name — e.g. Feature Wall"
                      className="w-full bg-[#12141a] border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-400"
                    />
                    <div className="space-y-1.5">
                      <span className="text-[10px] text-slate-500">Material categories customers can try here</span>
                      <div className="flex flex-wrap gap-1.5">
                        {MATERIAL_CATEGORIES.map((cat) => (
                          <button
                            key={cat}
                            type="button"
                            onClick={() => toggleCategory(cat)}
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-medium border transition-colors ${
                              formCategories.has(cat)
                                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                : 'bg-white/[0.03] text-slate-400 border-transparent hover:bg-white/[0.06]'
                            }`}
                          >
                            {cat}
                          </button>
                        ))}
                      </div>
                    </div>
                    {(hotspotError || saveError) && (
                      <div className="flex items-start gap-1.5 text-[11px] text-rose-300">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>{saveError || hotspotError}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={cancelForm}
                        className="flex-1 px-3 py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.09] border border-white/[0.08] text-xs font-medium text-slate-300 hover:text-white transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={saving || hotspotLoading || areaStatus === 'detecting' || !formLabel.trim() || formCategories.size === 0}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600 text-slate-950 text-xs font-semibold disabled:opacity-60 hover:brightness-110 transition-all"
                      >
                        {(saving || hotspotLoading) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        {pendingForm.mode === 'create' ? 'Add Hotspot' : 'Save Changes'}
                      </button>
                    </div>
                  </form>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
    {areaEditorLayer}
    </>
  );
};
