import React, { useState } from 'react';
import { X, UploadCloud, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { NewMaterialInput } from '../services/apiClient';

const REQUIRED_FIELDS: Array<keyof NewMaterialInput> = [
  'name',
  'category',
  'description',
  'thumbnail',
  'finishType',
  'colorTone',
];

const EXAMPLE = `[
  {
    "name": "Slate Grey Sheet Vinyl",
    "category": "sheet",
    "description": "Waterproof roll flooring in a cool slate grey.",
    "thumbnail": "https://images.example.com/slate-grey.jpg",
    "finishType": "Matte Sheet",
    "colorTone": "Slate Grey"
  }
]`;

export interface BulkImportResultItem {
  name: string;
  ok: boolean;
  error?: string;
}

interface BulkImportModalProps {
  isOpen: boolean;
  loading: boolean;
  onClose: () => void;
  onImport: (items: NewMaterialInput[]) => Promise<BulkImportResultItem[]>;
}

export const BulkImportModal: React.FC<BulkImportModalProps> = ({ isOpen, loading, onClose, onImport }) => {
  const [raw, setRaw] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [results, setResults] = useState<BulkImportResultItem[] | null>(null);

  if (!isOpen) return null;

  const handleImport = async () => {
    setParseError(null);
    setResults(null);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      setParseError('That is not valid JSON.');
      return;
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      setParseError('Expected a non-empty JSON array of materials.');
      return;
    }

    for (const [index, entry] of parsed.entries()) {
      if (typeof entry !== 'object' || entry === null) {
        setParseError(`Item ${index + 1} is not an object.`);
        return;
      }
      const missing = REQUIRED_FIELDS.filter((field) => typeof (entry as Record<string, unknown>)[field] !== 'string' || !(entry as Record<string, unknown>)[field]);
      if (missing.length > 0) {
        setParseError(`Item ${index + 1} ("${(entry as any).name ?? 'unnamed'}") is missing: ${missing.join(', ')}.`);
        return;
      }
    }

    const items = parsed as NewMaterialInput[];
    const outcome = await onImport(items);
    setResults(outcome);
    if (outcome.every((r) => r.ok)) {
      setRaw('');
    }
  };

  const handleClose = () => {
    setRaw('');
    setParseError(null);
    setResults(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
      <div className="relative w-full max-w-xl bg-[#14161f] border border-white/[0.1] rounded-2xl shadow-2xl overflow-hidden my-8">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] bg-[#171a24]">
          <div className="flex items-center gap-2.5">
            <UploadCloud className="w-4 h-4 text-amber-400" />
            <div>
              <h3 className="text-sm font-semibold text-white">Bulk Import Materials</h3>
              <p className="text-[10px] text-slate-400">Paste a JSON array to add many at once</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-3">
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={EXAMPLE}
            rows={10}
            className="w-full bg-[#0d0e14] border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-[11px] font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-400 transition-colors resize-y"
          />

          {parseError && (
            <div className="flex items-start gap-1.5 text-[11px] text-rose-300">
              <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{parseError}</span>
            </div>
          )}

          {results && (
            <div className="rounded-xl border border-white/[0.08] divide-y divide-white/[0.06] overflow-hidden">
              {results.map((r, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2 text-[11px]">
                  {r.ok ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                  )}
                  <span className="text-slate-200 truncate flex-1">{r.name}</span>
                  {!r.ok && <span className="text-rose-300 text-[10px] truncate max-w-[45%]">{r.error}</span>}
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.09] border border-white/[0.08] text-xs font-medium text-slate-300 hover:text-white transition-colors"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={loading || raw.trim().length === 0}
              className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600 text-slate-950 text-xs font-semibold disabled:opacity-60 hover:brightness-110 transition-all"
            >
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Import
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
