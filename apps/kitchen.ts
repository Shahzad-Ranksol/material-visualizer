import { AppConfig } from './types';

// The painted fronts across the three layouts (a step offers only the items its scene has)
const FRONTS = ['wall-cabinets', 'tall-units', 'canopy', 'base-cabinets', 'island'];

export const KITCHEN_APP: AppConfig = {
  id: 'kitchen',
  brand: 'Hollin',
  product: 'Kitchens',
  hero: {
    title: 'Design your dream kitchen',
    blurb: 'Choose your layout, door style, colour, worktop and splashback and see them on a real kitchen as you go. Then share your design or ask for a quote.',
    badges: ['Free design visit', 'No obligation', 'Takes a minute'],
    cta: 'Start designing',
  },
  // Step 1 is "Choose your layout": the Classic, Modern and Galley kitchens
  sceneIds: ['kitchen', 'kitchen-modern', 'kitchen-galley'],
  steps: [
    { id: 'doors', title: 'Pick your doors', hint: 'The door style sets the look of every cabinet.', style: 'kitchen-doors' },
    // Paints only: the same palette on all three layouts, no wood veneers
    { id: 'colour', title: 'Choose a colour', hint: 'Paints for the doors and drawers.', finish: { itemIds: FRONTS, label: 'Colour', exclude: ['wood'] } },
    { id: 'panels', title: 'Accent panels', hint: 'The oak end panels: keep them oak or match the doors.', finish: { itemIds: ['end-panel'] } },
    { id: 'worktop', title: 'Choose a worktop', hint: 'Pick a profile, then the material.', style: 'kitchen-worktop', finish: { itemIds: ['worktop'], label: 'Material' } },
    { id: 'splashback', title: 'Add a splashback', hint: 'Tiles or a single slab behind the hob and sink.', style: 'kitchen-splashback', finish: { itemIds: ['splashback'], label: 'Material' } },
    { id: 'floor', title: 'Finish the floor', hint: 'Keep it as it is or try another floor.', finish: { itemIds: ['floor'] } },
  ],
};
