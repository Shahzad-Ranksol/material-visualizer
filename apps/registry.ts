import { BATHROOM_APP } from './bathroom';
import { FENCING_APP } from './fencing';
import { KITCHEN_APP } from './kitchen';
import { AppConfig, AppId } from './types';

// Plain data, no browser APIs: also read by vite.config.ts to ship only the app's scenes
export const APPS: Record<AppId, AppConfig> = { kitchen: KITCHEN_APP, bathroom: BATHROOM_APP, fencing: FENCING_APP };

export const appFor = (id: string | undefined): AppConfig => {
  const app = APPS[(id || 'kitchen') as AppId];
  if (!app) throw new Error(`Unknown VITE_APP "${id}" — use one of ${Object.keys(APPS).join(', ')}`);
  return app;
};
