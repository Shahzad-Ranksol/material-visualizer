import React, { useState } from 'react';
import { Check, Download, Link2, RotateCcw } from 'lucide-react';
import { APP } from '../../apps';
import { Scene } from '../../scenes/types';
import { stepMaterial, stepStyle, WizardStep } from './wizard';

interface Props {
  scene: Scene;
  steps: WizardStep[];
  styles: Record<string, string>;
  assignments: Record<string, string>;
  renderUrl: string | null;
  shareUrl: string;
  onEdit: (stepIndex: number) => void;
  onReset: () => void;
}

/** The last step: each choice (tap to change it), then download, share and quote. */
export const SummaryStep: React.FC<Props> = ({ scene, steps, styles, assignments, renderUrl, shareUrl, onEdit, onReset }) => {
  const [copied, setCopied] = useState(false);
  const rows = steps
    .map((s, index) => ({ s, index }))
    .filter((r): r is { s: Extract<WizardStep, { kind: 'design' }>; index: number } => r.s.kind === 'design')
    .map(({ s, index }) => {
      const style = stepStyle(s, styles);
      const material = stepMaterial(s, assignments);
      const value = [style?.label, material?.name].filter(Boolean).join(' · ') || 'As shown';
      return { id: s.id, title: s.title.replace(/^(Pick|Choose|Add|Finish) (your |a |an |the )?/i, ''), value, material, index };
    });
  const changed = rows.some((r) => r.value !== 'As shown');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this link', shareUrl);
    }
  };

  const quoteBody = encodeURIComponent(
    `Hello,\n\nI'd like a quote for this ${APP.product.toLowerCase().replace(/s$/, '')} design:\n\n${rows.map((r) => `• ${r.title}: ${r.value}`).join('\n')}\n\nDesign link: ${shareUrl}\n`
  );

  return (
    <section aria-label="Your design">
      <dl className="divide-y divide-line rounded-xl border border-line bg-white" data-testid="design-summary">
        {rows.map((r) => (
          <button key={r.id} type="button" onClick={() => onEdit(r.index)} className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition hover:bg-mist/60">
            {r.material ? (
              <img src={r.material.thumbnail} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover ring-1 ring-black/10" />
            ) : (
              <span className="h-9 w-9 shrink-0 rounded-md bg-mist ring-1 ring-black/5" />
            )}
            <dt className="w-24 shrink-0 text-[12px] capitalize text-spruce-soft">{r.title}</dt>
            <dd className="min-w-0 flex-1 text-right text-[13px] font-medium text-spruce">{r.value}</dd>
          </button>
        ))}
      </dl>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <a
          href={renderUrl ?? undefined}
          download={`${scene.id}-design.png`}
          aria-disabled={!renderUrl}
          data-testid="download"
          className={`flex items-center justify-center gap-1.5 rounded-full border border-line bg-white px-3 py-2.5 text-sm font-medium text-spruce transition ${renderUrl ? 'hover:border-spruce/40' : 'pointer-events-none opacity-40'}`}
        >
          <Download className="h-4 w-4" /> Download
        </a>
        <button
          type="button"
          onClick={copy}
          disabled={!changed}
          className="flex items-center justify-center gap-1.5 rounded-full border border-line bg-white px-3 py-2.5 text-sm font-medium text-spruce transition hover:border-spruce/40 disabled:opacity-40"
        >
          {copied ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />} {copied ? 'Link copied' : 'Copy link'}
        </button>
      </div>
      <a
        href={`mailto:${APP.quoteEmail ?? ''}?subject=${encodeURIComponent(`Quote request: ${APP.brand} ${APP.product}`)}&body=${quoteBody}`}
        data-testid="quote"
        className="mt-2 block rounded-full bg-spruce px-3 py-3 text-center text-sm font-semibold tracking-wide text-paper transition hover:bg-[#2a3a37]"
      >
        Request a quote
      </a>
      {changed && (
        <button type="button" onClick={onReset} className="mx-auto mt-3 flex items-center gap-1.5 text-xs text-spruce-soft underline-offset-2 hover:text-spruce hover:underline">
          <RotateCcw className="h-3 w-3" /> Start over
        </button>
      )}
    </section>
  );
};
