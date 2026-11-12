import { AppConfig } from './types';

// Fencing changes the fence's design only: no colour or finish step
export const FENCING_APP: AppConfig = {
  id: 'fencing',
  brand: 'Hollin',
  product: 'Fencing',
  hero: {
    title: 'Design your new fence',
    blurb: 'See slatted, closeboard, picket and lattice-top fences on a real garden before you choose. Then share your design or ask for a quote.',
    badges: ['Free site survey', 'No obligation', 'Takes a minute'],
    cta: 'Start designing',
  },
  sceneIds: ['fencing'],
  steps: [{ id: 'style', title: 'Pick a fence style', hint: 'Tap a style to see it along the whole boundary.', style: 'fence' }],
};
