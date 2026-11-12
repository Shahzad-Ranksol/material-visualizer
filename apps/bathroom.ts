import { AppConfig } from './types';

// The bathroom scene arrives with the client's render: until it is in scenes/scenes.ts and
// baked, the app shows its intro with "coming soon". Item ids below are the ones to trace
// (scenes/scenes.ts) and the style groups the ones to generate (scenes/styles.ts)
export const BATHROOM_APP: AppConfig = {
  id: 'bathroom',
  brand: 'Hollin',
  product: 'Bathrooms',
  hero: {
    title: 'Design your new bathroom',
    blurb: 'Choose your vanity, tiles and finishes and see them on a real bathroom as you go. Then share your design or ask for a quote.',
    badges: ['Free design visit', 'No obligation', 'Takes a minute'],
    cta: 'Start designing',
  },
  sceneIds: ['bathroom'],
  steps: [
    { id: 'vanity', title: 'Pick your vanity', hint: 'The vanity unit sets the look of the room.', style: 'bathroom-vanity', finish: { itemIds: ['vanity'], label: 'Finish' } },
    { id: 'wall-tiles', title: 'Choose wall tiles', hint: 'The tile layout, then its material.', style: 'bathroom-wall-tiles', finish: { itemIds: ['wall-tiles'], label: 'Material' } },
    { id: 'floor', title: 'Choose a floor', hint: 'Tiles or stone underfoot.', style: 'bathroom-floor', finish: { itemIds: ['floor'], label: 'Material' } },
    { id: 'walls', title: 'Paint the walls', hint: 'The plain walls above the tiles.', finish: { itemIds: ['walls'] } },
  ],
};
