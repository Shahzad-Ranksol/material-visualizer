import React, { useState, useEffect, useCallback } from 'react';
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
import { ResultDisplay } from './components/ResultDisplay';
import { SpecSheetModal } from './components/SpecSheetModal';
import { CURATED_ROOMS, MATERIALS, ROOM_TYPES } from './constants';
import {
  detectObjectsInImage,
  applyTextureToObjects,
  checkGeminiApiKey
} from './services/geminiService';
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
  RemoteShowcaseImage,
  NewShowcaseImageInput,
  NewHotspotInput,
  listShowcaseImages as apiListShowcaseImages,
  createShowcaseImage as apiCreateShowcaseImage,
  updateShowcaseImage as apiUpdateShowcaseImage,
  deleteShowcaseImage as apiDeleteShowcaseImage,
  createHotspot as apiCreateHotspot,
  updateHotspot as apiUpdateHotspot,
  deleteHotspot as apiDeleteHotspot,
} from './services/apiClient';
import { RoomType, Material, MaterialCategory, DetectedItem, CuratedRoom } from './types';
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
  renderOverlayTone: m.renderOverlayTone ?? undefined,
  tileScale: m.tileScale ?? undefined,
  blendMode: (m.blendMode as Material['blendMode']) ?? undefined,
});

const App: React.FC = () => {
  // Room & Image State
  const [selectedRoomType, setSelectedRoomType] = useState<RoomType>(CURATED_ROOMS[0].roomType);
  const [selectedCuratedRoomId, setSelectedCuratedRoomId] = useState<string | null>(CURATED_ROOMS[0].id);
  const [uploadedImageFile, setUploadedImageFile] = useState<File | null>(null);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(CURATED_ROOMS[0].fullImage);

  // Architectural Elements State
  const [detectedItems, setDetectedItems] = useState<DetectedItem[]>(() => {
    return CURATED_ROOMS[0].detectedDefaults.map((d, index) => ({
      id: `item-init-${index}`,
      name: d.name,
      category: d.category,
      description: d.description,
      confidence: 96,
    }));
  });

  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(() => {
    // Pre-select first two architectural elements for instant visual readiness
    return new Set(['item-init-0', 'item-init-3']);
  });

  // Materials & Rendering State
  const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(MATERIALS[0]);
  const [customDirective, setCustomDirective] = useState<string>('');
  const [processedImageUrl, setProcessedImageUrl] = useState<string | null>(null);

  // Status & Feedback
  const [detectionLoading, setDetectionLoading] = useState<boolean>(false);
  const [applicationLoading, setApplicationLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [specSheetOpen, setSpecSheetOpen] = useState<boolean>(false);
  const [hasApiKey, setHasApiKey] = useState<boolean>(false);
  const [useAI, setUseAI] = useState<boolean>(false);

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

  // Check API key availability in environment (non-blocking)
  useEffect(() => {
    const keyPresent = checkGeminiApiKey();
    setHasApiKey(keyPresent);
  }, []);

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

  // Load the tenant's catalog (shared defaults + their own materials) once signed in
  useEffect(() => {
    if (!session) {
      setRemoteMaterials(null);
      return;
    }
    let cancelled = false;
    setMaterialsError(null);
    apiListMaterials(session.token)
      .then((remote) => {
        if (cancelled) return;
        setRemoteMaterials(remote.map(toMaterial));
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

  const handleDeleteMaterial = useCallback(async (materialId: string) => {
    if (!session) return;
    try {
      await apiDeleteMaterial(session.token, materialId);
      setRemoteMaterials((prev) => (prev ? prev.filter((m) => m.id !== materialId) : prev));
      setSelectedMaterial((prev) => (prev?.id === materialId ? MATERIALS[0] : prev));
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

  // Pre-generate initial concept render for the default room so split slider is ready instantly
  useEffect(() => {
    if (!processedImageUrl && uploadedImageUrl && selectedMaterial) {
      applyTextureToObjects(
        uploadedImageUrl,
        'image/jpeg',
        ['Feature Accent Wall', 'Sculptural Coffee Table'],
        selectedMaterial,
        useAI
      ).then((res) => {
        setProcessedImageUrl(res);
      }).catch(() => {});
    }
  }, []);

  // Select a Curated Room preset
  const handleSelectCuratedRoom = useCallback((room: CuratedRoom) => {
    setSelectedCuratedRoomId(room.id);
    setSelectedRoomType(room.roomType);
    setUploadedImageFile(null);
    setUploadedImageUrl(room.fullImage);
    setErrorMessage(null);

    const newItems: DetectedItem[] = room.detectedDefaults.map((d, index) => ({
      id: `item-${room.id}-${index}`,
      name: d.name,
      category: d.category,
      description: d.description,
      confidence: 95 + (index % 4),
    }));

    setDetectedItems(newItems);
    // Preselect primary focal surface
    setSelectedItemIds(new Set([newItems[0].id]));

    // Generate fresh concept render for this room
    if (selectedMaterial) {
      applyTextureToObjects(
        room.fullImage,
        'image/jpeg',
        [newItems[0].name],
        selectedMaterial,
        useAI
      ).then((res) => {
        setProcessedImageUrl(res);
      }).catch(() => {});
    }
  }, [selectedMaterial, useAI]);

  // Handle custom room photo upload
  const handleFileUpload = useCallback(async (file: File | null) => {
    if (!file) {
      setUploadedImageFile(null);
      return;
    }

    setUploadedImageFile(file);
    setSelectedCuratedRoomId(null);
    setProcessedImageUrl(null);
    setErrorMessage(null);
    setDetectionLoading(true);

    const reader = new FileReader();
    reader.onload = async () => {
      const base64Data = reader.result as string;
      setUploadedImageUrl(base64Data);

      try {
        const items = await detectObjectsInImage(base64Data, file.type, selectedRoomType, useAI);
        setDetectedItems(items);
        if (items.length > 0) {
          // Pre-select first item
          setSelectedItemIds(new Set([items[0].id]));
        } else {
          setErrorMessage('No specific objects isolated. You can still add custom surfaces or re-texture the space.');
        }
      } catch (err: any) {
        setErrorMessage(err.message || 'Vision scan encountered an issue. Standard surfaces available.');
      } finally {
        setDetectionLoading(false);
      }
    };
    reader.readAsDataURL(file);
  }, [selectedRoomType, useAI]);

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

  const handleAddCustomItem = (name: string, category: DetectedItem['category']) => {
    const newItem: DetectedItem = {
      id: `custom-${Date.now()}`,
      name,
      category,
      description: `Bespoke architectural ${name} defined by designer.`,
      confidence: 100,
    };
    setDetectedItems((prev) => [newItem, ...prev]);
    setSelectedItemIds((prev) => new Set([...prev, newItem.id]));
  };

  // Materialize / Render Concept
  const handleApplyTexture = async () => {
    if (!uploadedImageUrl || selectedItemIds.size === 0 || !selectedMaterial) return;

    setApplicationLoading(true);
    setErrorMessage(null);

    const itemsToModify = Array.from(selectedItemIds)
      .map((id) => detectedItems.find((item) => item.id === id)?.name)
      .filter((name): name is string => Boolean(name));

    try {
      const mimeType = uploadedImageFile ? uploadedImageFile.type : 'image/jpeg';
      const renderedUrl = await applyTextureToObjects(
        uploadedImageUrl,
        mimeType,
        itemsToModify,
        selectedMaterial,
        useAI,
        customDirective
      );
      setProcessedImageUrl(renderedUrl);
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || 'Rendering synthesis failed. Please try with another finish.');
    } finally {
      setApplicationLoading(false);
    }
  };

  // Reset workspace
  const handleResetWorkspace = () => {
    handleSelectCuratedRoom(CURATED_ROOMS[0]);
    setSelectedMaterial(MATERIALS[0]);
    setCustomDirective('');
    setErrorMessage(null);
  };

  // Directive suggestion pills
  const directiveSuggestions = [
    'Subtle satin finish & soft daylight',
    'Warm golden hour side illumination',
    'Continuous seamless slab joinery',
    'Artisanal matte texture with low glare',
  ];

  const selectedItemsList = detectedItems.filter((i) => selectedItemIds.has(i.id));
  const isApplyDisabled = applicationLoading || selectedItemIds.size === 0 || !selectedMaterial || !uploadedImageUrl;
  const materialsList = remoteMaterials ?? MATERIALS;

  return (
    <div className="min-h-screen bg-[#0b0c10] text-slate-100 flex flex-col font-sans">
      {/* Studio Top Navigation */}
      <StudioHeader
        selectedRoomType={selectedRoomType}
        onSelectRoomType={(newType) => {
          setSelectedRoomType(newType);
          // If a curated room matches this type, auto-select it
          const matchingCurated = CURATED_ROOMS.find((r) => r.roomType === newType);
          if (matchingCurated) {
            handleSelectCuratedRoom(matchingCurated);
          }
        }}
        onOpenSpecSheet={() => setSpecSheetOpen(true)}
        onReset={handleResetWorkspace}
        hasApiKey={hasApiKey}
        useAI={useAI}
        onToggleAI={() => setUseAI((prev) => !prev)}
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
                onAddCustomItem={handleAddCustomItem}
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
              isDetectionLoading={detectionLoading}
              selectedMaterial={selectedMaterial}
              selectedItemsCount={selectedItemIds.size}
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
                    <span>Architectural Lighting & Sheen Directive</span>
                  </label>
                  <span className="text-[10px] text-slate-500">Optional refinement</span>
                </div>

                <input
                  type="text"
                  value={customDirective}
                  onChange={(e) => setCustomDirective(e.target.value)}
                  placeholder="e.g. Afternoon window light, honed silk reflection, seamless bookmatched joints..."
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
                      ? `Your ${session.tenant?.materialCategory ?? ''} Catalog + Shared Defaults`
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
                onSelectMaterial={setSelectedMaterial}
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

      {/* Material Specification Modal */}
      <SpecSheetModal
        isOpen={specSheetOpen}
        onClose={() => setSpecSheetOpen(false)}
        roomType={selectedRoomType}
        roomTitle={selectedCuratedRoomId ? CURATED_ROOMS.find((r) => r.id === selectedCuratedRoomId)?.title : undefined}
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
      />
    </div>
  );
};

export default App;
