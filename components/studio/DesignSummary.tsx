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
    <section aria-label="Your design" className="border-t border-white/10 pt-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-[#f4efe6]">
          Your design
          {rows.length > 0 && <span className="ml-2 rounded-full bg-[#d9b77a]/15 px-2 py-0.5 text-xs font-semibold text-[#e6c88f]">{rows.length}</span>}
        </h2>
        {rows.length > 0 && (
          <button type="button" onClick={onReset} className="text-xs text-[#a39e94] underline-offset-2 hover:text-[#f4efe6] hover:underline">
            Start over
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-[#a39e94]">The finishes you choose are listed here, ready to download, share or price.</p>
      ) : (
        <ul className="mt-3 max-h-64 divide-y divide-white/[0.07] overflow-y-auto pr-1" data-testid="design-summary">
          {rows.map(({ item, material }) => (
            <li key={item.id} className="flex items-center gap-3 py-2">
              <img src={material.thumbnail} alt="" className="h-9 w-9 rounded-lg object-cover shadow-md ring-1 ring-white/10" />
              <button type="button" onClick={() => onSelect(item.id)} className="min-w-0 flex-1 text-left">
                <span className="block text-[11px] text-[#a39e94]">{item.label}</span>
                <span className="block truncate text-sm font-medium text-[#f4efe6]">{material.name}</span>
              </button>
              <button
                type="button"
                onClick={() => onRemove(item.id)}
                aria-label={`Remove the finish from ${item.label}`}
                className="rounded-full p-1.5 text-[#a39e94] hover:bg-white/10 hover:text-[#f4efe6]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <a
          href={renderUrl ?? undefined}
          download={`${scene.id}-design.png`}
          aria-disabled={!renderUrl}
          data-testid="download"
          className={`flex items-center justify-center gap-1.5 rounded-full border border-white/15 px-3 py-2 text-sm font-medium text-[#f4efe6] ${renderUrl ? 'hover:bg-white/10' : 'pointer-events-none opacity-40'}`}
        >
          <Download className="h-4 w-4" /> Download
        </a>
        <button
          type="button"
          onClick={copy}
          disabled={!rows.length}
          className="flex items-center justify-center gap-1.5 rounded-full border border-white/15 px-3 py-2 text-sm font-medium text-[#f4efe6] hover:bg-white/10 disabled:opacity-40"
        >
          {copied ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />} {copied ? 'Link copied' : 'Copy link'}
        </button>
        <a
          href={rows.length ? `mailto:?subject=${encodeURIComponent(`Quote request: ${scene.title}`)}&body=${quoteBody}` : undefined}
          aria-disabled={!rows.length}
          className={`col-span-2 rounded-full bg-gradient-to-b from-[#e6c88f] to-[#c49a5c] px-3 py-2.5 text-center text-sm font-semibold text-[#1c1915] shadow-[0_8px_24px_-8px_rgba(217,183,122,0.7)] ${
            rows.length ? 'hover:brightness-105' : 'pointer-events-none opacity-40'
          }`}
        >
          Request a quote
        </a>
      </div>
    </section>
  );
};
