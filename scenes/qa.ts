import { ColourRange } from './recipeMask';

// Accuracy checks for the baked items (tests/unit/bakedAccuracy.test.ts, scripts/sceneQa.ts),
// keyed `scene/item` for the scene's own bake and `scene/group--option/item` for a style's bake.
// Points are photo pixels, checked against where the item actually paints (its parts × (1 −
// occluder)), on the photo the customer sees (the composed photo for a style):
// - `include`: must be painted (alpha ≥ 0.5) — the item itself, its rails, caps and posts
// - `exclude`: must not be painted (alpha ≤ 0.1) — what is behind or in front of it
// - `foreign`: colours that are never the item; at most `maxForeign` of its painted pixels may be
//   one of them (a fence painted over the garden through its gaps, or over a tree)

export interface ItemQa {
  include?: Array<[number, number]>;
  exclude?: Array<[number, number]>;
  foreign?: ColourRange[];
  maxForeign?: number;
  // A known, explained shortfall: the check is expected to fail until it is fixed (and fails
  // the suite once it passes, so the note gets removed)
  knownIssue?: string;
}

// Garden and foliage: green in sun or shade, and near-black shadow deep in the leaves
const FOLIAGE: ColourRange[] = [{ hueMin: 65, hueMax: 170, minSat: 0.25, minValue: 0.1 }, { maxValue: 0.08 }];

// The original fence: the gaps between the street run's boards, its blue sign
const FRONT_EXCLUDE: Array<[number, number]> = [[1237, 800], [1253, 800], [1292, 800], [1306, 800], [1322, 800], [1165, 690]];
// The young tree's trunk before the side run, the air-conditioning unit before the back run, and
// the shed wall just above the back run
const GARDEN_EXCLUDE: Array<[number, number]> = [[826, 820], [828, 840], [100, 700], [105, 700], [200, 560], [100, 565], [300, 553]];

const fenceStyle = (front: Partial<ItemQa> = {}, garden: Partial<ItemQa> = {}) => ({
  'front-fence': { foreign: FOLIAGE, maxForeign: 0.005, ...front },
  'garden-fence': { foreign: FOLIAGE, maxForeign: 0.005, exclude: GARDEN_EXCLUDE, ...garden },
});

const styleEntries = (option: string, items: Record<string, ItemQa>) =>
  Object.fromEntries(Object.entries(items).map(([itemId, qa]) => [`fencing/fence--${option}/${itemId}`, qa]));

export const SCENE_QA: Record<string, ItemQa> = {
  'fencing/front-fence': {
    include: [[1270, 800], [1300, 800], [980, 760], [1000, 760], [1400, 680], [1205, 700], [1400, 940], [1520, 920]],
    exclude: FRONT_EXCLUDE,
    foreign: FOLIAGE,
    maxForeign: 0.005,
  },
  'fencing/garden-fence': {
    include: [[200, 620], [350, 650], [520, 650], [470, 640], [700, 700], [860, 700]],
    exclude: GARDEN_EXCLUDE,
    foreign: FOLIAGE,
    maxForeign: 0.005,
  },
  // Picket: the lawn between the pickets stays the lawn, the pickets are painted — on the back run
  // too, where the gaps show the shed's pale wall
  ...styleEntries(
    'picket',
    fenceStyle(
      { include: [[1275, 800], [1310, 800], [1050, 800]], exclude: [[1255, 800], [1290, 800], [1327, 800], [1062, 800]] },
      {
        include: [[90, 605], [111, 605], [131, 605]],
        exclude: [...GARDEN_EXCLUDE, [99, 605], [120, 605], [140, 605]],
        knownIssue:
          'on the back run the gaps between the AI pickets show the shed wall, the same pale beige as the pickets (hue 35–42°, sat 0.33), so colour cannot separate them; needs a hand edit in /dev/scenes or a re-generated candidate',
      }
    )
  ),
  // Closeboard: its new pale capping rail over the corner run is part of the fence, and so is the
  // back run the AI left as cedar
  ...styleEntries('closeboard', fenceStyle({ include: [[1000, 630], [1100, 640], [1000, 700]] }, { include: [[200, 620], [350, 650]] })),
  ...styleEntries('horizontal-slat', fenceStyle()),
  ...styleEntries('lattice-top', fenceStyle()),
  // The door's foot and the right wall's skirting are not floor
  'wardrobe/floor': { include: [[1500, 950], [800, 1000]], exclude: [[110, 995], [150, 962], [1540, 895], [1500, 860]] },
  // The door casing's plinth block is not wall
  'cabinet/wall': { include: [[250, 500]], exclude: [[155, 840]] },
};
