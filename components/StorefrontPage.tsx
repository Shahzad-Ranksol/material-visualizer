import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { MapPin, Loader2, RotateCcw, Wand2 } from 'lucide-react';
import {
  PublicTenant,
  RemoteShowcaseImage,
  RemoteHotspot,
  ApiError,
  getPublicTenant,
  listPublicMaterials,
  listPublicShowcase,
} from '../services/apiClient';
import { applyTextureToObjects } from '../services/geminiService';
import { Material } from '../types';
import { toMaterial } from '../App';
import { HotspotImage, HotspotViewModel } from './HotspotImage';
import { HotspotMaterialPicker } from './HotspotMaterialPicker';

export const StorefrontPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tenant, setTenant] = useState<PublicTenant | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [images, setImages] = useState<RemoteShowcaseImage[]>([]);
  const [activeImageId, setActiveImageId] = useState<string | null>(null);

  const [activeHotspot, setActiveHotspot] = useState<RemoteHotspot | null>(null);
  const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(null);
  const [renderedUrl, setRenderedUrl] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setLoadError(null);

    Promise.all([getPublicTenant(slug), listPublicMaterials(slug), listPublicShowcase(slug)])
      .then(([tenantRes, materialsRes, imagesRes]) => {
        if (cancelled) return;
        setTenant(tenantRes);
        setMaterials(materialsRes.map(toMaterial));
        setImages(imagesRes);
        setActiveImageId(imagesRes[0]?.id ?? null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
        } else {
          setLoadError(err instanceof ApiError ? err.message : 'Could not load this storefront.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  const activeImage = images.find((img) => img.id === activeImageId) || null;

  const resetSelection = () => {
    setActiveHotspot(null);
    setSelectedMaterial(null);
    setRenderedUrl(null);
    setApplyError(null);
  };

  const handleSelectImage = (imageId: string) => {
    setActiveImageId(imageId);
    resetSelection();
  };

  const handleHotspotClick = (hotspot: RemoteHotspot) => {
    setActiveHotspot(hotspot);
    setSelectedMaterial(null);
    setRenderedUrl(null);
    setApplyError(null);
  };

  const handleSelectMaterial = async (material: Material) => {
    if (!activeImage || !activeHotspot) return;
    setSelectedMaterial(material);
    setApplying(true);
    setApplyError(null);
    try {
      const result = await applyTextureToObjects(activeImage.imageUrl, 'image/jpeg', [activeHotspot.label], material, false);
      setRenderedUrl(result);
    } catch (err: any) {
      setApplyError(err?.message || 'Could not render this material — try another finish.');
    } finally {
      setApplying(false);
    }
  };

  const hotspotViewModels: HotspotViewModel[] = (activeImage?.hotspots || []).map((h) => ({
    id: h.id,
    label: h.label,
    xPct: h.xPct,
    yPct: h.yPct,
  }));

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0b0c10] text-slate-100 flex items-center justify-center font-sans">
        <div className="flex items-center gap-2.5 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin text-amber-400" />
          <span className="text-sm">Loading storefront...</span>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-[#0b0c10] text-slate-100 flex items-center justify-center font-sans p-8">
        <div className="text-center space-y-2 max-w-sm">
          <h1 className="text-lg font-serif text-slate-200">Storefront not found</h1>
          <p className="text-xs text-slate-500">No vendor showroom exists at this URL.</p>
        </div>
      </div>
    );
  }

  if (loadError || !tenant) {
    return (
      <div className="min-h-screen bg-[#0b0c10] text-slate-100 flex items-center justify-center font-sans p-8">
        <p className="text-xs text-rose-300">{loadError || 'Something went wrong loading this storefront.'}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0b0c10] text-slate-100 font-sans">
      <header className="border-b border-white/[0.08] bg-[#0f1117]/95 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 via-amber-500 to-amber-700 p-[1px] shadow-lg shadow-amber-500/10">
            <div className="w-full h-full rounded-[11px] bg-[#12141c] flex items-center justify-center text-amber-300 font-serif font-bold text-sm">
              {tenant.name.charAt(0).toUpperCase()}
            </div>
          </div>
          <div>
            <h1 className="text-base font-serif font-semibold text-white">{tenant.name}</h1>
            <p className="text-[10px] text-slate-400 uppercase tracking-wider">Interactive Showroom</p>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {images.length === 0 && (
          <div className="text-center py-16 space-y-2">
            <p className="text-sm text-slate-400">This vendor hasn't published a showroom image yet.</p>
          </div>
        )}

        {images.length > 1 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {images.map((img) => (
              <button
                key={img.id}
                type="button"
                onClick={() => handleSelectImage(img.id)}
                className={`whitespace-nowrap px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                  activeImageId === img.id
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : 'bg-white/[0.03] text-slate-400 hover:text-slate-200 border border-transparent'
                }`}
              >
                {img.name}
              </button>
            ))}
          </div>
        )}

        {activeImage && (
          <>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                <MapPin className="w-3.5 h-3.5 text-amber-400" />
                <span>Click a pin to try a different finish</span>
              </div>
              <HotspotImage
                imageUrl={renderedUrl || activeImage.imageUrl}
                hotspots={hotspotViewModels}
                renderPin={(hotspot) => (
                  <button
                    type="button"
                    onClick={() => handleHotspotClick(activeImage.hotspots.find((h) => h.id === hotspot.id)!)}
                    title={hotspot.label}
                    className={`w-7 h-7 rounded-full border-2 border-white/80 shadow-lg flex items-center justify-center transition-transform hover:scale-110 ${
                      activeHotspot?.id === hotspot.id ? 'bg-amber-400 text-slate-950' : 'bg-black/70 text-amber-300 animate-pulse'
                    }`}
                  >
                    <MapPin className="w-3.5 h-3.5" />
                  </button>
                )}
              />
            </div>

            {applying && (
              <div className="flex items-center gap-2 text-[11px] text-amber-300">
                <Wand2 className="w-4 h-4 animate-spin" />
                <span>Applying {selectedMaterial?.name}...</span>
              </div>
            )}

            {applyError && <p className="text-[11px] text-rose-300">{applyError}</p>}

            {renderedUrl && !applying && (
              <button
                type="button"
                onClick={resetSelection}
                className="flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-slate-200 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset preview
              </button>
            )}

            {activeHotspot && (
              <HotspotMaterialPicker
                hotspot={activeHotspot}
                materials={materials}
                selectedMaterialId={selectedMaterial?.id}
                onSelectMaterial={handleSelectMaterial}
                onClose={() => setActiveHotspot(null)}
              />
            )}
          </>
        )}
      </main>

      <footer className="border-t border-white/[0.06] py-6 px-6 text-center text-slate-600 text-[10px] font-sans">
        Powered by Material Visualizer
      </footer>
    </div>
  );
};
