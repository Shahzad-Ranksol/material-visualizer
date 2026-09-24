import React from 'react';
import { RepeatMode } from '../types';
import { MaterialProfileInput } from '../services/apiClient';
import { defaultProfileFor } from '../services/materialProfile';

interface MaterialScaleEditorProps {
  category: string;
  value: MaterialProfileInput;
  onChange: (value: MaterialProfileInput) => void;
  inputClassName: string;
}

const REPEAT_OPTIONS: Array<{ value: RepeatMode; label: string; hint: string }> = [
  { value: 'sheet', label: 'Sheet / panel', hint: 'The photo shows one whole sheet; sheets are laid side by side with joints.' },
  { value: 'tile', label: 'Tile', hint: 'The photo shows one tile; tiles are laid in a grid with grout.' },
  { value: 'plank', label: 'Plank', hint: 'The photo shows one plank; rows are staggered.' },
  { value: 'seamless', label: 'Continuous', hint: 'The photo is a sample of a continuous surface (wallpaper, carpet, paint, stone).' },
  { value: 'bookmatch', label: 'Book-matched', hint: 'Slabs/veneers mirrored in pairs, as book-matched stone is installed.' },
  { value: 'none', label: 'Single piece', hint: 'Shown once at its real size, not repeated.' },
];

const FINISHES = [
  { label: 'Matte', roughness: 0.8 },
  { label: 'Satin', roughness: 0.4 },
  { label: 'Gloss', roughness: 0.15 },
];

/**
 * The material's physical profile: the real size its photo represents and how it repeats.
 * Renders use these values for scale, layout and joints — never the photo's pixel size.
 */
export const MaterialScaleEditor: React.FC<MaterialScaleEditorProps> = ({ category, value, onChange, inputClassName }) => {
  const d = defaultProfileFor(category);
  const v = {
    realWidthMm: value.realWidthMm ?? d.realWidthMm,
    realHeightMm: value.realHeightMm !== undefined ? value.realHeightMm : d.realHeightMm,
    repeatMode: value.repeatMode ?? d.repeatMode,
    orientationDeg: value.orientationDeg ?? d.orientationDeg,
    jointWidthMm: value.jointWidthMm !== undefined ? value.jointWidthMm : d.jointWidthMm,
    jointColor: value.jointColor !== undefined ? value.jointColor : d.jointColor,
    roughness: value.roughness ?? d.roughness,
  };
  const set = (patch: MaterialProfileInput) => onChange({ ...value, ...patch });
  const jointed = v.repeatMode === 'sheet' || v.repeatMode === 'tile' || v.repeatMode === 'plank';
  const mmInput = (mm: number | null, onMm: (mm: number | null) => void, placeholder?: string) => (
    <input
      type="number"
      min={1}
      step={1}
      value={mm ?? ''}
      placeholder={placeholder}
      onChange={(e) => onMm(e.target.value === '' ? null : Math.max(1, Number(e.target.value)))}
      className={`w-20 ${inputClassName}`}
    />
  );

  return (
    <div className="space-y-2 p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.06]">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Real size &amp; layout</span>

      <label className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
        Photo shows
        {mmInput(v.realWidthMm, (mm) => set({ realWidthMm: mm ?? d.realWidthMm }))}
        ×
        {mmInput(v.realHeightMm, (mm) => set({ realHeightMm: mm }), 'auto')}
        mm
      </label>
      <p className="text-[10px] text-slate-500 -mt-1">Width × height of real material in the photo (leave height empty to keep the photo's proportions).</p>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] text-slate-400 space-y-1">
          <span className="block">Laid as</span>
          <select
            value={v.repeatMode}
            onChange={(e) => set({ repeatMode: e.target.value as RepeatMode })}
            className={`w-full ${inputClassName}`}
          >
            {REPEAT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[11px] text-slate-400 space-y-1">
          <span className="block">Grain direction</span>
          <select
            value={v.orientationDeg}
            onChange={(e) => set({ orientationDeg: Number(e.target.value) as 0 | 90 | 180 | 270 })}
            className={`w-full ${inputClassName}`}
          >
            <option value={0}>As photographed</option>
            <option value={90}>Rotated 90°</option>
            <option value={180}>Rotated 180°</option>
            <option value={270}>Rotated 270°</option>
          </select>
        </label>
      </div>
      <p className="text-[10px] text-slate-500 -mt-1">{REPEAT_OPTIONS.find((o) => o.value === v.repeatMode)?.hint}</p>

      {jointed && (
        <label className="flex items-center gap-2 text-[11px] text-slate-400">
          Joint
          {mmInput(v.jointWidthMm, (mm) => set({ jointWidthMm: mm }), '0')}
          mm
          <input
            type="color"
            value={v.jointColor ?? '#2a2a2a'}
            onChange={(e) => set({ jointColor: e.target.value })}
            className="w-7 h-6 rounded bg-transparent border border-white/[0.1]"
            title="Joint / grout colour"
          />
        </label>
      )}

      <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
        Finish
        {FINISHES.map((f) => (
          <button
            key={f.label}
            type="button"
            onClick={() => set({ roughness: f.roughness })}
            className={`px-2 py-0.5 rounded-md border text-[10px] transition-colors ${
              Math.abs(v.roughness - f.roughness) < 0.08
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                : 'text-slate-400 border-white/[0.08] hover:text-slate-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  );
};
