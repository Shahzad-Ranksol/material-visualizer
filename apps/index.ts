import { appFor } from './registry';

/** The app this build is: VITE_APP=kitchen|bathroom|fencing (default kitchen). */
export const APP = appFor(import.meta.env.VITE_APP);
export type { AppConfig, AppId, DesignStep } from './types';
