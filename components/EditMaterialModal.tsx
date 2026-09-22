import React, { useState, useEffect } from 'react';
import { X, Pencil, Loader2, AlertCircle } from 'lucide-react';
import { Material } from '../types';
import { NewMaterialInput } from '../services/apiClient';

interface EditMaterialModalProps {
  material: Material | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (id: string, input: NewMaterialInput) => void;
}

export const EditMaterialModal: React.FC<EditMaterialModalProps> = ({
  material,
  loading,
  error,
  onClose,
  onSave,
}) => {
  const [form, setForm] = useState<NewMaterialInput | null>(null);

  useEffect(() => {
    if (material) {
      setForm({
        name: material.name,
        category: material.category,
        description: material.description,
        thumbnail: material.thumbnail,
        finishType: material.finishType,
        colorTone: material.colorTone,
      });
    } else {
      setForm(null);
    }
  }, [material]);

  if (!material || !form) return null;

  const update = (field: keyof NewMaterialInput) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => setForm((prev) => (prev ? { ...prev, [field]: e.target.value } : prev));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (form) onSave(material.id, form);
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
      <div className="relative w-full max-w-md bg-[#14161f] border border-white/[0.1] rounded-2xl shadow-2xl overflow-hidden my-8">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] bg-[#171a24]">
          <div className="flex items-center gap-2.5">
            <Pencil className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-semibold text-white">Edit Material</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-3">
          <input
            type="text"
            value={form.name}
            onChange={update('name')}
            placeholder="Name"
            required
            className="w-full bg-[#0d0e14] border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-400 transition-colors"
          />

          <p className="text-[11px] text-slate-400">
            Category: <span className="text-amber-300 font-medium">{form.category}</span>
          </p>

          <input
            type="url"
            value={form.thumbnail}
            onChange={update('thumbnail')}
            placeholder="Thumbnail image URL"
            required
            className="w-full bg-[#0d0e14] border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-400 transition-colors"
          />

          <div className="grid grid-cols-2 gap-3">
            <input
              type="text"
              value={form.finishType}
              onChange={update('finishType')}
              placeholder="Finish type"
              required
              className="w-full bg-[#0d0e14] border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-400 transition-colors"
            />
            <input
              type="text"
              value={form.colorTone}
              onChange={update('colorTone')}
              placeholder="Color tone"
              required
              className="w-full bg-[#0d0e14] border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-400 transition-colors"
            />
          </div>

          <textarea
            value={form.description}
            onChange={update('description')}
            placeholder="Short description"
            required
            rows={3}
            className="w-full bg-[#0d0e14] border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-400 transition-colors resize-none"
          />

          {error && (
            <div className="flex items-start gap-1.5 text-[11px] text-rose-300">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.09] border border-white/[0.08] text-xs font-medium text-slate-300 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600 text-slate-950 text-xs font-semibold disabled:opacity-60 hover:brightness-110 transition-all"
            >
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
