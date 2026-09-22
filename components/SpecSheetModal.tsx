import React, { useState } from 'react';
import { Material, RoomType, DetectedItem } from '../types';
import { X, Check, Copy, Printer, FileText } from 'lucide-react';

interface SpecSheetModalProps {
  isOpen: boolean;
  onClose: () => void;
  roomType: RoomType;
  roomTitle?: string;
  selectedItems: DetectedItem[];
  selectedMaterial: Material | null;
  previewImageUrl: string | null;
  customDirective?: string;
}

export const SpecSheetModal: React.FC<SpecSheetModalProps> = ({
  isOpen,
  onClose,
  roomType,
  roomTitle,
  selectedItems,
  selectedMaterial,
  previewImageUrl,
  customDirective,
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const specContent = `MATERIAL VISUALIZER • INTERIOR SPECIFICATION SCHEDULE
======================================================
Date: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
Project: ${roomTitle || `${roomType} Concept Design`}
Spatial Zone: ${roomType}

1. TARGET ARCHITECTURAL ELEMENTS:
${selectedItems.map((item, index) => `   ${index + 1}. ${item.name} (${item.category || 'General'}) - ${item.description || 'Specified surface'}`).join('\n')}

2. SPECIFIED MATERIAL & FINISH:
   • Material Name: ${selectedMaterial?.name || 'None specified'}
   • Finish Category: ${selectedMaterial?.category.toUpperCase() || 'N/A'}
   • Texture / Sheen: ${selectedMaterial?.finishType || 'N/A'}
   • Color Tone: ${selectedMaterial?.colorTone || 'N/A'}
   • Material Description: ${selectedMaterial?.description || 'N/A'}

3. DESIGN DIRECTIVE / ARTISAN NOTES:
   ${customDirective || 'Ensure seamless bookmatching or continuous grain flow. Coordinate with site lighting and adjacent reveal joints.'}

======================================================
Generated via Material Visualizer Architectural Studio`;

  const handleCopy = () => {
    navigator.clipboard.writeText(specContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-[#14161f] border border-white/[0.1] rounded-2xl shadow-2xl overflow-hidden my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] bg-[#171a24]">
          <div className="flex items-center gap-2.5">
            <FileText className="w-5 h-5 text-amber-400" />
            <div>
              <h3 className="text-sm font-semibold text-white">
                Material Specification Schedule
              </h3>
              <p className="text-[10px] text-slate-400">
                Architectural Finish & Procurement Spec
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto custom-scrollbar">
          {/* Visual preview strip */}
          {previewImageUrl && (
            <div className="rounded-xl overflow-hidden border border-white/[0.08] aspect-[16/8] bg-black">
              <img
                src={previewImageUrl}
                alt="Render Concept"
                className="w-full h-full object-cover"
              />
            </div>
          )}

          {/* Key Specs Card */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-[#10121a] border border-white/[0.06] space-y-2">
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500">
                Space & Zone
              </span>
              <p className="text-sm font-medium text-slate-200">
                {roomTitle || `${roomType} Concept`}
              </p>
              <p className="text-xs text-slate-400">
                Type: {roomType}
              </p>
            </div>

            <div className="p-4 rounded-xl bg-[#10121a] border border-amber-500/20 space-y-2">
              <span className="text-[10px] uppercase font-bold tracking-wider text-amber-400">
                Specified Finish
              </span>
              <p className="text-sm font-medium text-amber-300">
                {selectedMaterial?.name || 'No material selected'}
              </p>
              <p className="text-xs text-slate-400">
                {selectedMaterial?.finishType} • {selectedMaterial?.colorTone}
              </p>
            </div>
          </div>

          {/* Selected Elements */}
          <div className="space-y-2">
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500">
              Target Surfaces & Objects ({selectedItems.length})
            </span>
            <div className="divide-y divide-white/[0.04] rounded-xl border border-white/[0.06] bg-[#10121a] overflow-hidden">
              {selectedItems.map((item) => (
                <div key={item.id} className="p-3 flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-200">{item.name}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-white/[0.05] text-slate-400">
                    {item.category || 'Surface'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Raw Text Spec Box */}
          <div className="space-y-1.5">
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500">
              Procurement Schedule Export
            </span>
            <pre className="p-3.5 rounded-xl bg-black/60 border border-white/[0.06] text-[11px] font-mono text-slate-300 whitespace-pre-wrap leading-relaxed select-all">
              {specContent}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/[0.08] bg-[#171a24]">
          <span className="text-[11px] text-slate-500">
            Ready for client presentation & contractor RFQ
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-xs font-medium text-slate-200 transition-colors"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print</span>
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 text-slate-950 text-xs font-semibold hover:bg-amber-400 transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy Schedule'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
