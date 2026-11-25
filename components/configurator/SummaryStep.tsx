import React from 'react';
import { ChevronRight, Download, RotateCcw } from 'lucide-react';
import { APP } from '../../apps';
import { Scene } from '../../scenes/types';
import { BAKED } from '../../scenes/baked';
import { ORIGINAL } from '../../scenes/styles';
import { styleBake } from '../../scenes/stylesBaked';
import { previewBackground } from './StyleChoices';
import { readyStyles, stepMaterial, stepStyle, WizardStep } from './wizard';

interface Props {
  scene: Scene;
  steps: WizardStep[];
  styles: Record<string, string>;
  assignments: Record<string, string>;
  renderUrl: string | null;
  onEdit: (stepIndex: number) => void;
  onReset: () => void;
}

// The design's choices, one row per design step: what it is and what was chosen
const summaryRows = (steps: WizardStep[], styles: Record<string, string>, assignments: Record<string, string>) =>
  steps
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
        groupId: s.styleGroup?.id,
        index,
      };
    });

/** A design row's thumbnail: the middle of the design's area, in the chosen design (or as shown). */
const DesignThumb: React.FC<{ scene: Scene; groupId: string; optionId: string }> = ({ scene, groupId, optionId }) => {
  const baked = BAKED[scene.id];
  const area = readyStyles(scene.id, groupId)[0]?.bake.rect;
  if (!baked || !area) return <span className="h-10 w-10 shrink-0 rounded-lg bg-mist ring-1 ring-black/5" />;
  const side = Math.min(area.w, area.h);
  const frame = { x: area.x + (area.w - side) / 2, y: area.y + (area.h - side) / 2, w: side, h: side };
  const bake = optionId === ORIGINAL ? null : (styleBake(scene.id, groupId, optionId) ?? null);
  return <span className="h-10 w-10 shrink-0 rounded-lg bg-no-repeat ring-1 ring-black/10" style={previewBackground(scene.photo, baked.width, baked.height, frame, bake)} />;
};

/** Request a quote: an email to the showroom with the choices and the design's link. */
export const quoteHref = (scene: Scene, steps: WizardStep[], styles: Record<string, string>, assignments: Record<string, string>, shareUrl: string) => {
  const rows = summaryRows(steps, styles, assignments);
  const body = encodeURIComponent(
    `Hello,\n\nI'd like a quote for this ${APP.noun} design (${scene.title}):\n\n${rows.map((r) => `• ${r.title}: ${r.value}`).join('\n')}\n\nDesign link: ${shareUrl}\n`,
  );
  return `mailto:${APP.quoteEmail ?? ''}?subject=${encodeURIComponent(`Quote request: ${APP.brand} ${APP.product}`)}&body=${body}`;
};

/**
 * The last step: the design's choices as a specification (each one a tap to change it), with
 * Download and Start over under them. Its one clear action, Request a quote, sits at the foot of
 * the card where Next is on the other steps (`quoteHref`), so the whole step fits without scrolling.
 */
export const SummaryStep: React.FC<Props> = ({ scene, steps, styles, assignments, renderUrl, onEdit, onReset }) => {
  const rows = summaryRows(steps, styles, assignments);
  const changed = rows.some((r) => r.value !== 'As shown');

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
              className={`group flex w-full items-center gap-3.5 px-4 py-3 text-left transition hover:bg-mist/50 ${k ? 'border-t border-line' : ''}`}
            >
              {r.material ? (
                <img src={r.material.thumbnail} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover ring-1 ring-black/10" />
              ) : r.groupId ? (
                <DesignThumb scene={scene} groupId={r.groupId} optionId={styles[r.groupId] ?? ORIGINAL} />
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

      <div className="mt-4 flex items-center justify-between gap-3 px-1">
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
