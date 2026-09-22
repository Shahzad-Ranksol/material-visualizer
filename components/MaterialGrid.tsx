import React, { useState, useMemo } from 'react';
import { Material, MaterialCategory } from '../types';
import { Check, Search, Sparkles, Trash2, Pencil } from 'lucide-react';

interface MaterialGridProps {
  materials: Material[];
  selectedMaterial: Material | null;
  onSelectMaterial: (material: Material) => void;
  currentTenantId?: string | null;
  onDeleteMaterial?: (materialId: string) => void;
  onEditMaterial?: (material: Material) => void;
}

export const MaterialGrid: React.FC<MaterialGridProps> = ({
  materials,
  selectedMaterial,
  onSelectMaterial,
  currentTenantId,
  onDeleteMaterial,
  onEditMaterial,
}) => {
  const [activeCategory, setActiveCategory] = useState<MaterialCategory>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const categories: Array<{ id: MaterialCategory; label: string }> = [
    { id: 'all', label: 'All Finishes' },
    { id: 'tile', label: 'Tile' },
    { id: 'sheet', label: 'Sheet Vinyl' },
    { id: 'carpet', label: 'Carpet' },
    { id: 'wallpaper', label: 'Wallpaper' },
    { id: 'paint', label: 'Paint' },
    { id: 'stone', label: 'Stone & Marble' },
    { id: 'wood', label: 'Wood & Millwork' },
    { id: 'plaster', label: 'Plaster & Concrete' },
    { id: 'metal', label: 'Metals' },
    { id: 'fabric', label: 'Textiles' },
  ];

  const filteredMaterials = useMemo(() => {
    return materials.filter((mat) => {
      const matchesCategory = activeCategory === 'all' || mat.category === activeCategory;
      const matchesSearch =
        searchQuery.trim() === '' ||
        mat.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        mat.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        mat.finishType.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [materials, activeCategory, searchQuery]);

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Category Filter Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none no-scrollbar">
        {categories.map((cat) => (
          <button
            key={cat.id}
            type="button"
            id={`filter-cat-${cat.id}`}
            onClick={() => setActiveCategory(cat.id)}
            className={`whitespace-nowrap px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
              activeCategory === cat.id
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                : 'bg-white/[0.03] text-slate-400 hover:text-slate-200 hover:bg-white/[0.06] border border-transparent'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Search Input */}
      <div className="relative">
        <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Filter materials (e.g. marble, oak, brass)..."
          className="w-full bg-[#12141a] border border-white/[0.08] rounded-xl pl-9 pr-4 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500/50 transition-colors"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 hover:text-slate-300"
          >
            &times;
          </button>
        )}
      </div>

      {/* Material Grid Swatches */}
      <div className="grid grid-cols-2 gap-3 max-h-[460px] overflow-y-auto pr-1 custom-scrollbar">
        {filteredMaterials.map((material) => {
          const isSelected = selectedMaterial?.id === material.id;
          return (
            <button
              key={material.id}
              type="button"
              id={`material-card-${material.id}`}
              onClick={() => onSelectMaterial(material)}
              className={`group relative text-left rounded-xl overflow-hidden border transition-all duration-300 flex flex-col bg-[#14161f] ${
                isSelected
                  ? 'border-amber-400/80 ring-2 ring-amber-400/20 shadow-lg shadow-amber-500/5 -translate-y-0.5'
                  : 'border-white/[0.08] hover:border-white/20 hover:-translate-y-0.5'
              }`}
            >
              {/* Swatch Image */}
              <div className="relative aspect-[4/3] w-full overflow-hidden bg-slate-900">
                <img
                  src={material.thumbnail}
                  alt={material.name}
                  className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#14161f] via-transparent to-transparent opacity-80" />

                {/* Selected Check Pill */}
                {isSelected && (
                  <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-amber-400 text-slate-950 flex items-center justify-center shadow-md animate-in zoom-in-75">
                    <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                  </div>
                )}

                {/* Category tag */}
                <div className="absolute top-2 left-2">
                  <span className="px-2 py-0.5 rounded bg-black/60 backdrop-blur text-[9px] font-semibold uppercase tracking-wider text-slate-300">
                    {material.category}
                  </span>
                </div>

                {/* Edit / Delete (own tenant's materials only) */}
                {currentTenantId && material.tenantId === currentTenantId && (
                  <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
                    {onEditMaterial && (
                      <span
                        role="button"
                        tabIndex={0}
                        title="Edit this material"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditMaterial(material);
                        }}
                        className="w-6 h-6 rounded-full bg-black/70 hover:bg-amber-500/80 backdrop-blur flex items-center justify-center text-slate-300 hover:text-slate-950 transition-colors"
                      >
                        <Pencil className="w-3 h-3" />
                      </span>
                    )}
                    {onDeleteMaterial && (
                      <span
                        role="button"
                        tabIndex={0}
                        title="Remove from your catalog"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteMaterial(material.id);
                        }}
                        className="w-6 h-6 rounded-full bg-black/70 hover:bg-rose-500/80 backdrop-blur flex items-center justify-center text-slate-300 hover:text-white transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Material Info */}
              <div className="p-3 flex-1 flex flex-col justify-between space-y-1">
                <div>
                  <h4 className={`text-xs font-semibold tracking-tight transition-colors line-clamp-1 ${
                    isSelected ? 'text-amber-300' : 'text-slate-200 group-hover:text-white'
                  }`}>
                    {material.name}
                  </h4>
                  <p className="text-[10px] text-slate-400 line-clamp-1">
                    {material.finishType}
                  </p>
                </div>

                <div className="pt-1 flex items-center justify-between border-t border-white/[0.04] text-[9px] text-slate-500">
                  <span className="truncate">{material.colorTone}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {filteredMaterials.length === 0 && (
        <div className="py-8 text-center text-slate-500 text-xs">
          No materials match &ldquo;{searchQuery}&rdquo;. Try another search term.
        </div>
      )}

      {/* Selected Material Summary Card */}
      {selectedMaterial && (
        <div className="p-3.5 rounded-xl bg-amber-500/[0.04] border border-amber-500/20 text-xs space-y-1.5 animate-in fade-in">
          <div className="flex items-center gap-1.5 text-amber-300 font-semibold text-[11px]">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Active Finish: {selectedMaterial.name}</span>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed font-sans">
            {selectedMaterial.description}
          </p>
        </div>
      )}
    </div>
  );
};
