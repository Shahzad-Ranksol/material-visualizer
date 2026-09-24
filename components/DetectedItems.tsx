import React from 'react';
import { DetectedItem } from '../types';
import { Check, Layers, Sparkles, Loader2, AlertTriangle } from 'lucide-react';

interface DetectedItemsProps {
  items: DetectedItem[];
  selectedItemIds: Set<string>;
  onItemSelect: (itemId: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  // Room analysis in progress (first run also downloads the local AI models)
  analyzing?: boolean;
  // Current analysis step, e.g. "Estimating 3D geometry…"
  progressLabel?: string | null;
  analysisError?: string | null;
  warnings?: string[];
  // Opens the area check for a flagged surface
  onReviewItem?: (item: DetectedItem) => void;
}

// Surfaces come only from room analysis (or a vendor's saved surfaces) — a typed label is not
// geometry, so there is deliberately no free-text "add custom target" here.
export const DetectedItems: React.FC<DetectedItemsProps> = ({
  items,
  selectedItemIds,
  onItemSelect,
  onSelectAll,
  onClearAll,
  analyzing,
  progressLabel,
  analysisError,
  warnings = [],
  onReviewItem,
}) => {
  const allSelected = items.length > 0 && selectedItemIds.size === items.length;

  return (
    <div className="space-y-3.5">
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span className="text-[11px] font-medium text-slate-300 flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-amber-400" />
          <span>{items.length} Detected Surface{items.length === 1 ? '' : 's'}</span>
        </span>
        {items.length > 0 && (
          <button
            type="button"
            onClick={allSelected ? onClearAll : onSelectAll}
            className="text-[11px] text-amber-400 hover:text-amber-300 font-medium transition-colors"
          >
            {allSelected ? 'Deselect All' : 'Select All'}
          </button>
        )}
      </div>

      {analyzing && (
        <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          {progressLabel ?? 'Analyzing the room…'} (the first photo also loads the local AI models)
        </p>
      )}
      {analysisError && <p className="text-[11px] text-rose-300">{analysisError}</p>}
      {warnings.map((w) => (
        <p key={w} className="flex items-start gap-1.5 text-[10px] text-amber-300/80">
          <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
          {w}
        </p>
      ))}

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
                  <span className="text-xs font-medium block truncate">{item.name}</span>
                  {item.category && <span className="text-[10px] text-slate-500 block">{item.category}</span>}
                </div>
              </div>
              <span className="flex items-center gap-1.5 shrink-0">
                {item.needsReview && (
                  <span
                    role="button"
                    tabIndex={0}
                    title="Low confidence — check and fix the area"
                    onClick={(e) => {
                      e.stopPropagation();
                      onReviewItem?.(item);
                    }}
                    className={`text-[9px] px-1.5 py-0.5 rounded cursor-pointer hover:brightness-125 ${
                      item.reviewDecision === 'correct' ? 'bg-rose-500/15 text-rose-300' : 'bg-amber-500/15 text-amber-300'
                    }`}
                  >
                    {item.reviewDecision === 'correct' ? 'fix' : 'check'}
                  </span>
                )}
                {item.confidence !== undefined && (
                  <span className="text-[10px] text-slate-500 font-mono">{Math.round(item.confidence)}%</span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {!analyzing && items.length > 0 && selectedItemIds.size === 0 && (
        <p className="text-[11px] text-amber-400/80 bg-amber-500/[0.06] border border-amber-500/20 rounded-lg p-2 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 shrink-0 text-amber-400" />
          <span>Select at least one surface to apply a material to.</span>
        </p>
      )}
    </div>
  );
};
