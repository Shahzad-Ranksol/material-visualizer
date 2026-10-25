import React from 'react';
import { StudioMaterial } from '../../scenes/types';

interface Props {
  // Names of the selected items, for the heading
  selectedLabels: string[];
  materials: StudioMaterial[];
  // The finish every selected item shares, if they all have the same one
  activeId: string | null;
  onApply: (materialId: string) => void;
}

/** Finishes for the selected items as raised sample chips (the punched chips of a showroom sample fan). */
export const FinishPanel: React.FC<Props> = ({ selectedLabels, materials, activeId, onApply }) => {
  if (!selectedLabels.length) {
    return (
      <div className="rounded-2xl border border-dashed border-white/15 p-6 text-sm text-[#a39e94]">
        <p className="mb-1 text-base font-semibold text-[#f4efe6]">Pick something to re-finish</p>
        Click a cabinet, worktop or wall in the picture, or choose it below. Hold Shift to pick several.
      </div>
    );
  }
  const heading = selectedLabels.length === 1 ? selectedLabels[0] : `${selectedLabels.length} items`;
  return (
    <div>
      <h2 className="text-2xl font-semibold leading-tight tracking-tight text-[#f4efe6]">{heading}</h2>
      <p className="mt-1 text-sm text-[#a39e94]">
        {selectedLabels.length > 1 ? `${selectedLabels.join(', ')} — ` : ''}
        {materials.length ? 'choose a finish' : 'these items take different finishes. Pick them one at a time.'}
      </p>
      <div className="mt-5 grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-4 lg:grid-cols-3">
        {materials.map((m) => {
          const active = m.id === activeId;
          return (
            <button
              key={m.id}
              type="button"
              data-testid="finish-chip"
              data-material={m.id}
              aria-pressed={active}
              onClick={() => onApply(m.id)}
              className="group text-left focus:outline-none"
            >
              <span
                className={`relative block aspect-[4/5] overflow-hidden rounded-xl bg-cover bg-center shadow-[0_10px_24px_-10px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.25)] transition duration-200 group-hover:-translate-y-1 group-hover:shadow-[0_18px_30px_-12px_rgba(0,0,0,0.9)] group-focus-visible:ring-2 group-focus-visible:ring-[#f4efe6] ${
                  active ? 'ring-2 ring-[#d9b77a] ring-offset-2 ring-offset-[#1c1915] shadow-[0_0_28px_-4px_rgba(217,183,122,0.6)]' : 'ring-1 ring-white/10'
                }`}
                style={{ backgroundImage: `url(${m.thumbnail})` }}
              >
                {/* Sheen, and the chip's punched hole */}
                <span className="absolute inset-0 bg-gradient-to-br from-white/20 via-transparent to-black/25" />
                <span className="absolute left-1/2 top-2 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-[#1c1915] shadow-[inset_0_1px_2px_rgba(0,0,0,0.8)]" />
                {m.tag && (
                  <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[9px] font-semibold text-[#f4efe6] backdrop-blur-sm">
                    {m.tag}
                  </span>
                )}
              </span>
              <span className={`mt-2 block text-[13px] font-semibold leading-snug ${active ? 'text-[#e6c88f]' : 'text-[#f4efe6]'}`}>{m.name}</span>
              <span className="block text-[11px] text-[#a39e94]">{m.finishType}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
