import React from 'react';
import { Link } from 'react-router-dom';
import { APP } from '../../apps';

interface Props {
  // Where you are ("Step 2 of 6"), shown with the progress
  note?: string;
  // Progress through the steps, drawn as segments under the bar
  progress?: { at: number; of: number };
  // No progress yet (the front page), but keep its row's room so the content lines up with the steps'
  reserveProgress?: boolean;
}

/**
 * The app's header, the same in every app: its wordmark (the brand in the display serif over its
 * product line in spaced capitals), the menu on the right, and on a step the progress under it.
 */
export const BrandBar: React.FC<Props> = ({ note, progress, reserveProgress }) => (
  <header className="sticky top-0 z-30 bg-paper/95 backdrop-blur supports-[backdrop-filter]:bg-paper/85">
    <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 pb-3 pt-4 sm:px-8 sm:pt-6">
      <Link to="/" className="flex flex-col leading-none" aria-label={`${APP.brand} ${APP.product}, home`} data-testid="brand">
        <span className="font-serif text-[21px] font-semibold tracking-[-0.005em] text-spruce sm:text-[26px]">{APP.brand}</span>
        <span className="mt-1 text-[9.5px] font-medium uppercase tracking-[0.2em] text-spruce-soft sm:text-[11px]">{APP.product}</span>
      </Link>
      {APP.nav?.length ? (
        <nav aria-label="Main" className="flex items-center gap-4 sm:gap-10">
          {APP.nav.map((item) => (
            <span
              key={item.label}
              aria-current={item.current ? 'page' : undefined}
              className={`whitespace-nowrap text-[10.5px] font-medium uppercase tracking-[0.14em] sm:text-[12.5px] ${item.current ? 'text-spruce' : 'text-spruce-soft'}`}
            >
              {item.label}
            </span>
          ))}
        </nav>
      ) : (
        note && <StepNote note={note} />
      )}
    </div>
    {/* The front page keeps the progress row's room, empty, so its picture sits where the steps' does */}
    {reserveProgress && !progress && (
      <div aria-hidden className="invisible mx-auto hidden max-w-[1600px] items-center gap-3 px-4 pb-2.5 sm:px-8 lg:flex">
        <span className="h-[3px] flex-1" />
        {APP.nav?.length ? <span className="shrink-0 text-[12.5px] tabular-nums">Step</span> : null}
      </div>
    )}
    {progress && (
      <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 pb-2.5 sm:px-8">
        <div className="flex flex-1 gap-1" aria-hidden>
          {Array.from({ length: progress.of }, (_, i) => (
            <span key={i} className={`h-[3px] flex-1 rounded-full transition-colors duration-300 ${i <= progress.at ? 'bg-brass' : 'bg-line'}`} />
          ))}
        </div>
        {note && APP.nav?.length ? <StepNote note={note} /> : null}
      </div>
    )}
  </header>
);

const StepNote: React.FC<{ note: string }> = ({ note }) => (
  <span className="shrink-0 text-[12.5px] tabular-nums text-spruce-soft" data-testid="step-note">
    {note}
  </span>
);
