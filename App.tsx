import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { StudioHeader } from './components/StudioHeader';
import { CuratedRoomsGallery } from './components/CuratedRoomsGallery';
import { FileUpload } from './components/FileUpload';
import { DetectedItems } from './components/DetectedItems';
import { MaterialGrid } from './components/MaterialGrid';
import { AuthPanel } from './components/AuthPanel';
import { AddMaterialForm } from './components/AddMaterialForm';
import { EditMaterialModal } from './components/EditMaterialModal';
import { BulkImportModal, BulkImportResultItem } from './components/BulkImportModal';
import { ShowcaseEditorModal } from './components/ShowcaseEditorModal';
import { SurfaceReviewModal } from './components/SurfaceReviewModal';
import { ResultDisplay } from './components/ResultDisplay';
import { SpecSheetModal } from './components/SpecSheetModal';
import { CURATED_ROOMS, MATERIALS, ROOM_TYPES } from './constants';
import { renderMaterial, RenderLayerInput, NeedsSurfaceReviewError } from './services/renderer/materialRenderer';
import { WebGLUnavailableError } from './services/renderer/webglContext';
import { setStudioLightingProvider } from './services/renderer/studioLighting';
import { createStudioLightingProvider } from './services/renderer/studioLightingProvider';
import { analyzeRoom, onAnalysisProgress, resolveSurface, savedSurfaceToItem, savedSurfaceToRenderable } from './services/roomAnalysis';
import { compareWithGemini, isGeminiCompareAvailable } from './services/geminiCompare';
import {
  AuthSession,
  NewMaterialInput,
  RemoteMaterial,
  ApiError,
  login as apiLogin,
  register as apiRegister,
  listMaterials as apiListMaterials,
  createMaterial as apiCreateMaterial,
  updateMaterial as apiUpdateMaterial,
  deleteMaterial as apiDeleteMaterial,
  uploadImage as apiUploadImage,
  RemoteShowcaseImage,
  RemoteHotspot,
  NewShowcaseImageInput,
  NewHotspotInput,
  listShowcaseImages as apiListShowcaseImages,
  createShowcaseImage as apiCreateShowcaseImage,
  updateShowcaseImage as apiUpdateShowcaseImage,
  deleteShowcaseImage as apiDeleteShowcaseImage,
  createHotspot as apiCreateHotspot,
  updateHotspot as apiUpdateHotspot,
  deleteHotspot as apiDeleteHotspot,
  getRenderCapabilities,
  createSurface as apiCreateSurface,
  updateSurface as apiUpdateSurface,
  deleteSurface as apiDeleteSurface,
  NewSurfaceInput,
} from './services/apiClient';
import { RoomType, Material, MaterialCategory, DetectedItem, CuratedRoom, RenderMode, RenderDebugView, RepeatMode } from './types';
import { Sparkles, SlidersHorizontal, Wand2, Info, Check, MapPin } from 'lucide-react';

const SESSION_STORAGE_KEY = 'mv_session';

export const toMaterial = (m: RemoteMaterial): Material => ({
  id: m.id,
  tenantId: m.tenantId,
  name: m.name,
  category: m.category as MaterialCategory,
  description: m.description,
  thumbnail: m.thumbnail,
  finishType: m.finishType,
  colorTone: m.colorTone,
  realWidthMm: m.realWidthMm,
  realHeightMm: m.realHeightMm,
  repeatMode: m.repeatMode as RepeatMode,
  orientationDeg: m.orientationDeg as Material['orientationDeg'],
  jointWidthMm: m.jointWidthMm,
  jointColor: m.jointColor,
  roughness: m.roughness,
  metallic: m.metallic,
  normalStrength: m.normalStrength,
  albedoUrl: m.albedoUrl,
  normalUrl: m.normalUrl,
  roughnessUrl: m.roughnessUrl,
  heightUrl: m.heightUrl,
});

// A vendor's showcase image as a studio preset. Its targets come from its saved surfaces
// (see activeShowcaseImage below), never from hotspot labels.
const toCuratedRoom = (img: RemoteShowcaseImage): CuratedRoom => {
  const template = CURATED_ROOMS.find((r) => r.fullImage === img.imageUrl);
  return {
    id: `showcase-${img.id}`,
    title: img.name,
    roomType: template?.roomType ?? 'Living Room',
    style: template?.style ?? 'Vendor Showcase',
    thumbnail: img.imageUrl,
    fullImage: img.imageUrl,
    detectedDefaults: [],
  };
};

const errorText = (err: unknown, fallback: string) =>
  err instanceof NeedsSurfaceReviewError || err instanceof WebGLUnavailableError || err instanceof Error ? err.message : fallback;

const App: React.FC = () => {
  // Room & Image State
  const [selectedRoomType, setSelectedRoomType] = useState<RoomType>(CURATED_ROOMS[0].roomType);
  const [selectedCuratedRoomId, setSelectedCuratedRoomId] = useState<string | null>(CURATED_ROOMS[0].id);
  const [uploadedImageFile, setUploadedImageFile] = useState<File | null>(null);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(CURATED_ROOMS[0].fullImage);

  // Surfaces of the current photo (from room analysis, or a vendor room's saved surfaces)
  const [detectedItems, setDetectedItems] = useState<DetectedItem[]>([]);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [analyzing, setAnalyzing] = useState<boolean>(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisWarnings, setAnalysisWarnings] = useState<string[]>([]);
  const [analysisProgress, setAnalysisProgress] = useState<string | null>(null);
  // Surface whose area the user is checking (low analysis confidence)
  const [reviewingItem, setReviewingItem] = useState<DetectedItem | null>(null);
  useEffect(() => {
    const off = onAnalysisProgress(setAnalysisProgress);
    return () => {
      off();
    };
  }, []);

  // Materials & Rendering State
  const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(MATERIALS[0]);
  const [customDirective, setCustomDirective] = useState<string>('');
  const [processedImageUrl, setProcessedImageUrl] = useState<string | null>(null);

  // Status & Feedback
  const [applicationLoading, setApplicationLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [specSheetOpen, setSpecSheetOpen] = useState<boolean>(false);
  // Exact Preview (deterministic) or Studio Lighting (optional self-hosted worker)
  const [renderMode, setRenderMode] = useState<RenderMode>('exact');
  const [studioLightingAvailable, setStudioLightingAvailable] = useState<boolean>(false);
  // Staff diagnostics: what the last render showed (mask / layout grid / recovered lighting)
  const [debugView, setDebugView] = useState<RenderDebugView>('none');
  const [renderNotice, setRenderNotice] = useState<string | null>(null);
  const lastRender = useRef<{ imageUrl: string; layers: RenderLayerInput[] } | null>(null);
  const renderRequest = useRef(0);

  // Tenant Auth & Remote Catalog State
  const [session, setSession] = useState<AuthSession | null>(() => {
    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as AuthSession) : null;
    } catch {
      return null;
    }
  });
  const [authLoading, setAuthLoading] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [remoteMaterials, setRemoteMaterials] = useState<Material[] | null>(null);
  const [materialsError, setMaterialsError] = useState<string | null>(null);
  const [addMaterialLoading, setAddMaterialLoading] = useState<boolean>(false);
  const [addMaterialError, setAddMaterialError] = useState<string | null>(null);
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);
  const [editMaterialLoading, setEditMaterialLoading] = useState<boolean>(false);
  const [editMaterialError, setEditMaterialError] = useState<string | null>(null);
  const [bulkImportOpen, setBulkImportOpen] = useState<boolean>(false);
  const [bulkImportLoading, setBulkImportLoading] = useState<boolean>(false);

  // Vendor Showcase & Hotspot State
  const [showcaseImages, setShowcaseImages] = useState<RemoteShowcaseImage[] | null>(null);
  const [showcaseImagesError, setShowcaseImagesError] = useState<string | null>(null);
  const [showcaseEditorOpen, setShowcaseEditorOpen] = useState<boolean>(false);
  const [addImageLoading, setAddImageLoading] = useState<boolean>(false);
  const [addImageError, setAddImageError] = useState<string | null>(null);
  const [hotspotLoading, setHotspotLoading] = useState<boolean>(false);
  const [hotspotError, setHotspotError] = useState<string | null>(null);

  // Studio Lighting is offered only when the server reports a self-hosted worker
  useEffect(() => {
    getRenderCapabilities()
      .then((caps) => setStudioLightingAvailable(caps.studioLighting))
      .catch(() => setStudioLightingAvailable(false));
  }, []);
  // The worker is reached through the authenticated API, so it needs a signed-in session
  useEffect(() => {
    setStudioLightingProvider(studioLightingAvailable && session ? createStudioLightingProvider(session.token) : null);
    if (!(studioLightingAvailable && session)) setRenderMode('exact');
  }, [studioLightingAvailable, session]);

  // Persist auth session across reloads
  useEffect(() => {
    try {
      if (session) {
        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
      } else {
        localStorage.removeItem(SESSION_STORAGE_KEY);
      }
    } catch {
      // localStorage unavailable (private browsing, etc.) - session just won't persist
    }
  }, [session]);

  // Load the tenant's own catalog once signed in (empty for a brand-new vendor)
  useEffect(() => {
    if (!session) {
      setRemoteMaterials(null);
      setSelectedMaterial(MATERIALS[0]);
      return;
    }
    let cancelled = false;
    setMaterialsError(null);
    apiListMaterials(session.token)
      .then((remote) => {
        if (cancelled) return;
        const mapped = remote.map(toMaterial);
        setRemoteMaterials(mapped);
        setSelectedMaterial(mapped[0] ?? null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setMaterialsError(err instanceof ApiError ? err.message : 'Could not load your catalog from the server.');
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  // Load the tenant's own showcase images (with hotspots) once signed in
  useEffect(() => {
    if (!session) {
      setShowcaseImages(null);
      return;
    }
    let cancelled = false;
    setShowcaseImagesError(null);
    apiListShowcaseImages(session.token)
      .then((images) => {
        if (cancelled) return;
        setShowcaseImages(images);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setShowcaseImagesError(err instanceof ApiError ? err.message : 'Could not load your showcase images.');
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const handleLogin = useCallback(async (email: string, password: string) => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const result = await apiLogin(email, password);
      setSession(result);
    } catch (err) {
      setAuthError(err instanceof ApiError ? err.message : 'Sign in failed.');
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const handleRegister = useCallback(async (tenantName: string, email: string, password: string, materialCategory: string) => {
    setAuthLoading(true);
    setAuthError(null);
    setAuthNotice(null);
    try {
      const result = await apiRegister(tenantName, email, password, materialCategory);
      setAuthNotice(result.message);
    } catch (err) {
      setAuthError(err instanceof ApiError ? err.message : 'Could not submit your studio application.');
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const handleLogout = useCallback(() => {
    setSession(null);
    setAuthError(null);
  }, []);

  const handleCreateMaterial = useCallback(async (input: NewMaterialInput): Promise<boolean> => {
    if (!session) return false;
    setAddMaterialLoading(true);
    setAddMaterialError(null);
    try {
      const created = await apiCreateMaterial(session.token, input);
      setRemoteMaterials((prev) => [toMaterial(created), ...(prev || [])]);
      return true;
    } catch (err) {
      setAddMaterialError(err instanceof ApiError ? err.message : 'Could not add this material.');
      return false;
    } finally {
      setAddMaterialLoading(false);
    }
  }, [session]);

  const handleUploadMaterialImage = useCallback(async (file: Blob) => {
    if (!session) throw new Error('Sign in to upload images.');
    const { url } = await apiUploadImage(session.token, file, 'materials');
    return url;
  }, [session]);

  const handleUploadShowcaseMask = useCallback(async (mask: Blob) => {
    if (!session) throw new Error('Sign in to save hotspot areas.');
    const { url } = await apiUploadImage(session.token, mask, 'showcase');
    return url;
  }, [session]);

  // Saves a showcase surface (mask + geometry) and keeps the local showroom state in step
  const handleSaveSurface = useCallback(async (imageId: string, surfaceId: string | null, input: Partial<NewSurfaceInput>) => {
    if (!session) throw new Error('Sign in to save surfaces.');
    const saved = surfaceId
      ? await apiUpdateSurface(session.token, surfaceId, input)
      : await apiCreateSurface(session.token, imageId, input as NewSurfaceInput);
    setShowcaseImages((prev) =>
      prev
        ? prev.map((img) =>
            img.id === imageId
              ? { ...img, surfaces: [...img.surfaces.filter((sf) => sf.id !== saved.id), { ...saved, imageId }] }
              : img
          )
        : prev
    );
    return saved;
  }, [session]);

  const handleDeleteSurface = useCallback(async (imageId: string, surfaceId: string) => {
    if (!session) throw new Error('Sign in to edit surfaces.');
    await apiDeleteSurface(session.token, surfaceId);
    // Removing a surface also removes its extra planes (server cascade)
    setShowcaseImages((prev) =>
      prev
        ? prev.map((img) =>
            img.id === imageId
              ? { ...img, surfaces: img.surfaces.filter((sf) => sf.id !== surfaceId && sf.parentSurfaceId !== surfaceId) }
              : img
          )
        : prev
    );
  }, [session]);

  const handleDeleteMaterial = useCallback(async (materialId: string) => {
    if (!session) return;
    try {
      await apiDeleteMaterial(session.token, materialId);
      setRemoteMaterials((prev) => (prev ? prev.filter((m) => m.id !== materialId) : prev));
      setSelectedMaterial((prev) => (prev?.id === materialId ? null : prev));
    } catch (err) {
      setMaterialsError(err instanceof ApiError ? err.message : 'Could not remove this material.');
    }
  }, [session]);

  const handleUpdateMaterial = useCallback(async (materialId: string, input: NewMaterialInput) => {
    if (!session) return;
    setEditMaterialLoading(true);
    setEditMaterialError(null);
    try {
      const updated = await apiUpdateMaterial(session.token, materialId, input);
      const mapped = toMaterial(updated);
      setRemoteMaterials((prev) => (prev ? prev.map((m) => (m.id === materialId ? mapped : m)) : prev));
      setSelectedMaterial((prev) => (prev?.id === materialId ? mapped : prev));
      setEditingMaterial(null);
    } catch (err) {
      setEditMaterialError(err instanceof ApiError ? err.message : 'Could not save changes.');
    } finally {
      setEditMaterialLoading(false);
    }
  }, [session]);

  const handleBulkImport = useCallback(async (items: NewMaterialInput[]): Promise<BulkImportResultItem[]> => {
    if (!session) return items.map((item) => ({ name: item.name, ok: false, error: 'Not signed in.' }));
    setBulkImportLoading(true);
    const results: BulkImportResultItem[] = [];
    const created: Material[] = [];
    for (const item of items) {
      try {
        const material = await apiCreateMaterial(session.token, item);
        created.push(toMaterial(material));
        results.push({ name: item.name, ok: true });
      } catch (err) {
        results.push({ name: item.name, ok: false, error: err instanceof ApiError ? err.message : 'Failed to create.' });
      }
    }
    if (created.length > 0) {
      setRemoteMaterials((prev) => [...created, ...(prev || [])]);
    }
    setBulkImportLoading(false);
    return results;
  }, [session]);

  const handleAddShowcaseImage = useCallback(async (input: NewShowcaseImageInput) => {
    if (!session) return;
    setAddImageLoading(true);
    setAddImageError(null);
    try {
      const created = await apiCreateShowcaseImage(session.token, input);
      setShowcaseImages((prev) => [created, ...(prev || [])]);
    } catch (err) {
      setAddImageError(err instanceof ApiError ? err.message : 'Could not add this image.');
    } finally {
      setAddImageLoading(false);
    }
  }, [session]);

  const handleUpdateShowcaseImage = useCallback(async (imageId: string, input: NewShowcaseImageInput) => {
    if (!session) return;
    setAddImageLoading(true);
    setAddImageError(null);
    try {
      const updated = await apiUpdateShowcaseImage(session.token, imageId, input);
      setShowcaseImages((prev) => (prev ? prev.map((img) => (img.id === imageId ? updated : img)) : prev));
    } catch (err) {
      setAddImageError(err instanceof ApiError ? err.message : 'Could not save changes.');
    } finally {
      setAddImageLoading(false);
    }
  }, [session]);

  const handleDeleteShowcaseImage = useCallback(async (imageId: string) => {
    if (!session) return;
    try {
      await apiDeleteShowcaseImage(session.token, imageId);
      setShowcaseImages((prev) => (prev ? prev.filter((img) => img.id !== imageId) : prev));
    } catch (err) {
      setShowcaseImagesError(err instanceof ApiError ? err.message : 'Could not remove this image.');
    }
  }, [session]);

  const handleCreateHotspot = useCallback(async (imageId: string, input: NewHotspotInput) => {
    if (!session) return;
    setHotspotLoading(true);
    setHotspotError(null);
    try {
      const created = await apiCreateHotspot(session.token, imageId, input);
      setShowcaseImages((prev) =>
        prev ? prev.map((img) => (img.id === imageId ? { ...img, hotspots: [...img.hotspots, created] } : img)) : prev
      );
    } catch (err) {
      setHotspotError(err instanceof ApiError ? err.message : 'Could not add this hotspot.');
    } finally {
      setHotspotLoading(false);
    }
  }, [session]);

  const handleUpdateHotspot = useCallback(async (hotspotId: string, input: NewHotspotInput) => {
    if (!session) return;
    setHotspotLoading(true);
    setHotspotError(null);
    try {
      const updated = await apiUpdateHotspot(session.token, hotspotId, input);
      setShowcaseImages((prev) =>
        prev
          ? prev.map((img) => ({
              ...img,
              hotspots: img.hotspots.map((h) => (h.id === hotspotId ? updated : h)),
            }))
          : prev
      );
    } catch (err) {
      setHotspotError(err instanceof ApiError ? err.message : 'Could not save changes.');
    } finally {
      setHotspotLoading(false);
    }
  }, [session]);

  const handleDeleteHotspot = useCallback(async (hotspotId: string) => {
    if (!session) return;
    try {
      await apiDeleteHotspot(session.token, hotspotId);
      setShowcaseImages((prev) =>
        prev ? prev.map((img) => ({ ...img, hotspots: img.hotspots.filter((h) => h.id !== hotspotId) })) : prev
      );
    } catch (err) {
      setShowcaseImagesError(err instanceof ApiError ? err.message : 'Could not remove this hotspot.');
    }
  }, [session]);


  // The one way anything gets rendered: exact renderer over accepted surfaces, never a guess
  const runRender = useCallback(async (imageUrl: string, layers: RenderLayerInput[], debug: RenderDebugView = debugView) => {
    const request = ++renderRequest.current;
    setApplicationLoading(true);
    setErrorMessage(null);
    setRenderNotice(null);
    try {
      const url = await renderMaterial(imageUrl, layers, { mode: renderMode, debug });
      if (request !== renderRequest.current) return;
      lastRender.current = { imageUrl, layers };
      setProcessedImageUrl(url);
    } catch (err) {
      if (request !== renderRequest.current) return;
      console.error(err);
      setErrorMessage(errorText(err, 'Rendering failed. Please try another finish.'));
    } finally {
      if (request === renderRequest.current) setApplicationLoading(false);
    }
  }, [renderMode, debugView]);

  // Re-show the last render with a different diagnostic overlay (staff)
  const handleDebugViewChange = useCallback((view: RenderDebugView) => {
    setDebugView(view);
    if (lastRender.current) runRender(lastRender.current.imageUrl, lastRender.current.layers, view);
  }, [runRender]);

  // Signed-in vendors only see their own showcase rooms as presets
  const galleryRooms = useMemo(
    () => (session ? (showcaseImages ?? []).map(toCuratedRoom) : CURATED_ROOMS),
    [session, showcaseImages]
  );

  // The vendor showcase room currently on the canvas (its hotspots become clickable pins)
  const activeShowcaseImage = useMemo(
    () => (session ? showcaseImages?.find((img) => `showcase-${img.id}` === selectedCuratedRoomId) ?? null : null),
    [session, showcaseImages, selectedCuratedRoomId]
  );
  // Finish chosen per hotspot on the active room, by hotspot id
  const [hotspotSelections, setHotspotSelections] = useState<Record<string, Material>>({});
  const hotspotRenderRequest = useRef(0);
  useEffect(() => {
    setHotspotSelections({});
  }, [selectedCuratedRoomId]);

  // Picking a finish on a hotspot pin re-renders every hotspot that has one — each with its own
  // material, exact area and perspective — so e.g. the wall and floor can differ
  const handleHotspotMaterialSelect = useCallback(async (hotspot: RemoteHotspot, material: Material) => {
    if (!activeShowcaseImage) return;
    const selections = { ...hotspotSelections, [hotspot.id]: material };
    setHotspotSelections(selections);
    setSelectedMaterial(material);
    const layers: RenderLayerInput[] = [];
    for (const h of activeShowcaseImage.hotspots) {
      if (!selections[h.id]) continue;
      const surface = activeShowcaseImage.surfaces.find((s) => s.id === h.surfaceId);
      if (!surface) {
        setErrorMessage(`"${h.label}" has no reviewed surface yet — open Manage Showcase & Hotspots and detect its area.`);
        return;
      }
      for (const part of [surface, ...activeShowcaseImage.surfaces.filter((p) => p.parentSurfaceId === surface.id)]) {
        layers.push({ surface: savedSurfaceToRenderable(part), material: selections[h.id] });
      }
    }
    await runRender(activeShowcaseImage.imageUrl, layers);
  }, [activeShowcaseImage, hotspotSelections, runRender]);

  // Select a Curated Room preset — its surfaces come from analysis (or saved vendor surfaces)
  const handleSelectCuratedRoom = useCallback((room: CuratedRoom) => {
    setSelectedCuratedRoomId(room.id);
    setSelectedRoomType(room.roomType);
    setUploadedImageFile(null);
    setUploadedImageUrl(room.fullImage);
    setProcessedImageUrl(null);
    setErrorMessage(null);
  }, []);

  // Put the vendor's first showcase room on the canvas after sign-in, and the demo room back after sign-out
  const vendorRoomShown = useRef(false);
  useEffect(() => {
    if (!session) {
      if (vendorRoomShown.current) {
        vendorRoomShown.current = false;
        handleSelectCuratedRoom(CURATED_ROOMS[0]);
      }
      return;
    }
    if (vendorRoomShown.current || galleryRooms.length === 0) return;
    vendorRoomShown.current = true;
    handleSelectCuratedRoom(galleryRooms[0]);
  }, [session, galleryRooms, handleSelectCuratedRoom]);

  // Analyze each new photo once; a vendor's showcase room uses its saved surfaces instead
  const showcaseSurfaceKey = activeShowcaseImage ? `${activeShowcaseImage.id}:${activeShowcaseImage.surfaces.map((s) => s.id).join(',')}` : '';
  useEffect(() => {
    if (!uploadedImageUrl) return;
    let cancelled = false;
    setAnalysisError(null);
    setAnalysisWarnings([]);
    setSelectedItemIds(new Set());
    if (activeShowcaseImage) {
      const items = activeShowcaseImage.surfaces
        .filter((s) => !s.parentSurfaceId)
        .map((s) => {
          const pin = activeShowcaseImage.hotspots.find((h) => h.surfaceId === s.id);
          const parts = activeShowcaseImage.surfaces.filter((p) => p.parentSurfaceId === s.id);
          return savedSurfaceToItem(s, parts, pin ? { xPct: pin.xPct, yPct: pin.yPct } : undefined);
        });
      setDetectedItems(items);
      setAnalyzing(false);
      if (items[0]) setSelectedItemIds(new Set([items[0].id]));
      if (items.length === 0) setAnalysisError('This showroom photo has no saved surfaces yet — add them in Manage Showcase & Hotspots.');
      return;
    }
    setDetectedItems([]);
    setAnalyzing(true);
    analyzeRoom(uploadedImageUrl)
      .then(({ items, warnings }) => {
        if (cancelled) return;
        setDetectedItems(items);
        setAnalysisWarnings(warnings);
        const first = items.find((i) => i.surfaceKind === 'wall') ?? items[0];
        if (first) setSelectedItemIds(new Set([first.id]));
        if (items.length === 0) setAnalysisError('No re-surfaceable walls, floors or ceilings were found in this photo.');
      })
      .catch((err: unknown) => {
        if (!cancelled) setAnalysisError(errorText(err, 'Could not analyze this photo.'));
      })
      .finally(() => {
        if (!cancelled) setAnalyzing(false);
      });
    return () => {
      cancelled = true;
    };
    // showcaseSurfaceKey stands in for activeShowcaseImage's surfaces
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadedImageUrl, showcaseSurfaceKey]);

  // Handle custom room photo upload — analysis runs from the effect above
  const handleFileUpload = useCallback(async (file: File | null) => {
    if (!file) {
      setUploadedImageFile(null);
      return;
    }
    setUploadedImageFile(file);
    setSelectedCuratedRoomId(null);
    setProcessedImageUrl(null);
    setErrorMessage(null);
    const reader = new FileReader();
    reader.onload = () => setUploadedImageUrl(reader.result as string);
    reader.readAsDataURL(file);
  }, []);

  // Target element selection handlers
  const handleItemSelect = (itemId: string) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelectedItemIds(new Set(detectedItems.map((i) => i.id)));
  };

  const handleClearAll = () => {
    setSelectedItemIds(new Set());
  };


  // Materialize: cut/resolve each selected surface (once), then render them all
  const applyMaterial = async (material: Material | null = selectedMaterial) => {
    if (!uploadedImageUrl || selectedItemIds.size === 0 || !material) return;
    const selectedMaterial = material;
    const imageUrl = uploadedImageUrl;
    const selected = detectedItems.filter((item) => selectedItemIds.has(item.id));
    setApplicationLoading(true);
    try {
      const resolved = await Promise.all(selected.map((item) => resolveSurface(imageUrl, item)));
      // Keep the cut masks (and their confidence) so switching materials never re-runs a model
      setDetectedItems((prev) => prev.map((item) => resolved.find((r) => r.item.id === item.id)?.item ?? item));
      const needsCorrection = resolved.find((r) => r.item.reviewDecision === 'correct');
      if (needsCorrection) {
        // Below the review threshold: show the area for correction straight away
        setReviewingItem(needsCorrection.item);
        setRenderNotice('One surface was uncertain — check its area before relying on this render.');
      }
      await runRender(imageUrl, resolved.flatMap((r) => r.surfaces.map((surface) => ({ surface, material: selectedMaterial }))));
    } catch (err) {
      setErrorMessage(errorText(err, 'Could not prepare these surfaces.'));
      setApplicationLoading(false);
    }
  };
  const handleApplyTexture = () => applyMaterial();

  // Choosing a material renders it straight away on the selected surfaces
  const handleSelectMaterial = (material: Material) => {
    setSelectedMaterial(material);
    if (!analyzing && selectedItemIds.size > 0) applyMaterial(material);
  };

  // Staff-only benchmark against Gemini (temporary; never part of the product render path)
  const handleCompareWithGemini = async () => {
    if (!uploadedImageUrl || !selectedMaterial) return;
    setApplicationLoading(true);
    try {
      const names = detectedItems.filter((i) => selectedItemIds.has(i.id)).map((i) => i.name);
      setProcessedImageUrl(await compareWithGemini(uploadedImageUrl, selectedMaterial, names));
      setRenderNotice('Showing a Gemini comparison — not product-exact and not what customers see.');
    } catch (err) {
      setErrorMessage(errorText(err, 'Gemini comparison failed.'));
    } finally {
      setApplicationLoading(false);
    }
  };

  // Reset workspace
  const handleResetWorkspace = () => {
    if (galleryRooms[0]) handleSelectCuratedRoom(galleryRooms[0]);
    setSelectedMaterial(materialsList[0] ?? null);
    setCustomDirective('');
    setErrorMessage(null);
  };

  // Directive suggestion pills
  // Installation-note suggestions (spec sheet only — they don't change the render)
  const directiveSuggestions = [
    'Book-match panels across the feature wall',
    'Align vertical joints with door and window edges',
    'Continuous grain direction on all panels',
    'Leave 3mm expansion gap at skirting and ceiling',
  ];

  const selectedItemsList = detectedItems.filter((i) => selectedItemIds.has(i.id));
  const isStaff = session?.user.role === 'OWNER' || session?.user.role === 'ADMIN';
  const isApplyDisabled = applicationLoading || selectedItemIds.size === 0 || !selectedMaterial || !uploadedImageUrl;
  const materialsList = session ? remoteMaterials ?? [] : MATERIALS;

  return (
    <div className="min-h-screen bg-[#0b0c10] text-slate-100 flex flex-col font-sans">
      {/* Studio Top Navigation */}
      <StudioHeader
        selectedRoomType={selectedRoomType}
        onSelectRoomType={(newType) => {
          setSelectedRoomType(newType);
          // If a curated room matches this type, auto-select it
          const matchingCurated = galleryRooms.find((r) => r.roomType === newType);
          if (matchingCurated) {
            handleSelectCuratedRoom(matchingCurated);
          }
        }}
        onOpenSpecSheet={() => setSpecSheetOpen(true)}
        onReset={handleResetWorkspace}
        renderMode={renderMode}
        onRenderModeChange={setRenderMode}
        studioLightingAvailable={studioLightingAvailable && Boolean(session)}
      />

      {/* Main Studio Workspace */}
      <main className="flex-1 max-w-[1700px] w-full mx-auto px-4 sm:px-6 py-6 md:py-8">
        {/* Error notification banner */}
        {errorMessage && (
          <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs flex items-center justify-between gap-3 animate-in fade-in">
            <div className="flex items-center gap-2.5">
              <span className="w-2 h-2 rounded-full bg-rose-400"></span>
              <span>{errorMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="text-xs text-rose-400 hover:text-white"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* 3-Column Studio Grid Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 md:gap-8 items-start">
          
          {/* =========================================
              LEFT COLUMN: Architecture & Elements Panel
             ========================================= */}
          <aside className="lg:col-span-3 space-y-6 order-2 lg:order-1">
            {/* Curated Rooms Gallery */}
            <section className="p-5 rounded-2xl bg-[#12141c] border border-white/[0.08] shadow-xl space-y-4">
              <CuratedRoomsGallery
                rooms={galleryRooms}
                isVendor={!!session}
                selectedRoomId={selectedCuratedRoomId}
                onSelectRoom={handleSelectCuratedRoom}
              />
            </section>

            {/* Custom Photo Upload */}
            <section className="p-5 rounded-2xl bg-[#12141c] border border-white/[0.08] shadow-xl space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Custom Room Upload
                </label>
                <span className="text-[10px] text-slate-500">Your Photo</span>
              </div>
              <FileUpload
                onFileUpload={handleFileUpload}
                currentFileName={uploadedImageFile?.name}
              />
            </section>

            {/* Target Architectural Elements */}
            <section className="p-5 rounded-2xl bg-[#12141c] border border-white/[0.08] shadow-xl space-y-4">
              <DetectedItems
                items={detectedItems}
                selectedItemIds={selectedItemIds}
                onItemSelect={handleItemSelect}
                onSelectAll={handleSelectAll}
                onClearAll={handleClearAll}
                analyzing={analyzing}
                progressLabel={analysisProgress}
                onReviewItem={setReviewingItem}
                analysisError={analysisError}
                warnings={analysisWarnings}
              />
            </section>
          </aside>

          {/* =========================================
              CENTER COLUMN: Studio Canvas & Render Controls
             ========================================= */}
          <section className="lg:col-span-6 space-y-6 order-1 lg:order-2">
            {/* The Visualizer Canvas */}
            <ResultDisplay
              uploadedImageUrl={uploadedImageUrl}
              processedImageUrl={processedImageUrl}
              isLoading={applicationLoading}
              isDetectionLoading={analyzing}
              selectedMaterial={selectedMaterial}
              selectedItemsCount={selectedItemIds.size}
              hotspots={activeShowcaseImage?.hotspots}
              hotspotMaterials={materialsList}
              hotspotSelections={hotspotSelections}
              onHotspotMaterialSelect={handleHotspotMaterialSelect}
              showDebugTools={isStaff}
              debugView={debugView}
              onDebugViewChange={handleDebugViewChange}
              notice={renderNotice}
              onCompareWithGemini={isStaff && isGeminiCompareAvailable() ? handleCompareWithGemini : undefined}
            />

            {/* Materialization CTA & Directive Refinement */}
            <div className="p-5 rounded-2xl bg-[#12141c] border border-white/[0.08] shadow-xl space-y-4">
              {/* Primary Action Button */}
              <div className="flex flex-col sm:flex-row items-center gap-4">
                <button
                  type="button"
                  id="btn-materialize-render"
                  onClick={handleApplyTexture}
                  disabled={isApplyDisabled}
                  className={`w-full sm:flex-1 py-4 px-6 rounded-xl font-semibold text-xs tracking-wider uppercase transition-all duration-300 flex items-center justify-center gap-2.5 shadow-xl ${
                    isApplyDisabled
                      ? 'bg-white/[0.05] text-slate-500 border border-white/[0.06] cursor-not-allowed'
                      : 'bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600 text-slate-950 hover:brightness-110 active:scale-[0.99] shadow-amber-500/20'
                  }`}
                >
                  {applicationLoading ? (
                    <>
                      <Wand2 className="w-4 h-4 animate-spin" />
                      <span>Synthesizing Concept Render...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>Materialize Finish on {selectedItemIds.size} Target{selectedItemIds.size === 1 ? '' : 's'}</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  id="btn-quick-spec"
                  onClick={() => setSpecSheetOpen(true)}
                  className="w-full sm:w-auto px-5 py-4 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-xs font-medium text-slate-300 hover:text-white transition-colors flex items-center justify-center gap-2 shrink-0"
                >
                  <SlidersHorizontal className="w-4 h-4 text-amber-400" />
                  <span>Spec Sheet</span>
                </button>
              </div>

              {/* Optional Custom Aesthetic Directive */}
              <div className="space-y-2 pt-2 border-t border-white/[0.06]">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
                    <Info className="w-3.5 h-3.5 text-amber-400" />
                    <span>Installation Note</span>
                  </label>
                  <span className="text-[10px] text-slate-500">Printed on the spec sheet</span>
                </div>

                <input
                  type="text"
                  value={customDirective}
                  onChange={(e) => setCustomDirective(e.target.value)}
                  placeholder="e.g. Book-match panels on the feature wall, align joints with the doorway…"
                  className="w-full bg-[#0d0e14] border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-400 transition-colors"
                />

                {/* Quick suggestion tags */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {directiveSuggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => setCustomDirective(suggestion)}
                      className="px-2.5 py-1 rounded-lg bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.05] text-[10px] text-slate-400 hover:text-slate-200 transition-colors"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* =========================================
              RIGHT COLUMN: Material & Finishes Atelier
             ========================================= */}
          <aside className="lg:col-span-3 space-y-6 order-3">
            <AuthPanel
              session={session}
              loading={authLoading}
              error={authError}
              notice={authNotice}
              onLogin={handleLogin}
              onRegister={handleRegister}
              onLogout={handleLogout}
              onDismissNotice={() => setAuthNotice(null)}
            />

            {session && (
              <section className="p-5 rounded-2xl bg-[#12141c] border border-white/[0.08] shadow-xl space-y-3">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
                    Vendor Storefront
                  </h3>
                  <p className="text-[10px] text-slate-500">
                    {session.tenant?.slug ? `Public URL: /store/${session.tenant.slug}` : 'Build a public showcase with clickable hotspots'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowcaseEditorOpen(true)}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-xs font-medium text-slate-300 hover:text-white transition-colors"
                >
                  <MapPin className="w-3.5 h-3.5 text-amber-400" />
                  Manage Showcase &amp; Hotspots
                </button>
                {session.tenant?.slug && (
                  <a
                    href={`/store/${session.tenant.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-center text-[10px] text-amber-400 hover:text-amber-300 underline"
                  >
                    View public storefront ↗
                  </a>
                )}
              </section>
            )}

            <section className="p-5 rounded-2xl bg-[#12141c] border border-white/[0.08] shadow-xl space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
                    Finishes Atelier
                  </h3>
                  <p className="text-[10px] text-slate-500">
                    {session
                      ? `Your ${session.tenant?.materialCategory ?? ''} Catalog`
                      : 'Architectural Textures & Swatches'}
                  </p>
                </div>
                {selectedMaterial && (
                  <span className="text-[10px] text-amber-400 font-medium">
                    1 Selected
                  </span>
                )}
              </div>

              {materialsError && (
                <p className="text-[11px] text-rose-300">{materialsError}</p>
              )}

              <MaterialGrid
                materials={materialsList}
                selectedMaterial={selectedMaterial}
                onSelectMaterial={handleSelectMaterial}
                currentTenantId={session?.user.tenantId ?? null}
                onDeleteMaterial={session ? handleDeleteMaterial : undefined}
                onEditMaterial={session ? setEditingMaterial : undefined}
                lockedCategory={session?.tenant?.materialCategory ?? null}
              />

              {session && (
                <div className="space-y-2">
                  <AddMaterialForm
                    lockedCategory={session.tenant?.materialCategory ?? 'tile'}
                    loading={addMaterialLoading}
                    error={addMaterialError}
                    onSubmit={handleCreateMaterial}
                    onUploadImage={handleUploadMaterialImage}
                  />
                  <button
                    type="button"
                    onClick={() => setBulkImportOpen(true)}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.03] hover:bg-white/[0.07] border border-dashed border-white/[0.15] text-[11px] font-medium text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    Bulk Import (JSON)
                  </button>
                </div>
              )}
            </section>
          </aside>
        </div>
      </main>

      {/* Atelier Footer */}
      <footer className="border-t border-white/[0.06] bg-[#0c0d12] py-6 px-6 text-center text-slate-500 text-[11px] font-sans">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>
            &copy; {new Date().getFullYear()} Material Visualizer &bull; Atelier Architectural Interior Studio
          </p>
          <div className="flex items-center gap-4 text-[10px] tracking-wider uppercase">
            <span>High-Fidelity Rendering</span>
            <span>&bull;</span>
            <span>Physical Light Mapping</span>
            <span>&bull;</span>
            <span>Material Procurement</span>
          </div>
        </div>
      </footer>

      {reviewingItem && uploadedImageUrl && (
        <SurfaceReviewModal
          key={reviewingItem.id}
          imageUrl={uploadedImageUrl}
          item={reviewingItem}
          previewMaterial={selectedMaterial}
          onClose={() => setReviewingItem(null)}
          onAccept={(fixed) => {
            setReviewingItem(null);
            const items = detectedItems.map((i) => (i.id === fixed.id ? fixed : i));
            setDetectedItems(items);
            setRenderNotice(null);
            // Re-render the selected surfaces with the corrected area
            const layers = items
              .filter((i) => selectedItemIds.has(i.id) && i.surfaces?.length)
              .flatMap((i) => i.surfaces!.map((surface) => ({ surface, material: selectedMaterial! })));
            if (selectedMaterial && layers.length) runRender(uploadedImageUrl, layers);
          }}
        />
      )}

      {/* Material Specification Modal */}
      <SpecSheetModal
        isOpen={specSheetOpen}
        onClose={() => setSpecSheetOpen(false)}
        roomType={selectedRoomType}
        roomTitle={selectedCuratedRoomId ? galleryRooms.find((r) => r.id === selectedCuratedRoomId)?.title : undefined}
        selectedItems={selectedItemsList}
        selectedMaterial={selectedMaterial}
        previewImageUrl={processedImageUrl || uploadedImageUrl}
        customDirective={customDirective}
      />

      {/* Edit / Bulk Import Material Modals (signed-in tenant catalog management) */}
      <EditMaterialModal
        material={editingMaterial}
        loading={editMaterialLoading}
        error={editMaterialError}
        onClose={() => {
          setEditingMaterial(null);
          setEditMaterialError(null);
        }}
        onSave={handleUpdateMaterial}
        onUploadImage={handleUploadMaterialImage}
      />

      <BulkImportModal
        isOpen={bulkImportOpen}
        loading={bulkImportLoading}
        onClose={() => setBulkImportOpen(false)}
        onImport={handleBulkImport}
      />

      <ShowcaseEditorModal
        isOpen={showcaseEditorOpen}
        onClose={() => setShowcaseEditorOpen(false)}
        images={showcaseImages}
        imagesError={showcaseImagesError}
        storefrontSlug={session?.tenant?.slug}
        addImageLoading={addImageLoading}
        addImageError={addImageError}
        onAddImage={handleAddShowcaseImage}
        onUpdateImage={handleUpdateShowcaseImage}
        onDeleteImage={handleDeleteShowcaseImage}
        hotspotLoading={hotspotLoading}
        hotspotError={hotspotError}
        onCreateHotspot={handleCreateHotspot}
        onUpdateHotspot={handleUpdateHotspot}
        onDeleteHotspot={handleDeleteHotspot}
        onUploadMask={handleUploadShowcaseMask}
        onSaveSurface={handleSaveSurface}
        onDeleteSurface={handleDeleteSurface}
        previewMaterial={selectedMaterial}
        defaultCategory={session?.tenant?.materialCategory}
      />
    </div>
  );
};

export default App;
