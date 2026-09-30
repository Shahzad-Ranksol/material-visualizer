import React from 'react';

/** "Still working — <step> (Cancel)", once a job has run past SLOW_JOB_MS. */
export const SlowJobNotice: React.FC<{ slow: boolean; label: string | null; onCancel: () => void }> = ({ slow, label, onCancel }) =>
  slow ? (
    <p data-testid="slow-job-notice" className="flex items-center gap-2 text-[11px] text-amber-300/90">
      {/* Stage labels already end in "…" */}
      Still working — {label ?? 'analysing the photo…'}
      <button type="button" onClick={onCancel} className="underline hover:text-amber-200">
        Cancel
      </button>
    </p>
  ) : null;
