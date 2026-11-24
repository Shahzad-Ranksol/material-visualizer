import React from 'react';
import { ChevronRight, Download, RotateCcw } from 'lucide-react';
import { APP } from '../../apps';
import { Scene } from '../../scenes/types';
import { stepMaterial, stepStyle, WizardStep } from './wizard';

interface Props {
  scene: Scene;
  steps: WizardStep[];
  styles: Record<string, string>;
  assignments: Record<string, string>;
  renderUrl: string | null;
  // The design's link, written into the quote request so the showroom sees the same design
  shareUrl: string;
  onEdit: (stepIndex: number) => void;
  onReset: () => void;
}

/**
 * The last step: the design's choices as a specification (each one a tap to change it), then one
 * clear action, Request a quote, with Download and Start over beside it.
 */
export const SummaryStep: React.FC<Props> = ({ scene, steps, styles, assignments, renderUrl, shareUrl, onEdit, onReset }) => {
  const rows = steps
    .map((s, index) => ({ s, index }))
    .filter((r): r is { s: Extract<WizardStep, { kind: 'design' }>; index: number } => r.s.kind === 'design')
    .map(({ s, index }) => {
      const style = stepStyle(s, styles);
      const material = stepMaterial(s, assignments);
      const value = [style?.label, material?.name].filter(Boolean).join(' · ') || 'As shown';
      return {
        id: s.id,
        title: s.title.replace(/^(Pick|Choose|Add|Finish) (your |a |an |the )?/i, ''),
        value,
        material,
        index,
      };
    });
  const changed = rows.some((r) => r.value !== 'As shown');

  const quoteBody = encodeURIComponent(
    `Hello,\n\nI'd like a quote for this ${APP.noun} design (${scene.title}):\n\n${rows.map((r) => `• ${r.title}: ${r.value}`).join('\n')}\n\nDesign link: ${shareUrl}\n`,
  );

  return (
    <section aria-label="Your design">
      <h2 className="mb-2.5 text-[12px] font-semibold uppercase tracking-[0.16em] text-spruce-soft">{scene.title}</h2>
      <ul className="overflow-hidden rounded-xl border border-line bg-white" data-testid="design-summary">
        {rows.map((r, k) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => onEdit(r.index)}
              aria-label={`${r.title}: ${r.value}. Change`}
              className={`group flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition hover:bg-mist/50 ${k ? 'border-t border-line' : ''}`}
            >
              {r.material ? (
                <img src={r.material.thumbnail} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover ring-1 ring-black/10" />
              ) : (
                <span className="h-10 w-10 shrink-0 rounded-lg bg-mist ring-1 ring-black/5" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-medium uppercase tracking-[0.12em] text-spruce-soft">{r.title}</span>
                <span className={`mt-0.5 block truncate text-[15px] font-medium ${r.value === 'As shown' ? 'text-spruce-soft' : 'text-spruce'}`}>{r.value}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-spruce-soft/60 transition group-hover:translate-x-0.5 group-hover:text-spruce" aria-hidden />
            </button>
          </li>
        ))}
      </ul>

      <a
        href={`mailto:${APP.quoteEmail ?? ''}?subject=${encodeURIComponent(`Quote request: ${APP.brand} ${APP.product}`)}&body=${quoteBody}`}
        data-testid="quote"
        className="mt-5 block rounded-full bg-spruce px-4 py-3.5 text-center text-[15px] font-semibold tracking-wide text-paper shadow-[0_14px_28px_-18px_rgba(30,43,41,0.9)] transition hover:bg-[#2a3a37]"
      >
        Request a quote
      </a>
      <div className="mt-3 flex items-center justify-between gap-3 px-1">
        <a
          href={renderUrl ?? undefined}
          download={`${scene.id}-design.png`}
          aria-disabled={!renderUrl}
          data-testid="download"
          className={`flex items-center gap-1.5 text-[14px] font-medium text-spruce underline-offset-4 transition ${renderUrl ? 'hover:underline' : 'pointer-events-none opacity-40'}`}
        >
          <Download className="h-4 w-4" /> Download image
        </a>
        {changed && (
          <button
            type="button"
            onClick={onReset}
            className="flex items-center gap-1.5 text-[14px] text-spruce-soft underline-offset-4 transition hover:text-spruce hover:underline"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Start over
          </button>
        )}
      </div>
    </section>
  );
};
