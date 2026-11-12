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
      // …down to the pickets' feet in the lawn's shade
      { include: [[1275, 800], [1310, 800], [1050, 800], [1283, 978], [1283, 980]], exclude: [[1255, 800], [1290, 800], [1327, 800], [1062, 800], [1500, 636], [1500, 642], [1500, 646]] },
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
  // Kitchen: warm cream paint in shadow is painted (it used to pass for brass and stay cream), the
  // brass knobs are not
  'kitchen/island': { include: [[1050, 815], [1052, 825], [1048, 835], [1055, 805], [1087, 650], [1087, 810], [383, 591], [250, 839], [1070, 839]], exclude: [[391, 590], [413, 590], [653, 590], [916, 590]] },
  'kitchen/tall-units': { include: [[1153, 395], [1155, 405], [1152, 485], [118, 678], [125, 680], [122, 690], [131, 696], [137, 696]], exclude: [[51, 231], [65, 231], [1264, 232], [1279, 232], [51, 491]] },
  'kitchen/wall-cabinets': { include: [[440, 145], [450, 145]], exclude: [[233, 372], [393, 372], [1083, 372], [1097, 372], [936, 372]] },
  'kitchen/canopy': { include: [[461, 242], [464, 266], [467, 340], [468, 340], [467, 450], [468, 450]] },
  'kitchen/splashback': { include: [[460, 450], [300, 430]], exclude: [[467, 450], [468, 450]] },
  // The island's bevelled corner is the island's, not the floor's
  'kitchen/floor': { include: [[1092, 810], [600, 860]], exclude: [[1087, 810], [1087, 760], [250, 839], [1070, 839]] },
  'kitchen/base-cabinets': { exclude: [[188, 571], [188, 635], [265, 523], [1139, 524], [1141, 635], [1065, 523]] },
  // Modern kitchen: the plain wall behind the worktop is splashback (one protect click took it as an
  // object once), the pampas grass, tap, pan and vase before it are not; the induction hob is not worktop
  'kitchen-modern/splashback': { include: [[700, 520], [200, 500], [1000, 560]], exclude: [[400, 520], [334, 610], [945, 620], [1300, 560]] },
  'kitchen-modern/worktop': { include: [[200, 690], [1400, 680], [700, 645]], exclude: [[880, 641], [945, 620]] },
  'kitchen-modern/base-cabinets': { include: [[880, 770], [430, 880], [1420, 900]] },
  // Galley: the hob, toaster and tap are not worktop; the fluted glass is not wall cabinet
  'kitchen-galley/worktop': { include: [[420, 1050], [1180, 900], [1200, 772]], exclude: [[680, 744], [533, 746], [1052, 712]] },
  // …the end box over the hood down to its foot, its side strip and the shelf under the hood are
  // (its steel front is not); the long upright drawer handle and the island's and pantry's brass
  // stay; the island starts at its narrow end door; the doorway's white architrave is no pantry
  'kitchen-galley/wall-cabinets': { include: [[390, 300], [670, 570], [725, 600], [740, 600], [690, 646]], exclude: [[560, 330], [696, 605]] },
  'kitchen-galley/base-cabinets': { include: [[650, 900]], exclude: [[684, 936]] },
  'kitchen-galley/island': { include: [[918, 790], [980, 850]], exclude: [[1010, 792], [951, 766]] },
  'kitchen-galley/tall-units': { include: [[840, 700], [975, 600]], exclude: [[782, 700], [858, 720], [800, 571]] },
  // The door's foot and the right wall's skirting are not floor
  'wardrobe/floor': { include: [[1500, 950], [800, 1000]], exclude: [[110, 995], [150, 962], [1540, 895], [1500, 860]] },
  // The door casing's plinth block is not wall
  'cabinet/wall': { include: [[250, 500]], exclude: [[155, 840]] },
  // The objects in the niche are not sideboard (the candle's right half and lid, the gnome's hat,
  // the glasses' rims, the cable down to them); the niche around them is
  'cabinet/sideboard': { include: [[700, 380], [790, 470], [450, 450]], exclude: [[764, 406], [760, 420], [760, 383], [665, 451], [718, 541], [716, 521], [760, 505], [785, 520]] },
  // The parquet in the shadow under the sideboard is floor, its black frame is not
  'cabinet/floor': { include: [[700, 772], [700, 780], [700, 788], [500, 785]], exclude: [[700, 759], [700, 761], [700, 799], [700, 801], [700, 803], [700, 804]] },
};
