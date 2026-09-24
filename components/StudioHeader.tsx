import React from 'react';
import { RoomType, RenderMode } from '../types';
import { ROOM_TYPES } from '../constants';
import { Compass, FileText, RotateCcw, ChevronDown } from 'lucide-react';

interface StudioHeaderProps {
  selectedRoomType: RoomType;
  onSelectRoomType: (roomType: RoomType) => void;
  onOpenSpecSheet: () => void;
  onReset: () => void;
  renderMode: RenderMode;
  onRenderModeChange: (mode: RenderMode) => void;
  // Studio Lighting needs the optional self-hosted worker; without it only Exact Preview exists
  studioLightingAvailable: boolean;
}

export const StudioHeader: React.FC<StudioHeaderProps> = ({
  selectedRoomType,
  onSelectRoomType,
  onOpenSpecSheet,
  onReset,
  renderMode,
  onRenderModeChange,
  studioLightingAvailable,
}) => {
  return (
    <header className="border-b border-white/[0.08] bg-[#0f1117]/95 backdrop-blur-md sticky top-0 z-40">
      <div className="max-w-[1700px] mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
        {/* Atelier Brand Identity */}
        <div className="flex items-center gap-3.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 via-amber-500 to-amber-700 p-[1px] shadow-lg shadow-amber-500/10">
            <div className="w-full h-full rounded-[11px] bg-[#12141c] flex items-center justify-center text-amber-300 font-serif font-bold text-sm tracking-wider">
              MV
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-serif font-semibold tracking-wide text-white">
                Material Visualizer
              </h1>
              <span className="hidden sm:inline-flex px-2 py-0.5 rounded-full text-[9px] font-semibold tracking-widest uppercase bg-amber-500/10 border border-amber-500/20 text-amber-300">
                Architectural Studio
              </span>
            </div>
            <p className="text-[10px] text-slate-400 tracking-wider uppercase font-sans">
              Material Re-Cladding & Interior Synthesis
            </p>
          </div>
        </div>

        {/* Room Context Picker */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <select
              id="header-room-select"
              value={selectedRoomType}
              onChange={(e) => onSelectRoomType(e.target.value as RoomType)}
              className="appearance-none bg-[#161822] border border-white/[0.08] hover:border-white/20 text-slate-200 text-xs font-medium rounded-xl pl-3.5 pr-8 py-2 focus:outline-none focus:border-amber-400 transition-colors cursor-pointer"
            >
              {ROOM_TYPES.map((type) => (
                <option key={type} value={type} className="bg-[#12141c] text-slate-200">
                  {type}
                </option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          {/* Render mode: Exact Preview is deterministic and product-faithful; Studio Lighting is an
              optional visual approximation from a self-hosted worker — no external API either way */}
          <div className="hidden md:flex items-center gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/[0.06]">
            {(
              [
                { mode: 'exact', label: 'Exact Preview', title: 'Product-faithful render: true scale, perspective and colour — runs in your browser' },
                {
                  mode: 'studio',
                  label: 'Studio Lighting',
                  title: studioLightingAvailable
                    ? 'Adds soft lighting harmonisation from the private render worker (visual approximation)'
                    : 'Not enabled on this server — requires the optional self-hosted render worker',
                },
              ] as const
            ).map(({ mode, label, title }) => {
              const disabled = mode === 'studio' && !studioLightingAvailable;
              return (
                <button
                  key={mode}
                  type="button"
                  title={title}
                  disabled={disabled}
                  onClick={() => onRenderModeChange(mode)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                    renderMode === mode ? 'bg-amber-500/20 text-amber-300' : 'text-slate-400 hover:text-slate-200'
                  } disabled:opacity-40 disabled:hover:text-slate-400`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Action Tools */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            id="btn-header-spec"
            onClick={onOpenSpecSheet}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.09] text-xs font-medium text-slate-200 border border-white/[0.08] transition-colors"
          >
            <FileText className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">Spec Sheet</span>
          </button>

          <button
            type="button"
            id="btn-header-reset"
            onClick={onReset}
            title="Reset Workspace"
            className="p-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.09] text-slate-400 hover:text-slate-200 border border-white/[0.08] transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
