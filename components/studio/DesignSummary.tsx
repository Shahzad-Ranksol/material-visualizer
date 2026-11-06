import React, { useState } from 'react';
import { Check, Download, Link2, X } from 'lucide-react';
import { materialById } from '../../scenes/materials';
import { Scene } from '../../scenes/types';

interface Props {
  scene: Scene;
  assignments: Record<string, string>;
  renderUrl: string | null;
  shareUrl: string;
  onRemove: (itemId: string) => void;
  onReset: () => void;
  onSelect: (itemId: string) => void;
}

/** "Your design": every item's chosen finish, plus download, share and quote. */
export const DesignSummary: React.FC<Props> = ({ scene, assignments, renderUrl, shareUrl, onRemove, onReset, onSelect }) => {
  const [copied, setCopied] = useState(false);
  const rows = scene.items.filter((i) => assignments[i.id]).map((i) => ({ item: i, material: materialById(assignments[i.id])! }));

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
    `Hello,\n\nI'd like a quote for this ${scene.title.toLowerCase()} design:\n\n${rows.map((r) => `• ${r.item.label}: ${r.material.name} (${r.material.finishType})`).join('\n')}\n\nDesign link: ${shareUrl}\n`
  );

  return (
    <section aria-label="Your design">
      <div className="flex items-baseline justify-between">
        <h2 className="font-serif text-2xl leading-none text-spruce">
          Your design
          {rows.length > 0 && <span className="ml-2 align-middle font-grotesk text-xs font-semibold text-brass">{rows.length}</span>}
        </h2>
        {rows.length > 0 && (
          <button type="button" onClick={onReset} className="text-xs text-spruce-soft underline-offset-2 hover:text-spruce hover:underline">
            Start over
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm leading-relaxed text-spruce-soft">Click a cabinet, worktop, wall or fence in the picture to choose its finish. Your choices collect here, ready to download, share or price.</p>
      ) : (
        <ul className="mt-4 max-h-72 divide-y divide-line overflow-y-auto border-y border-line" data-testid="design-summary">
          {rows.map(({ item, material }) => (
            <li key={item.id} className="flex items-center gap-3 py-2.5">
              <img src={material.thumbnail} alt="" className="h-10 w-10 rounded-md object-cover ring-1 ring-black/10" />
              <button type="button" onClick={() => onSelect(item.id)} className="min-w-0 flex-1 text-left">
                <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-spruce-soft">{item.label}</span>
                <span className="block truncate text-sm font-medium text-spruce">{material.name}</span>
              </button>
              <button
                type="button"
                onClick={() => onRemove(item.id)}
                aria-label={`Remove the finish from ${item.label}`}
                className="rounded-full p-1.5 text-spruce-soft transition hover:bg-mist hover:text-spruce"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-5 grid grid-cols-2 gap-2">
        <a
          href={renderUrl ?? undefined}
          download={`${scene.id}-design.png`}
          aria-disabled={!renderUrl}
          data-testid="download"
          className={`flex items-center justify-center gap-1.5 rounded-full border border-line px-3 py-2 text-sm font-medium text-spruce transition ${renderUrl ? 'hover:border-spruce/40 hover:bg-mist' : 'pointer-events-none opacity-40'}`}
        >
          <Download className="h-4 w-4" /> Download
        </a>
        <button
          type="button"
          onClick={copy}
          disabled={!rows.length}
          className="flex items-center justify-center gap-1.5 rounded-full border border-line px-3 py-2 text-sm font-medium text-spruce transition hover:border-spruce/40 hover:bg-mist disabled:opacity-40"
        >
          {copied ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />} {copied ? 'Link copied' : 'Copy link'}
        </button>
        <a
          href={rows.length ? `mailto:?subject=${encodeURIComponent(`Quote request: ${scene.title}`)}&body=${quoteBody}` : undefined}
          aria-disabled={!rows.length}
          className={`col-span-2 rounded-full bg-spruce px-3 py-3 text-center text-sm font-semibold tracking-wide text-paper transition ${
            rows.length ? 'hover:bg-[#2a3a37]' : 'pointer-events-none opacity-35'
          }`}
        >
          Request a quote
        </a>
      </div>
    </section>
  );
};
