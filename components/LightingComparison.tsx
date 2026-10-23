import React, { useEffect, useState } from 'react';
import { Loader2, Sun, Sunset, Lightbulb, Moon } from 'lucide-react';
import { RenderLayerInput } from '../services/renderer/materialRenderer';
import { getLightingComparisonBlobs, LIGHTING_PRESETS } from '../services/lightingCompare';

interface LightingComparisonProps {
  roomUrl: string;
  renderUrl: string;
  roomKey: string;
  layers: RenderLayerInput[];
}

const PRESET_ICONS = [Sun, Sunset, Lightbulb, Moon];

export const LightingComparison: React.FC<LightingComparisonProps> = ({ roomUrl, renderUrl, roomKey, layers }) => {
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const material = layers[0]?.material;

  useEffect(() => {
    let active = true;
    let createdUrls: string[] = [];
    setIsLoading(true);
    setError(null);
    setImageUrls([]);

    getLightingComparisonBlobs(roomKey, roomUrl, renderUrl, layers)
      .then((blobs) => {
        if (!active) return;
        createdUrls = blobs.map((blob) => URL.createObjectURL(blob));
        setImageUrls(createdUrls);
        setIsLoading(false);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : 'Could not create the lighting previews.');
        setIsLoading(false);
      });

    return () => {
      active = false;
      createdUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [roomKey, roomUrl, renderUrl, layers]);

  return (
    <div className="absolute inset-0 overflow-y-auto bg-[#0b0d12] px-3 py-4 md:px-5">
      <div className="mx-auto max-w-5xl space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2 px-1">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-300">Local lighting study</p>
            <h2 className="mt-1 text-sm font-medium text-slate-100">{material?.name ?? 'Applied material'} in four light settings</h2>
          </div>
          <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[10px] text-slate-400">
            Approximate preview · no external service
          </span>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {LIGHTING_PRESETS.map((preset) => (
              <div key={preset.id} className="flex min-h-44 items-center justify-center rounded-xl border border-white/[0.08] bg-[#12151c] text-slate-400">
                <Loader2 className="mr-2 h-4 w-4 animate-spin text-amber-300" />
                <span className="text-xs">Building {preset.name.toLowerCase()}…</span>
              </div>
            ))}
          </div>
        ) : error ? (
          <div role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/[0.06] p-4 text-sm text-rose-200">{error}</div>
        ) : (
          <div data-testid="lighting-comparison-grid" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {LIGHTING_PRESETS.map((preset, index) => {
              const Icon = PRESET_ICONS[index];
              return (
                <article key={preset.id} className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#12151c]">
                  <div className="relative aspect-[16/9] bg-black/30">
                    {imageUrls[index] && (
                      <img src={imageUrls[index]} alt={`${preset.name} lighting preview`} className="h-full w-full object-contain" />
                    )}
                    <span className="absolute left-2.5 top-2.5 inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-black/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-100">
                      <Icon className="h-3 w-3 text-amber-300" />
                      {preset.name}
                    </span>
                  </div>
                  <p className="min-h-[48px] px-3 py-2.5 text-xs leading-relaxed text-slate-300">
                    {material ? preset.note(material) : 'Lighting can shift how this finish reads.'}
                  </p>
                </article>
              );
            })}
          </div>
        )}

        <p className="px-1 pb-1 text-[10px] leading-relaxed text-slate-500">
          Estimated from broad luminance in the original photo; light direction and fixture output are not measured.
        </p>
      </div>
    </div>
  );
};
