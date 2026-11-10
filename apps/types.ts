import type { SceneCategory } from '../scenes/types';

// One customer app (Kitchen, Bathroom, Fencing): the same configurator, its own brand, scenes
// and steps. The build picks one with VITE_APP (apps/index.ts); each is its own Vercel project.

export type AppId = 'kitchen' | 'bathroom' | 'fencing';

/**
 * One question in the wizard. `style` offers that style group's baked designs as cards; `finish`
 * offers the finishes that fit every one of `itemIds` and applies the chosen one to all of them.
 * A step may ask both (a worktop's shape, then its material).
 */
export interface DesignStep {
  id: string;
  title: string;
  hint: string;
  style?: string;
  finish?: { itemIds: string[]; label?: string };
}

export interface AppConfig {
  id: AppId;
  // "Hollin" + "Kitchens" in the header
  brand: string;
  product: string;
  hero: { title: string; blurb: string; badges: string[]; cta: string };
  sceneIds: SceneCategory[];
  steps: DesignStep[];
  // Where "Request a quote" is addressed (empty: the customer's mail app picks)
  quoteEmail?: string;
}
