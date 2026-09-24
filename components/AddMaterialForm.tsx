import React, { useState } from 'react';
import { Plus, X, Loader2, AlertCircle } from 'lucide-react';
import { NewMaterialInput } from '../services/apiClient';
import { MaterialImageInput } from './MaterialImageInput';

import { MaterialScaleEditor } from './MaterialScaleEditor';

interface AddMaterialFormProps {
  lockedCategory: string;
  loading: boolean;
  error: string | null;
  onSubmit: (input: NewMaterialInput) => Promise<boolean>;
  onUploadImage: (file: Blob) => Promise<string>;
}

export const AddMaterialForm: React.FC<AddMaterialFormProps> = ({ lockedCategory, loading, error, onSubmit, onUploadImage }) => {
  const [open, setOpen] = useState(false);
  const emptyForm: NewMaterialInput = {
    name: '',
    category: lockedCategory,
    description: '',
    thumbnail: '',
    finishType: '',
    colorTone: '',
  };
  const [form, setForm] = useState<NewMaterialInput>(emptyForm);
  const [imageMissing, setImageMissing] = useState(false);

  const update = (field: keyof NewMaterialInput) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.thumbnail) {
      setImageMissing(true);
      return;
    }
    const success = await onSubmit({ ...form, category: lockedCategory });
    if (success) {
      setForm(emptyForm);
      setOpen(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.03] hover:bg-white/[0.07] border border-dashed border-white/[0.15] text-[11px] font-medium text-slate-400 hover:text-slate-200 transition-colors"
      >
        <Plus className="w-3.5 h-3.5" />
        Add Your Own Material
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="p-3.5 rounded-xl bg-[#0d0e14] border border-white/[0.08] space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">New Material</span>
        <button type="button" onClick={() => setOpen(false)} className="text-slate-500 hover:text-slate-300">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <input
        type="text"
        value={form.name}
        onChange={update('name')}
        placeholder="Name (e.g. Oceanic Slate Sheet Vinyl)"
        required
        className="w-full bg-[#12141a] border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-400"
      />

      <p className="text-[11px] text-slate-400">
        Category: <span className="text-amber-300 font-medium">{lockedCategory}</span>
      </p>

      <MaterialImageInput
        onUpload={onUploadImage}
        value={form.thumbnail}
        onChange={(thumbnail) => {
          setImageMissing(false);
          setForm((prev) => ({ ...prev, thumbnail }));
        }}
        inputClassName="w-full bg-[#12141a] border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-400"
      />
      {imageMissing && <p className="text-[11px] text-rose-300">Please upload an image or paste an image URL.</p>}

      <div className="grid grid-cols-2 gap-2">
        <input
          type="text"
          value={form.finishType}
          onChange={update('finishType')}
          placeholder="Finish (matte, satin, gloss…)"
          required
          className="w-full bg-[#12141a] border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-400"
        />
        <input
          type="text"
          value={form.colorTone}
          onChange={update('colorTone')}
          placeholder="Color tone"
          required
          className="w-full bg-[#12141a] border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-400"
        />
      </div>

      <MaterialScaleEditor
        category={lockedCategory}
        value={form}
        onChange={(profile) => setForm((prev) => ({ ...prev, ...profile }))}
        inputClassName="bg-[#12141a] border border-white/[0.08] rounded-lg px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-amber-400"
      />

      <textarea
        value={form.description}
        onChange={update('description')}
        placeholder="Short description"
        required
        rows={2}
        className="w-full bg-[#12141a] border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-400 resize-none"
      />

      {error && (
        <div className="flex items-start gap-1.5 text-[11px] text-rose-300">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-xs font-semibold disabled:opacity-60 transition-colors"
      >
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        Add to Catalog
      </button>
    </form>
  );
};
