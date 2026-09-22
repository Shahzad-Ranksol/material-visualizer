import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Split, 
  Columns2, 
  Sparkles, 
  Maximize2, 
  Minimize2, 
  Download, 
  Eye, 
  RotateCcw,
  Sliders,
  Layers
} from 'lucide-react';
import { ViewMode, Material } from '../types';

interface ResultDisplayProps {
  uploadedImageUrl: string | null;
  processedImageUrl: string | null;
  isLoading: boolean;
  isDetectionLoading: boolean;
  selectedMaterial: Material | null;
  selectedItemsCount: number;
}

export const ResultDisplay: React.FC<ResultDisplayProps> = ({
  uploadedImageUrl,
  processedImageUrl,
  isLoading,
  isDetectionLoading,
  selectedMaterial,
  selectedItemsCount,
}) => {
  const [sliderPosition, setSliderPosition] = useState<number>(50);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<ViewMode>('slider');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [loadingStep, setLoadingStep] = useState<number>(0);

  const containerRef = useRef<HTMLDivElement>(null);

  // Stepped progression during rendering for engaging studio feedback
  useEffect(() => {
    if (!isLoading) {
      setLoadingStep(0);
      return;
    }
    const interval = setInterval(() => {
      setLoadingStep((prev) => (prev < 3 ? prev + 1 : prev));
    }, 1200);
    return () => clearInterval(interval);
  }, [isLoading]);

  // Mouse / Touch handlers for before/after split slider
  const handleMove = useCallback((clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPosition(percentage);
  }, []);

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length > 0) {
      handleMove(e.touches[0].clientX);
    }
  };

  const handleMouseDown = () => setIsDragging(true);

  useEffect(() => {
    const handleMouseUp = () => setIsDragging(false);
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        handleMove(e.clientX);
      }
    };

    if (isDragging) {
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('mousemove', handleMouseMove);
    }
    return () => {
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [isDragging, handleMove]);

  // Download rendered image
  const handleDownload = () => {
    const imageToDownload = processedImageUrl || uploadedImageUrl;
    if (!imageToDownload) return;

    const link = document.createElement('a');
    link.href = imageToDownload;
    link.download = `Material-Visualizer-${selectedMaterial?.name.replace(/\s+/g, '-') || 'Concept'}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const renderSteps = [
    'Analyzing spatial planes & geometry...',
    'Computing daylight bounce & ambient occlusion...',
    'Synthesizing architectural material grain & specular reflection...',
    'Mastering high-fidelity studio finish...',
  ];

  const hasBothImages = Boolean(uploadedImageUrl && processedImageUrl);

  return (
    <div 
      ref={containerRef}
      id="studio-canvas-stage"
      className={`relative w-full rounded-2xl overflow-hidden bg-[#12141a] border border-white/[0.08] shadow-2xl transition-all duration-300 flex flex-col ${
        isFullscreen ? 'fixed inset-0 z-50 rounded-none h-screen' : 'min-h-[520px] md:min-h-[620px]'
      }`}
    >
      {/* Stage Top Bar Controls */}
      <div className="flex items-center justify-between px-5 py-3.5 bg-[#171a22]/90 border-b border-white/[0.06] backdrop-blur-md z-20 shrink-0">
        <div className="flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          <span className="text-[11px] font-semibold tracking-wider uppercase text-slate-300">
            Studio Canvas
          </span>
          {selectedMaterial && (
            <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-[10px] font-medium text-amber-200">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
              {selectedMaterial.name}
            </span>
          )}
        </div>

        {/* View Mode Switcher */}
        <div className="flex items-center gap-1.5 bg-[#0e1015] p-1 rounded-xl border border-white/[0.06]">
          {hasBothImages && (
            <>
              <button
                type="button"
                id="btn-view-slider"
                onClick={() => setViewMode('slider')}
                title="Split Comparison Slider"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  viewMode === 'slider'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Split className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Split Slider</span>
              </button>

              <button
                type="button"
                id="btn-view-side"
                onClick={() => setViewMode('side-by-side')}
                title="Side by Side Comparison"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  viewMode === 'side-by-side'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Columns2 className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Side by Side</span>
              </button>
            </>
          )}

          <button
            type="button"
            id="btn-view-rendered"
            onClick={() => setViewMode('rendered')}
            title="Rendered Concept"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              viewMode === 'rendered'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Render</span>
          </button>

          <button
            type="button"
            id="btn-view-original"
            onClick={() => setViewMode('original')}
            title="Original Reference"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              viewMode === 'original'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Original</span>
          </button>
        </div>

        {/* Action icons */}
        <div className="flex items-center gap-2">
          {(processedImageUrl || uploadedImageUrl) && (
            <button
              type="button"
              id="btn-download-render"
              onClick={handleDownload}
              title="Download Architectural Render"
              className="p-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 hover:text-white border border-white/[0.06] transition-colors"
            >
              <Download className="w-4 h-4" />
            </button>
          )}

          <button
            type="button"
            id="btn-toggle-fullscreen"
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            className="p-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 hover:text-white border border-white/[0.06] transition-colors"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Main Visual Display Area */}
      <div className="relative flex-1 w-full bg-[#0b0c10] flex items-center justify-center overflow-hidden select-none">
        {/* Subtle grid backdrop */}
        <div 
          className="absolute inset-0 opacity-[0.03] pointer-events-none"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, #ffffff 1px, transparent 0)`,
            backgroundSize: '24px 24px',
          }}
        />

        {/* Ambient Loading Overlay */}
        {(isLoading || isDetectionLoading) && (
          <div className="absolute inset-0 z-30 bg-[#0e1015]/85 backdrop-blur-md flex flex-col items-center justify-center p-8 text-center animate-in fade-in duration-300">
            <div className="relative mb-6">
              {/* Refined pulsing glow ring */}
              <div className="absolute -inset-4 bg-amber-500/20 rounded-full blur-xl animate-pulse"></div>
              <div className="w-16 h-16 rounded-2xl bg-[#171a22] border border-amber-500/40 flex items-center justify-center text-amber-300 shadow-2xl relative">
                <Sparkles className="w-8 h-8 animate-spin" style={{ animationDuration: '6s' }} />
              </div>
            </div>

            <div className="max-w-md space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-amber-400">
                {isDetectionLoading ? 'Spatial Perception Engine' : 'Architectural Synthesis'}
              </span>
              <h3 className="text-xl md:text-2xl font-serif font-medium text-slate-100">
                {isDetectionLoading
                  ? 'Analyzing Room Geometry & Elements'
                  : `Applying ${selectedMaterial?.name || 'Architectural Material'}`}
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed font-sans min-h-[20px]">
                {isLoading ? renderSteps[loadingStep] : 'Scanning structural planes and furniture topologies...'}
              </p>
            </div>

            {/* Step progress bar */}
            <div className="w-64 mt-6 h-1 bg-white/[0.08] rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-amber-500 to-amber-300 transition-all duration-700 ease-out"
                style={{ width: `${isLoading ? ((loadingStep + 1) / 4) * 100 : 60}%` }}
              />
            </div>
          </div>
        )}

        {/* Empty State when no image is loaded */}
        {!uploadedImageUrl && !isLoading && !isDetectionLoading && (
          <div className="flex flex-col items-center text-center p-8 max-w-sm space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-slate-500 shadow-inner">
              <Layers className="w-8 h-8 stroke-[1.25]" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-base font-serif font-medium text-slate-200">
                Select a Curated Room or Upload
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Choose one of our studio presets from the left panel, or upload your own interior photograph to begin.
              </p>
            </div>
          </div>
        )}

        {/* VIEW MODE: Split Comparison Slider */}
        {uploadedImageUrl && viewMode === 'slider' && hasBothImages && (
          <div
            className="absolute inset-0 flex items-center justify-center cursor-ew-resize overflow-hidden"
            onMouseMove={(e) => {
              if (e.buttons === 1) handleMove(e.clientX);
            }}
            onClick={(e) => handleMove(e.clientX)}
            onTouchMove={handleTouchMove}
          >
            {/* Base layer (Re-textured Render) */}
            <img
              src={processedImageUrl!}
              alt="Specified Concept"
              className="absolute inset-0 w-full h-full object-cover select-none pointer-events-none"
            />

            {/* Top clipped layer (Original Image) */}
            <div
              className="absolute inset-0 overflow-hidden select-none pointer-events-none"
              style={{ width: `${sliderPosition}%` }}
            >
              <img
                src={uploadedImageUrl}
                alt="Original Space"
                className="absolute inset-0 w-full h-full object-cover select-none max-w-none"
                style={{
                  width: containerRef.current ? `${containerRef.current.clientWidth}px` : '100%',
                }}
              />
            </div>

            {/* Split Slider Line & Handle */}
            <div
              className="absolute top-0 bottom-0 z-20"
              style={{ left: `${sliderPosition}%`, transform: 'translateX(-50%)' }}
              onMouseDown={handleMouseDown}
              onTouchStart={handleMouseDown}
            >
              <div className="w-0.5 h-full bg-gradient-to-b from-amber-400 via-white to-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.6)]"></div>
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-[#12141a] border-2 border-amber-400 text-amber-300 flex items-center justify-center shadow-2xl cursor-ew-resize hover:scale-110 active:scale-95 transition-transform">
                <Sliders className="w-4 h-4 rotate-90" />
              </div>
            </div>

            {/* Floating Labels */}
            <div className="absolute top-5 left-5 pointer-events-none z-10">
              <span className="px-3 py-1 rounded-md bg-black/75 backdrop-blur border border-white/10 text-[10px] font-bold uppercase tracking-widest text-slate-300">
                Original Room
              </span>
            </div>
            <div className="absolute top-5 right-5 pointer-events-none z-10">
              <span className="px-3 py-1 rounded-md bg-amber-500/90 backdrop-blur border border-amber-400/40 text-[10px] font-bold uppercase tracking-widest text-black shadow-lg">
                Concept Render
              </span>
            </div>

            <div className="absolute bottom-5 inset-x-0 flex justify-center pointer-events-none z-10">
              <span className="px-3 py-1 rounded-full bg-black/60 backdrop-blur text-[10px] text-slate-400 border border-white/[0.08]">
                Drag line to compare transformation
              </span>
            </div>
          </div>
        )}

        {/* VIEW MODE: Side-by-Side */}
        {uploadedImageUrl && viewMode === 'side-by-side' && hasBothImages && (
          <div className="w-full h-full grid grid-cols-1 md:grid-cols-2 gap-1 p-2 bg-[#0c0d12]">
            <div className="relative w-full h-full rounded-xl overflow-hidden border border-white/[0.08]">
              <img
                src={uploadedImageUrl}
                alt="Original Space"
                className="w-full h-full object-cover"
              />
              <div className="absolute top-4 left-4">
                <span className="px-3 py-1 rounded-md bg-black/75 backdrop-blur border border-white/10 text-[10px] font-bold uppercase tracking-widest text-slate-300">
                  Original
                </span>
              </div>
            </div>

            <div className="relative w-full h-full rounded-xl overflow-hidden border border-amber-500/30">
              <img
                src={processedImageUrl!}
                alt="Specified Concept"
                className="w-full h-full object-cover"
              />
              <div className="absolute top-4 right-4">
                <span className="px-3 py-1 rounded-md bg-amber-500/90 backdrop-blur border border-amber-400/40 text-[10px] font-bold uppercase tracking-widest text-black">
                  New Material
                </span>
              </div>
            </div>
          </div>
        )}

        {/* VIEW MODE: Single Image (Render or Original) */}
        {uploadedImageUrl && (viewMode === 'rendered' || viewMode === 'original' || !hasBothImages) && (
          <div className="relative w-full h-full flex items-center justify-center p-3">
            <img
              src={
                viewMode === 'original' || !processedImageUrl
                  ? uploadedImageUrl
                  : processedImageUrl
              }
              alt="Interior Visualizer"
              className="max-w-full max-h-full object-contain rounded-xl shadow-2xl transition-all duration-500"
            />

            <div className="absolute bottom-6 right-6">
              <span className="px-3.5 py-1.5 rounded-full bg-black/80 backdrop-blur border border-white/10 text-[11px] font-medium tracking-wider text-slate-300 shadow-xl flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                {viewMode === 'original' || !processedImageUrl
                  ? 'Original Space'
                  : `Render: ${selectedMaterial?.name || 'Re-clad'}`}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Stage Bottom Metadata Bar */}
      <div className="flex items-center justify-between px-5 py-3 bg-[#14161e] border-t border-white/[0.06] text-slate-400 text-xs shrink-0">
        <div className="flex items-center gap-4">
          <span className="text-[11px] text-slate-400">
            Selected Targets: <strong className="text-slate-200 font-semibold">{selectedItemsCount}</strong> element{selectedItemsCount === 1 ? '' : 's'}
          </span>
          <span className="hidden sm:inline-block w-1 h-1 rounded-full bg-white/20"></span>
          <span className="hidden sm:inline-block text-[11px] text-slate-400">
            Material: <strong className="text-amber-300 font-medium">{selectedMaterial ? selectedMaterial.name : 'None selected'}</strong>
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[10px] tracking-wider uppercase text-slate-500">
            16:9 • Studio High Definition
          </span>
        </div>
      </div>
    </div>
  );
};
