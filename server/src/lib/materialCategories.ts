// Mirrors the frontend's MaterialCategory union (minus 'all') — no shared
// package between the two projects, so this is a small deliberate duplication.
export const MATERIAL_CATEGORIES = [
  'tile',
  'sheet',
  'carpet',
  'wallpaper',
  'paint',
  'stone',
  'wood',
  'plaster',
  'metal',
  'fabric',
] as const;
