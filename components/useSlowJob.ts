import { useEffect, useRef, useState } from 'react';
import { createSlowJob, SlowJobState } from '../services/slowJob';

/** A screen's analysis job (see services/slowJob.ts); cancelled when the screen unmounts. */
export const useSlowJob = () => {
  const [state, setState] = useState<SlowJobState>({ slow: false, label: null });
  const job = useRef<ReturnType<typeof createSlowJob> | null>(null);
  if (!job.current) job.current = createSlowJob(setState);
  useEffect(() => () => job.current!.cancel(), []);
  return { ...state, start: job.current.start, cancel: job.current.cancel, finish: job.current.finish };
};
