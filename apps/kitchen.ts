import { AppConfig } from './types';

const FRONTS = ['wall-cabinets', 'tall-units', 'canopy', 'base-cabinets', 'island'];

export const KITCHEN_APP: AppConfig = {
  id: 'kitchen',
  brand: 'Hollin',
  product: 'Kitchens',
  hero: {
    title: 'Design your dream kitchen',
    blurb: 'Choose your door style, colour, worktop and splashback and see them on a real kitchen as you go. Then share your design or ask for a quote.',
    badges: ['Free design visit', 'No obligation', 'Takes a minute'],
    cta: 'Start designing',
  },
  sceneIds: ['kitchen'],
  steps: [
    { id: 'doors', title: 'Pick your doors', hint: 'The door style sets the look of every cabinet.', style: 'kitchen-doors' },
    { id: 'colour', title: 'Choose a colour', hint: 'Lacquers and veneers for the doors, drawers and canopy.', finish: { itemIds: FRONTS, label: 'Colour' } },
    { id: 'worktop', title: 'Choose a worktop', hint: 'Pick a profile, then the material.', style: 'kitchen-worktop', finish: { itemIds: ['worktop'], label: 'Material' } },
    { id: 'splashback', title: 'Add a splashback', hint: 'Tiles or a single slab behind the hob and sink.', style: 'kitchen-splashback', finish: { itemIds: ['splashback'], label: 'Material' } },
    { id: 'floor', title: 'Finish the floor', hint: 'Keep it as it is or try another floor.', finish: { itemIds: ['floor'] } },
  ],
};
