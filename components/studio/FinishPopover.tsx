import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { StudioMaterial } from '../../scenes/types';
import { Box, placePopover } from './geometry';

interface Props {
  // Names of the selected items, for the heading
  labels: string[];
  // Only the finishes that fit every selected item (materialsFor)
  materials: StudioMaterial[];
  // The finish every selected item shares, if they all have the same one
  activeId: string | null;
  // The selected area in the container's pixels, and the container's size
  anchor: Box | null;
  container: { w: number; h: number };
  onApply: (materialId: string) => void;
  onClose: () => void;
  // Design-style pickers for the selected items' groups, above the finishes
  children?: React.ReactNode;
}

const useNarrow = () => {
  const query = '(max-width: 639px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
};

/**
 * The selected area's finishes, in a card beside it on the picture (a bottom sheet on phones):
 * its design styles, then only the finishes that fit it. Stays open while finishes are tried in
 * turn; Esc or ✕ closes it (and clears the selection).
 */
export const FinishPopover: React.FC<Props> = ({ labels, materials, activeId, anchor, container, onApply, onClose, children }) => {
  const narrow = useNarrow();
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ w: el.offsetWidth, h: el.offsetHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [narrow]);

  // Focus moves into the card when it opens, and back where it was when it closes
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.focus({ preventScroll: true });
    return () => before?.focus?.({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const heading = labels.length === 1 ? labels[0] : `${labels.length} items`;
  const place = !narrow && anchor && size ? placePopover(anchor, container, size) : null;

  const body = (
    <>
      <div className="flex items-start justify-between gap-3 border-b border-line px-5 pb-3 pt-4">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-brass">Finish for</p>
          <h2 className="mt-0.5 truncate font-serif text-[22px] leading-tight text-spruce">{heading}</h2>
          {labels.length > 1 && <p className="mt-0.5 truncate text-xs text-spruce-soft">{labels.join(' · ')}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="-mr-1.5 rounded-full p-1.5 text-spruce-soft transition hover:bg-mist hover:text-spruce">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className={`space-y-5 overflow-y-auto px-5 pb-5 pt-4 ${narrow ? 'max-h-[44vh]' : 'max-h-[min(62vh,520px)]'}`}>
        {children}
        {materials.length ? (
          <div>
            {children && <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-spruce-soft">Finishes</h3>}
            <div className="grid grid-cols-3 gap-x-3 gap-y-3.5">
              {materials.map((m) => {
                const active = m.id === activeId;
                return (
                  <button
                    key={m.id}
                    type="button"
                    data-testid="finish-chip"
                    data-material={m.id}
                    aria-pressed={active}
                    onClick={() => onApply(m.id)}
                    className="group text-left focus:outline-none"
                  >
                    <span
                      className={`relative block aspect-square overflow-hidden rounded-lg bg-cover bg-center transition duration-200 group-hover:-translate-y-0.5 group-hover:shadow-[0_10px_20px_-10px_rgba(30,43,41,0.55)] group-focus-visible:ring-2 group-focus-visible:ring-spruce ${
                        active ? 'ring-2 ring-brass ring-offset-2 ring-offset-white' : 'ring-1 ring-black/10'
                      }`}
                      style={{ backgroundImage: `url(${m.thumbnail})` }}
                    >
                      <span className="absolute inset-0 bg-gradient-to-br from-white/15 via-transparent to-black/10" />
                      {active && (
                        <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-brass text-white">
                          <Check className="h-2.5 w-2.5" strokeWidth={3} />
                        </span>
                      )}
                      {m.tag && <span className="absolute bottom-1 left-1 rounded-full bg-white/90 px-1.5 py-px text-[9px] font-semibold text-spruce">{m.tag}</span>}
                    </span>
                    <span className={`mt-1.5 block text-[12px] font-semibold leading-snug ${active ? 'text-brass' : 'text-spruce'}`}>{m.name}</span>
                    <span className="block text-[10.5px] leading-snug text-spruce-soft">{m.finishType}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="text-sm text-spruce-soft">These items take different finishes — pick them one at a time.</p>
        )}
      </div>
    </>
  );

  if (narrow)
    return (
      <div
        ref={ref}
        role="dialog"
        aria-label={`Finishes for ${heading}`}
        tabIndex={-1}
        data-testid="finish-popover"
        className="fixed inset-x-0 bottom-0 z-40 rounded-t-2xl bg-white shadow-[0_-20px_50px_-20px_rgba(30,43,41,0.5)] outline-none motion-safe:animate-[sheet-in_260ms_cubic-bezier(0.2,0.8,0.2,1)]"
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line" />
        {body}
      </div>
    );

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Finishes for ${heading}`}
      tabIndex={-1}
      data-testid="finish-popover"
      data-side={place?.side}
      className="absolute z-30 w-[340px] max-w-[calc(100%-16px)] rounded-xl bg-white shadow-[0_24px_60px_-20px_rgba(30,43,41,0.55)] ring-1 ring-line outline-none motion-safe:animate-[pop-in_180ms_ease-out]"
      // Measured first (hidden), then placed beside the area
      style={place ? { left: place.left, top: place.top } : { left: 0, top: 0, visibility: 'hidden' }}
    >
      {place && (
        <span
          aria-hidden
          className="absolute h-3 w-3 rotate-45 bg-white ring-1 ring-line [clip-path:polygon(0_0,0_100%,100%_100%)]"
          style={
            place.side === 'right'
              ? { left: -6, top: place.notch - 6 }
              : place.side === 'left'
                ? { right: -6, top: place.notch - 6, transform: 'rotate(225deg)' }
                : place.side === 'bottom'
                  ? { top: -6, left: place.notch - 6, transform: 'rotate(135deg)' }
                  : { bottom: -6, left: place.notch - 6, transform: 'rotate(-45deg)' }
          }
        />
      )}
      {body}
    </div>
  );
};
