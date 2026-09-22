import React, { useState } from 'react';
import { X, MapPin, Trash2, Loader2, AlertCircle, Plus } from 'lucide-react';
import { RemoteShowcaseImage, RemoteHotspot, NewShowcaseImageInput, NewHotspotInput } from '../services/apiClient';
import { HotspotImage, HotspotViewModel } from './HotspotImage';

const CATEGORY_OPTIONS = ['tile', 'sheet', 'carpet', 'wallpaper', 'paint', 'stone', 'wood', 'plaster', 'metal', 'fabric'];

type PendingForm =
  | { mode: 'create'; xPct: number; yPct: number }
  | { mode: 'edit'; hotspot: RemoteHotspot }
  | null;

interface ShowcaseEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  images: RemoteShowcaseImage[] | null;
  imagesError: string | null;
  storefrontSlug?: string;
  addImageLoading: boolean;
  addImageError: string | null;
  onAddImage: (input: NewShowcaseImageInput) => void;
  onDeleteImage: (id: string) => void;
  hotspotLoading: boolean;
  hotspotError: string | null;
  onCreateHotspot: (imageId: string, input: NewHotspotInput) => void;
  onUpdateHotspot: (id: string, input: NewHotspotInput) => void;
  onDeleteHotspot: (id: string) => void;
}

export const ShowcaseEditorModal: React.FC<ShowcaseEditorModalProps> = ({
  isOpen,
  onClose,
  images,
  imagesError,
  storefrontSlug,
  addImageLoading,
  addImageError,
  onAddImage,
  onDeleteImage,
  hotspotLoading,
  hotspotError,
  onCreateHotspot,
  onUpdateHotspot,
  onDeleteHotspot,
}) => {
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [newImageName, setNewImageName] = useState('');
  const [newImageUrl, setNewImageUrl] = useState('');
  const [pendingForm, setPendingForm] = useState<PendingForm>(null);
  const [formLabel, setFormLabel] = useState('');
  const [formCategories, setFormCategories] = useState<Set<string>>(new Set());

  if (!isOpen) return null;

  const selectedImage = images?.find((img) => img.id === selectedImageId) || null;

  const handleAddImage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newImageName.trim() || !newImageUrl.trim()) return;
    onAddImage({ name: newImageName.trim(), imageUrl: newImageUrl.trim() });
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

  const startCreateHotspot = (xPct: number, yPct: number) => {
    setPendingForm({ mode: 'create', xPct, yPct });
    setFormLabel('');
    setFormCategories(new Set());
  };

  const startEditHotspot = (hotspot: RemoteHotspot) => {
    setPendingForm({ mode: 'edit', hotspot });
    setFormLabel(hotspot.label);
    setFormCategories(new Set(hotspot.allowedCategories));
  };

  const cancelForm = () => setPendingForm(null);

  const submitForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingForm || !formLabel.trim() || formCategories.size === 0) return;
    const allowedCategories = Array.from(formCategories);
    if (pendingForm.mode === 'create' && selectedImage) {
      onCreateHotspot(selectedImage.id, { label: formLabel.trim(), xPct: pendingForm.xPct, yPct: pendingForm.yPct, allowedCategories });
    } else if (pendingForm.mode === 'edit') {
      // Look up the latest position rather than trusting the snapshot captured when the
      // form opened, in case the pin was dragged to a new spot while the form was open.
      const latest = selectedImage?.hotspots.find((h) => h.id === pendingForm.hotspot.id) || pendingForm.hotspot;
      onUpdateHotspot(pendingForm.hotspot.id, {
        label: formLabel.trim(),
        xPct: latest.xPct,
        yPct: latest.yPct,
        allowedCategories,
      });
    }
    setPendingForm(null);
  };

  const handleHotspotDragEnd = (hotspotId: string, xPct: number, yPct: number) => {
    const hotspot = selectedImage?.hotspots.find((h) => h.id === hotspotId);
    if (!hotspot) return;
    onUpdateHotspot(hotspotId, { label: hotspot.label, xPct, yPct, allowedCategories: hotspot.allowedCategories });
  };

  const hotspotViewModels: HotspotViewModel[] = (selectedImage?.hotspots || []).map((h) => ({
    id: h.id,
    label: h.label,
    xPct: h.xPct,
    yPct: h.yPct,
  }));

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
      <div className="relative w-full max-w-3xl bg-[#14161f] border border-white/[0.1] rounded-2xl shadow-2xl overflow-hidden my-8">
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

        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6 max-h-[75vh] overflow-y-auto custom-scrollbar">
          {/* Left: image list + add form */}
          <div className="space-y-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Showcase Images</span>

            {imagesError && <p className="text-[11px] text-rose-300">{imagesError}</p>}

            <div className="space-y-2">
              {(images || []).map((img) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => setSelectedImageId(img.id)}
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
                  <span
                    role="button"
                    tabIndex={0}
                    title="Delete image"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (selectedImageId === img.id) setSelectedImageId(null);
                      onDeleteImage(img.id);
                    }}
                    className="w-6 h-6 rounded-full bg-black/40 hover:bg-rose-500/80 flex items-center justify-center text-slate-400 hover:text-white transition-colors shrink-0"
                  >
                    <Trash2 className="w-3 h-3" />
                  </span>
                </button>
              ))}
              {images && images.length === 0 && (
                <p className="text-[11px] text-slate-500">No showcase images yet — add one below.</p>
              )}
            </div>

            <form onSubmit={handleAddImage} className="p-3 rounded-xl bg-[#0d0e14] border border-white/[0.08] space-y-2">
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
              <button
                type="submit"
                disabled={addImageLoading}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-xs font-semibold disabled:opacity-60 transition-colors"
              >
                {addImageLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <Plus className="w-3.5 h-3.5" />
                Add Image
              </button>
            </form>
          </div>

          {/* Right: selected image + hotspots */}
          <div className="space-y-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Hotspots</span>
            {!selectedImage ? (
              <p className="text-[11px] text-slate-500">Select or add an image on the left, then click on it to drop a hotspot.</p>
            ) : (
              <>
                <HotspotImage
                  imageUrl={selectedImage.imageUrl}
                  hotspots={hotspotViewModels}
                  onImageClick={startCreateHotspot}
                  onHotspotDragEnd={handleHotspotDragEnd}
                  renderPin={(hotspot) => {
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
                <p className="text-[10px] text-slate-500">Click anywhere on the image to drop a new hotspot, or drag an existing pin to reposition it.</p>

                {pendingForm && (
                  <form onSubmit={submitForm} className="p-3 rounded-xl bg-[#0d0e14] border border-amber-500/30 space-y-2">
                    <input
                      type="text"
                      value={formLabel}
                      onChange={(e) => setFormLabel(e.target.value)}
                      placeholder="Zone label — e.g. Living Room Floor"
                      autoFocus
                      className="w-full bg-[#12141a] border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-400"
                    />
                    <p className="text-[10px] text-slate-500">
                      Include a word like floor, wall, island, cabinet, table, or desk so the render targets the right area.
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {CATEGORY_OPTIONS.map((cat) => (
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
                    {hotspotError && (
                      <div className="flex items-start gap-1.5 text-[11px] text-rose-300">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>{hotspotError}</span>
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
                        disabled={hotspotLoading || !formLabel.trim() || formCategories.size === 0}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600 text-slate-950 text-xs font-semibold disabled:opacity-60 hover:brightness-110 transition-all"
                      >
                        {hotspotLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
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
  );
};
