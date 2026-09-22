import React, { useState } from 'react';
import { DetectedItem } from '../types';
import { Check, Plus, Layers, Sparkles } from 'lucide-react';

interface DetectedItemsProps {
  items: DetectedItem[];
  selectedItemIds: Set<string>;
  onItemSelect: (itemId: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  onAddCustomItem: (name: string, category: DetectedItem['category']) => void;
}

export const DetectedItems: React.FC<DetectedItemsProps> = ({
  items,
  selectedItemIds,
  onItemSelect,
  onSelectAll,
  onClearAll,
  onAddCustomItem,
}) => {
  const [showAddInput, setShowAddInput] = useState(false);
  const [customItemName, setCustomItemName] = useState('');

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customItemName.trim()) return;
    onAddCustomItem(customItemName.trim(), 'Surfaces & Walls');
    setCustomItemName('');
    setShowAddInput(false);
  };

  const allSelected = items.length > 0 && selectedItemIds.size === items.length;

  return (
    <div className="space-y-3.5">
      {/* Quick Action bar */}
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span className="text-[11px] font-medium text-slate-300 flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-amber-400" />
          <span>{items.length} Target Element{items.length === 1 ? '' : 's'}</span>
        </span>

        <div className="flex items-center gap-2 text-[11px]">
          <button
            type="button"
            onClick={allSelected ? onClearAll : onSelectAll}
            className="text-amber-400 hover:text-amber-300 font-medium transition-colors"
          >
            {allSelected ? 'Deselect All' : 'Select All'}
          </button>
          <span className="text-white/20">•</span>
          <button
            type="button"
            onClick={() => setShowAddInput(!showAddInput)}
            className="text-slate-400 hover:text-slate-200 transition-colors flex items-center gap-1"
          >
            <Plus className="w-3 h-3" />
            <span>Add Custom</span>
          </button>
        </div>
      </div>

      {/* Add custom element input */}
      {showAddInput && (
        <form onSubmit={handleAddSubmit} className="flex gap-2 p-2 rounded-xl bg-[#14161f] border border-amber-500/30 animate-in fade-in">
          <input
            type="text"
            value={customItemName}
            onChange={(e) => setCustomItemName(e.target.value)}
            placeholder="e.g. Fireplace Hearth, Archway..."
            className="flex-1 bg-transparent px-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none"
            autoFocus
          />
          <button
            type="submit"
            className="px-3 py-1 rounded-lg bg-amber-500 text-slate-950 text-xs font-semibold hover:bg-amber-400 transition-colors"
          >
            Add
          </button>
        </form>
      )}

      {/* Elements list */}
      <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1 custom-scrollbar">
        {items.map((item) => {
          const isSelected = selectedItemIds.has(item.id);
          return (
            <button
              key={item.id}
              type="button"
              id={`detected-item-${item.id}`}
              onClick={() => onItemSelect(item.id)}
              className={`w-full text-left p-2.5 rounded-xl border transition-all duration-200 flex items-center justify-between group ${
                isSelected
                  ? 'bg-amber-500/[0.08] border-amber-500/40 text-amber-200 shadow-sm'
                  : 'bg-[#12141c] border-white/[0.06] text-slate-300 hover:border-white/20 hover:text-slate-100'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0 pr-2">
                <div className={`w-4 h-4 rounded flex items-center justify-center shrink-0 transition-colors ${
                  isSelected ? 'bg-amber-400 text-slate-950' : 'border border-white/20 group-hover:border-white/40'
                }`}>
                  {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                </div>

                <div className="truncate">
                  <span className="text-xs font-medium block truncate">
                    {item.name}
                  </span>
                  {item.category && (
                    <span className="text-[10px] text-slate-500 block">
                      {item.category}
                    </span>
                  )}
                </div>
              </div>

              {item.confidence && (
                <span className="text-[10px] text-slate-500 font-mono shrink-0">
                  {item.confidence}%
                </span>
              )}
            </button>
          );
        })}
      </div>

      {selectedItemIds.size === 0 && (
        <p className="text-[11px] text-amber-400/80 bg-amber-500/[0.06] border border-amber-500/20 rounded-lg p-2 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 shrink-0 text-amber-400" />
          <span>Click at least one element above to apply textures to.</span>
        </p>
      )}
    </div>
  );
};
