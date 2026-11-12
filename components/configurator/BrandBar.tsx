import React from 'react';
import { Link } from 'react-router-dom';
import { APP } from '../../apps';

interface Props {
  // Right-hand note: "Takes a minute", "Step 2 of 6"
  note?: string;
  // 0–1 progress through the steps, drawn as segments under the bar
  progress?: { at: number; of: number };
}

/** The app's header: its mark, brand and product, and where you are. Same in every app. */
export const BrandBar: React.FC<Props> = ({ note, progress }) => (
  <header className="sticky top-0 z-30 bg-paper/95 backdrop-blur supports-[backdrop-filter]:bg-paper/80">
    <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-4 px-4 pb-3 pt-4 sm:px-8">
      <Link to="/" className="flex items-center gap-2.5" aria-label={`${APP.brand} ${APP.product} home`}>
        <span className="grid h-7 w-7 place-items-center rounded-md bg-spruce font-serif text-sm font-semibold text-paper">{APP.brand[0]}</span>
        <span className="text-[17px] font-semibold tracking-tight text-spruce">
          {APP.brand} <span className="font-normal text-spruce-soft">{APP.product}</span>
        </span>
      </Link>
      {note && (
        <span className="text-[13px] text-spruce-soft" data-testid="step-note">
          {note}
        </span>
      )}
    </div>
    {progress && (
      <div className="mx-auto flex max-w-[1280px] gap-1 px-4 pb-2 sm:px-8" aria-hidden>
        {Array.from({ length: progress.of }, (_, i) => (
          <span key={i} className={`h-[3px] flex-1 rounded-full transition-colors duration-300 ${i <= progress.at ? 'bg-brass' : 'bg-line'}`} />
        ))}
      </div>
    )}
  </header>
);
