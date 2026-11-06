import { CEDAR } from './scenes';
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
  // The new material, in place of the shared "light, neutral, unfinished" one — where the finish
  // must be told apart from what shows through the design (pickets before a beige shed wall)
  material?: string;
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

// A redesigned fence is keyed by its new material's colour, which the prompt asks to be light and
// neutral: pale wood in sun and shade (hue up to ~60°, never strongly saturated), off-white, and
// in the shade by the lawn a pale grey with a green cast. Runs the AI left as they were keep the
// original cedar. The garden through the gaps (saturated or dark green) and the tree before the
// side run drop out; small knots and glare are refilled. Pale walls seen through gaps can't be
// told from pale boards by colour — check those runs in the QA sheets
const PALE_WOOD = { hueMin: 8, hueMax: 60, minSat: 0.1, maxSat: 0.62, minValue: 0.2 };
const PALE_ALSO = [
  { hueMin: 60, hueMax: 68, maxSat: 0.32, minValue: 0.25 },
  { hueMin: 60, hueMax: 100, maxSat: 0.2, minValue: 0.45 },
  // The boards' feet in the lawn's shade: greyer and greener still (hue to 115°, value from 0.38)
  // — shaded lawn is darker or more saturated, sunlit lawn far more saturated
  { hueMin: 60, hueMax: 115, maxSat: 0.17, minValue: 0.38 },
  { maxSat: 0.1, minValue: 0.4 },
];
export const PALE_TIMBER = { ...PALE_WOOD, also: [...PALE_ALSO, ...CEDAR.also, { ...CEDAR, also: undefined }] };

// Picket redraws every run, so nothing is left as cedar, and its gaps show the dark garden and
// old fence: pale only (no cedar fallback), never darker than its own shaded feet (value 0.39+),
// and only small specks refilled — a 12 px refill closed the dark gaps between the picket tips
export const PALE_PICKET = {
  ...PALE_WOOD,
  minValue: 0.33,
  maxHole: 6,
  also: PALE_ALSO.map((r) => ({ ...r, minValue: Math.max(r.minValue, 0.33) })),
};
const pale = { keepColour: PALE_TIMBER, intersectCut: false };
// The AI redraws the air-conditioning unit before the back run as a pale box, the colour of the
// new boards: it is cut out by shape (photo px of the 1600 × 1280 fencing photo)
const fpx = (x: number, y: number) => ({ xPct: x / 1600, yPct: y / 1280 });
const AC_UNIT = { points: [fpx(68, 618), fpx(100, 612), fpx(115, 630), fpx(115, 742), fpx(68, 742)], snap: false };
const fenceOverrides = { 'front-fence': pale, 'garden-fence': { ...pale, subtract: [AC_UNIT] } };

// Picket's primed off-white, in sun and shade: unsaturated (the beige shed wall and the cedar gate
// are saturation 0.3+, the lawn more), only a slight green cast in the shade by the lawn
export const PRIMER_WHITE = { maxSat: 0.17, minValue: 0.3, also: [{ hueMin: 60, hueMax: 110, maxSat: 0.2, minValue: 0.4 }] };
const primed = { keepColour: PRIMER_WHITE, intersectCut: false };
// The committed Picket design predates the primer prompt: its pickets are pale wood, so it is keyed
// as pale wood until a primed design is generated and picked in /dev/styles (then use `primed`)
void primed;
const palePicket = { keepColour: PALE_PICKET, intersectCut: false };
const picketOverrides = { 'front-fence': palePicket, 'garden-fence': { ...palePicket, subtract: [AC_UNIT] } };

export const STYLE_OPTIONS: StyleOption[] = [
  // Fencing
  { id: 'horizontal-slat', groupId: 'fence', label: 'Horizontal slat', prompt: 'a contemporary horizontal slatted timber fence, 90 mm slats with 10 mm gaps, square posts', recipeOverrides: fenceOverrides },
  { id: 'closeboard', groupId: 'fence', label: 'Closeboard', prompt: 'a traditional closeboard fence of overlapping vertical feather-edge boards with a top capping rail', recipeOverrides: fenceOverrides },
  {
    id: 'picket',
    groupId: 'fence',
    label: 'Picket',
    prompt: 'a classic picket fence with pointed vertical pickets and even gaps showing the garden behind',
    // The back run's gaps show the shed's beige wall: pale wood pickets match it exactly, so the
    // pickets are primed a cool off-white that the bake can tell from it by colour
    material:
      'Paint every picket, rail and post in a flat, cool off-white primer (neutral grey-white, no beige or yellow, no wood colour) — clearly whiter and greyer than the warm beige shed wall seen through the gaps.',
    recipeOverrides: picketOverrides,
  },
  { id: 'lattice-top', groupId: 'fence', label: 'Lattice top', prompt: 'a solid vertical-board fence topped with a 30 cm diagonal lattice trellis panel', recipeOverrides: fenceOverrides },

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
    option.material ?? 'Make it a light, neutral, unfinished material (pale natural wood or matt off-white) — no strong colour.',
    'Keep the exact camera, perspective, scale and lighting of the photo; keep every shadow direction.',
    'Change nothing outside the masked area. Objects in front of the area (plants, lamps, vases, knobs on other items) must stay exactly as they are.',
    'Photorealistic, like a professional interior or architectural photograph.',
  ].join(' ');

export const groupsFor = (sceneId: string) => STYLE_GROUPS.filter((g) => g.sceneId === sceneId);
export const optionsFor = (groupId: string) => STYLE_OPTIONS.filter((o) => o.groupId === groupId);
export const groupOfItem = (sceneId: string, itemId: string) => STYLE_GROUPS.find((g) => g.sceneId === sceneId && g.itemIds.includes(itemId));
export const styleKey = (groupId: string, optionId: string) => `${groupId}--${optionId}`;
