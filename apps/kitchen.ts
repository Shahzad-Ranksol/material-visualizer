import { AppConfig } from './types';

// The painted fronts across the three layouts (a step offers only the items its scene has)
const FRONTS = ['wall-cabinets', 'tall-units', 'canopy', 'base-cabinets', 'island'];

export const KITCHEN_APP: AppConfig = {
  id: 'kitchen',
  brand: 'Native Coast',
  product: 'Kitchen Appliances',
  noun: 'kitchen',
  nav: [{ label: 'Layout Designer', current: true }],
  hero: {
    title: 'Design your dream kitchen',
    blurb: 'Choose your layout, door style, colour and worktop and see them on a real kitchen as you go. Then download your design or ask for a quote.',
    badges: ['Free design visit', 'No obligation', 'Takes a minute'],
    cta: 'Start designing',
  },
  // Step 1 is "Choose your layout": the Classic, Modern and Galley kitchens
  sceneIds: ['kitchen', 'kitchen-modern', 'kitchen-galley'],
  // No splashback or floor step: the client keeps those as shown
  fixedItems: ['splashback', 'floor'],
  steps: [
    { id: 'doors', title: 'Pick your doors', hint: 'The door style sets the look of every cabinet.', style: 'kitchen-doors' },
    // Paints only: the same palette on all three layouts, no wood veneers
    { id: 'colour', title: 'Choose a colour', hint: 'Paints for the doors and drawers.', finish: { itemIds: FRONTS, label: 'Colour', exclude: ['wood', 'kit-pure-white'] } },
    { id: 'panels', title: 'Accent panels', hint: 'The oak end panels: keep them oak or match the doors.', finish: { itemIds: ['end-panel'] } },
    { id: 'worktop', title: 'Choose a worktop', hint: 'Pick a profile, then the material.', style: 'kitchen-worktop', finish: { itemIds: ['worktop'], label: 'Material' } },
  ],
};
