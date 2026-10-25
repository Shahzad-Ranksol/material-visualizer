import { BakeRecipe, SceneCategory } from './types';

// Design styles: whole-item redesigns (another fence type, another door style) generated once,
// offline, by an image AI inside the item's area (/dev/styles), curated, blended seamlessly and
// shipped as patches. Customers pick a style, then a finish for it, as for any item.

export interface StyleGroup {
  id: string;
  sceneId: SceneCategory;
  label: string;
  // The scene items the style replaces (their union is the area the AI may change)
  itemIds: string[];
}

export interface StyleOption {
  id: string;
  groupId: string;
  label: string;
  // What the AI is asked for. Every prompt also gets the shared instructions in
  // `generationPrompt`: same camera, same light, only inside the masked area, neutral finish
  prompt: string;
  // Per-item recipe changes for baking this style (a picket fence's gaps)
  recipeOverrides?: Record<string, Partial<BakeRecipe>>;
}

/** The option every group starts with: the scene as photographed. */
export const ORIGINAL = 'original';

export const STYLE_GROUPS: StyleGroup[] = [
  { id: 'fence', sceneId: 'fencing', label: 'Fence style', itemIds: ['front-fence', 'garden-fence'] },
  { id: 'kitchen-doors', sceneId: 'kitchen', label: 'Door style', itemIds: ['wall-cabinets', 'tall-units', 'base-cabinets', 'island'] },
  { id: 'kitchen-worktop', sceneId: 'kitchen', label: 'Worktop', itemIds: ['worktop'] },
  { id: 'kitchen-splashback', sceneId: 'kitchen', label: 'Splashback', itemIds: ['splashback'] },
  { id: 'media-panel', sceneId: 'media-wall', label: 'Feature wall', itemIds: ['feature-panel'] },
  { id: 'wardrobe-doors', sceneId: 'wardrobe', label: 'Door style', itemIds: ['doors'] },
  { id: 'sideboard-fronts', sceneId: 'cabinet', label: 'Front style', itemIds: ['sideboard'] },
];

// A fence with gaps (slats, pickets, lattice) shows the garden through them: on the new design the
// green seen through the gaps — and the tree before the garden run — is kept out by its colour
const FENCE_AREA = [[{ xPct: 0, yPct: 0.3 }, { xPct: 1, yPct: 0.3 }, { xPct: 1, yPct: 0.85 }, { xPct: 0, yPct: 0.85 }]];
const gappy = { protectColour: [{ region: FENCE_AREA, hueMin: 65, hueMax: 170, minSat: 0.22 }] };

export const STYLE_OPTIONS: StyleOption[] = [
  // Fencing
  { id: 'horizontal-slat', groupId: 'fence', label: 'Horizontal slat', prompt: 'a contemporary horizontal slatted timber fence, 90 mm slats with 10 mm gaps, square posts', recipeOverrides: { 'front-fence': gappy, 'garden-fence': gappy } },
  { id: 'closeboard', groupId: 'fence', label: 'Closeboard', prompt: 'a traditional closeboard fence of overlapping vertical feather-edge boards with a top capping rail' },
  { id: 'picket', groupId: 'fence', label: 'Picket', prompt: 'a classic picket fence with pointed vertical pickets and even gaps showing the garden behind', recipeOverrides: { 'front-fence': gappy, 'garden-fence': gappy } },
  { id: 'lattice-top', groupId: 'fence', label: 'Lattice top', prompt: 'a solid vertical-board fence topped with a 30 cm diagonal lattice trellis panel', recipeOverrides: { 'front-fence': gappy, 'garden-fence': gappy } },

  // Kitchen
  { id: 'slab', groupId: 'kitchen-doors', label: 'Slab', prompt: 'flat slab cabinet doors and drawer fronts with no frame or panel, thin shadow gaps between doors, keep the same handles' },
  { id: 'fluted', groupId: 'kitchen-doors', label: 'Fluted', prompt: 'cabinet doors with fine vertical fluted reeding across the whole front, drawer fronts plain, keep the same handles' },
  { id: 'thick-stone', groupId: 'kitchen-worktop', label: 'Thick stone', prompt: 'a 40 mm thick stone worktop with a square edge in place of the timber worktop' },
  { id: 'herringbone-tile', groupId: 'kitchen-splashback', label: 'Herringbone tile', prompt: 'a herringbone pattern of small rectangular tiles with thin grout lines' },
  { id: 'zellige', groupId: 'kitchen-splashback', label: 'Zellige', prompt: 'handmade square zellige tiles with uneven glaze and soft edges' },
  { id: 'full-slab', groupId: 'kitchen-splashback', label: 'Full-height slab', prompt: 'a single seamless stone slab splashback with no grout lines' },

  // Media wall
  { id: 'wide-slats', groupId: 'media-panel', label: 'Wide slats', prompt: 'wide 60 mm vertical timber slats with deep shadow gaps' },
  { id: 'stone-slab', groupId: 'media-panel', label: 'Stone slab', prompt: 'one large book-matched stone slab panel with a flush edge' },
  { id: 'panelled', groupId: 'media-panel', label: 'Panelled', prompt: 'a flat wall with a grid of shallow rectangular wall panelling mouldings' },

  // Wardrobe
  { id: 'slab', groupId: 'wardrobe-doors', label: 'Slab', prompt: 'flat slab wardrobe doors with no frame or panel, keep the two mirrors and the bar handles' },
  { id: 'shaker', groupId: 'wardrobe-doors', label: 'Shaker', prompt: 'shaker-style wardrobe doors with a recessed centre panel and simple frame, keep the two mirrors and the bar handles' },

  // Sideboard
  { id: 'fluted', groupId: 'sideboard-fronts', label: 'Fluted', prompt: 'fine vertical fluted reeding across all sideboard doors and drawer fronts, keep the open niche' },
  { id: 'cane', groupId: 'sideboard-fronts', label: 'Rattan cane', prompt: 'sideboard doors with woven rattan cane panels set in a slim frame, keep the open niche' },
];

/**
 * The full instruction sent with a photo and a mask. Styles are generated in a light, neutral,
 * unfinished material so the studio's finishes can then be applied on top under the room's light.
 */
export const generationPrompt = (option: StyleOption, group: StyleGroup): string =>
  [
    `Edit this photo: replace only the ${group.label.toLowerCase()} inside the masked area with ${option.prompt}.`,
    'Make it a light, neutral, unfinished material (pale natural wood or matt off-white) — no strong colour.',
    'Keep the exact camera, perspective, scale and lighting of the photo; keep every shadow direction.',
    'Change nothing outside the masked area. Objects in front of the area (plants, lamps, vases, knobs on other items) must stay exactly as they are.',
    'Photorealistic, like a professional interior or architectural photograph.',
  ].join(' ');

export const groupsFor = (sceneId: string) => STYLE_GROUPS.filter((g) => g.sceneId === sceneId);
export const optionsFor = (groupId: string) => STYLE_OPTIONS.filter((o) => o.groupId === groupId);
export const groupOfItem = (sceneId: string, itemId: string) => STYLE_GROUPS.find((g) => g.sceneId === sceneId && g.itemIds.includes(itemId));
export const styleKey = (groupId: string, optionId: string) => `${groupId}--${optionId}`;
