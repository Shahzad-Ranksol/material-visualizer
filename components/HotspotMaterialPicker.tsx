import React from 'react';
import { Check, X } from 'lucide-react';
import { Material } from '../types';
import { RemoteHotspot } from '../services/apiClient';

interface HotspotMaterialPickerProps {
  hotspot: RemoteHotspot;
  materials: Material[];
  selectedMaterialId?: string;
  onSelectMaterial: (material: Material) => void;
  onClose: () => void;
}

export const HotspotMaterialPicker: React.FC<HotspotMaterialPickerProps> = ({
  hotspot,
  materials,
  selectedMaterialId,
  onSelectMaterial,
  onClose,
}) => {
  const filtered = materials.filter((m) => hotspot.allowedCategories.includes(m.category));

  return (
    <div className="p-4 rounded-2xl bg-[#12141c] border border-white/[0.08] shadow-xl space-y-3 animate-in fade-in">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-slate-200">
          Choose a finish for: <span className="text-amber-300">{hotspot.label}</span>
        </h3>
        <button type="button" onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="text-[11px] text-slate-500">This vendor hasn't added any materials for this zone yet.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[320px] overflow-y-auto pr-1 custom-scrollbar">
          {filtered.map((material) => {
            const isSelected = selectedMaterialId === material.id;
            return (
              <button
                key={material.id}
                type="button"
                onClick={() => onSelectMaterial(material)}
                className={`group relative text-left rounded-xl overflow-hidden border transition-all duration-300 flex flex-col bg-[#14161f] ${
                  isSelected
                    ? 'border-amber-400/80 ring-2 ring-amber-400/20 shadow-lg shadow-amber-500/5 -translate-y-0.5'
                    : 'border-white/[0.08] hover:border-white/20 hover:-translate-y-0.5'
                }`}
              >
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-slate-900">
                  <img
                    src={material.thumbnail}
                    alt={material.name}
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                    loading="lazy"
                  />
                  {isSelected && (
                    <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-amber-400 text-slate-950 flex items-center justify-center shadow-md">
                      <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                    </div>
                  )}
                </div>
                <div className="p-2.5">
                  <h4 className={`text-[11px] font-semibold tracking-tight line-clamp-1 ${isSelected ? 'text-amber-300' : 'text-slate-200'}`}>
                    {material.name}
                  </h4>
                  <p className="text-[10px] text-slate-500 line-clamp-1">{material.finishType}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
