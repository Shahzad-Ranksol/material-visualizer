import { PctPoint, Scene, SceneCategory } from './types';
import photos from './photos.json';
import { assetUrl } from './assetUrl';

// The five preset scenes and the items a customer can re-finish in each. Coordinates are
// fractions of the photo. Each item's `recipe` is what /dev/scenes runs to bake it.

const p = (xPct: number, yPct: number): PctPoint => ({ xPct, yPct });
const rect = (x0: number, y0: number, x1: number, y1: number): PctPoint[] => [p(x0, y0), p(x1, y0), p(x1, y1), p(x0, y1)];

// Pixel coordinates on a photo of the given size, for outlines traced on the photo itself
const px = (w: number, h: number) => (x: number, y: number): PctPoint => ({ xPct: x / w, yPct: y / h });
const W = px(1600, 1067); // wardrobe photo
const K = px(1344, 885); // the client's kitchen render
const U = px(1600, 1136); // the client's modern U-shaped kitchen render
const G = px(1600, 1280); // the client's galley kitchen render

// The kitchen island: its oak top (seen from slightly above) and its painted body
const ISLAND_TOP = [K(300, 524), K(1020, 524), K(1097, 548), K(1097, 560), K(231, 560), K(231, 548)];
// Traced exactly, not snapped: snapping pulled the right side onto the strong edge at x 1085 and
// left the 3 px highlight on the island's bevelled corner (x 1086–1088) out of the island, and in
// the floor beside it
const ISLAND_BODY = [K(242.5, 560), K(1089, 560), K(1089, 838.5), K(242.5, 838.5)];
const ISLAND_SHAPE = { points: ISLAND_BODY, snap: false };
// Its two feet stand 2 px lower than the plinth between them (to y 840, photo px)
const ISLAND_FEET = [
  { points: [K(243.5, 838), K(276, 838), K(276, 840.5), K(243.5, 840.5)], snap: false },
  { points: [K(1058, 838), K(1089, 838), K(1089, 840.5), K(1058, 840.5)], snap: false },
];

// A pendant's white dome as an exact shape: a half-ellipse over its rim (photo px)
const dome = (cx: number, rimY: number, rx: number, ry: number, rimDepth: number): PctPoint[] => {
  const pts: PctPoint[] = [];
  for (let k = 0; k <= 32; k++) {
    const t = Math.PI + (Math.PI * k) / 32;
    pts.push(K(cx + rx * Math.cos(t), rimY + ry * Math.sin(t)));
  }
  for (let k = 1; k < 16; k++) {
    const t = (Math.PI * k) / 16;
    pts.push(K(cx + rx * Math.cos(t), rimY + rimDepth * Math.sin(t)));
  }
  return pts;
};
// The brass knobs and cup handles, by colour: saturated gold against cream paint, compact pieces
// only (the panel grooves' warm shadows share the hue but are long thin lines)
// (minArea: the smallest knob in that item, in px — larger drops more groove-corner specks)
// Brass knobs and cup handles: warm and saturated. A blob must have a saturated core (≥ 10% of
// its pixels at sat ≥ 0.55; the palest knob has 12%, the kitchen's knobs mostly 30–85%): warm
// cream paint in shadow reaches sat 0.3–0.45 at an inside corner, a bracket or the island's foot,
// and without the core test those patches were kept as "brass" and stayed unpainted
const brass = (region: PctPoint[][], minArea = 22) => ({
  region,
  hueMin: 15,
  hueMax: 60,
  minSat: 0.38,
  blobs: { minArea, maxArea: 700, maxAspect: 3, core: { minSat: 0.55, minShare: 0.1 } },
  // Each knob is then only its own brass (sat 0.15 above the paint around it, highlights inside it
  // filled), not grown: the cream paint in its shadow and a grown ring stayed cream around a
  // painted knob
  trim: 0.15,
});

// Wardrobe handles: a box around each aluminium bar (photo px, a pixel of margin), searched by colour
const box = (x0: number, y0: number, x1: number, y1: number): PctPoint[] => [W(x0 - 1, y0 - 1), W(x1 + 1, y0 - 1), W(x1 + 1, y1 + 1), W(x0 - 1, y1 + 1)];
const WARDROBE_HANDLES = [
  // Tall doors
  box(447.5, 480, 451.5, 588), box(468.5, 480, 473.5, 588), box(637, 480, 642, 588),
  box(944, 481, 948.5, 600), box(963, 481, 967.5, 600), box(1132.5, 481, 1137, 600),
  // Top boxes
  box(449, 115, 455, 168), box(609, 115, 616, 168), box(637, 115, 644, 168),
  box(939, 115, 944, 168), box(1100, 115, 1106, 168), box(1126, 115, 1133, 168),
  // Drawers
  ...[708.5, 762.5, 816.5].flatMap((y) => [box(489, y - 2.5, 600, y + 2.5), box(986, y - 2.5, 1097, y + 2.5)]),
];

// A small exact ellipse (photo px) — the right larder's sunlit knobs, too pale for the colour rule
const knob = (cx: number, cy: number, rx = 5, ry = 4.5): PctPoint[] =>
  Array.from({ length: 16 }, (_, k) => K(cx + rx * Math.cos((Math.PI * k) / 8), cy + ry * Math.sin((Math.PI * k) / 8)));

// The galley's downlights under its wall cabinets and the objects standing before its tall unit and
// in its island top (photo px, a pixel or two of margin): kept as the photo's own pixels
const gEllipse = (cx: number, cy: number, rx: number, ry: number): PctPoint[] =>
  Array.from({ length: 16 }, (_, k) => G(cx + rx * Math.cos((Math.PI * k) / 8), cy + ry * Math.sin((Math.PI * k) / 8)));
const GALLEY_DOWNLIGHTS = [gEllipse(477.5, 563, 15, 4.5), gEllipse(551, 593.5, 12, 4), gEllipse(596, 611.5, 10, 3.5), gEllipse(626, 623.5, 7, 3)];
// The end box's top: flat to x 697, then its rounded corner down the right side to y 467 (traced row
// by row against the wall behind; a square corner painted the wall and the ceiling's edge)
const GALLEY_END_BOX_TOP = [G(697, 381.5), G(705, 384), G(709, 390), G(712.5, 400), G(716.5, 410), G(720.5, 420), G(726, 435), G(732, 450), G(736, 467)];
// Where the splashback's tile meets the worktop, left to right (from x 310 the window frame's foot):
// a wavy line, traced at 5× from the shadow under the tile
const GALLEY_BACK_EDGE = [G(280, 815), G(300, 811), G(310, 810), G(320, 809), G(370, 801), G(390, 794), G(420, 788), G(460, 782.4), G(500, 776), G(520, 774), G(600, 755), G(700, 735)];
// The floor's back edge right of the island: under the skirting, the curtain's foot and the window
// wall's white skirting, traced column by column (a straight line painted over the curtain and skirting)
const GALLEY_FLOOR_BACK = [G(1331, 843.5), G(1360, 845.5), G(1400, 851), G(1430, 857), G(1448, 857.5), G(1470, 862), G(1487, 863), G(1495, 865.5), G(1520, 871), G(1550, 877), G(1565, 881), G(1580, 884), G(1600, 888.5)];
// The oak shelf under the cooker hood (the wall cabinets', not the splashback's) and its downlights
const GALLEY_HOOD_SHELF = [G(664, 642), G(700, 642), G(744, 659), G(744, 671), G(725, 671), G(700, 662), G(664, 651)];
const GALLEY_HOOD_LIGHTS = [gEllipse(699, 654, 6, 2.5), gEllipse(713, 659, 5, 2.5), gEllipse(723, 663, 4.5, 2.5), gEllipse(729, 666, 4, 2)];
const gBox = (x0: number, y0: number, x1: number, y1: number): PctPoint[] => [G(x0, y0), G(x1, y0), G(x1, y1), G(x0, y1)];
// The pantry's two bar handles and its four small knobs, each pixel-tight
const GALLEY_PANTRY_HANDLES = [
  gBox(855.6, 712.5, 859.6, 729.8), gBox(860.6, 712.5, 863.8, 729.8),
  gBox(815.5, 627.6, 817.8, 630.8), gBox(818.6, 627.6, 820.8, 630.8), gBox(856.4, 627.6, 858.6, 630.8), gBox(859.6, 627.6, 862.4, 630.8),
];
// A thin bar along a segment (photo px), `half` px either side: the island's far bar handles, seen
// edge-on, run into the door gaps as one colour and the colour rule can't single them out
const gBar = (x0: number, y0: number, x1: number, y1: number, half = 2): PctPoint[] => {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const [nx, ny] = [(-(y1 - y0) / len) * half, ((x1 - x0) / len) * half];
  return [G(x0 + nx, y0 + ny), G(x1 + nx, y1 + ny), G(x1 - nx, y1 - ny), G(x0 - nx, y0 - ny)];
};
const GALLEY_ISLAND_HANDLES = [gBar(917, 748.5, 923, 750.5), gBar(932, 744, 950, 751), gBar(927, 752, 932, 754), gBar(950, 750.5, 965, 756.5), gBar(939, 760, 963, 771.5)];
const GALLEY_BOWL = [G(993, 712), G(1040, 712), G(1039, 720), G(1035, 728), G(1028, 734), G(1026, 741), G(1004, 741), G(1003, 735), G(998, 728), G(994, 720)];
// The tap's swan neck where it crosses the tall unit (right of x 1048 it is before the window)
const GALLEY_TAP = [G(1018, 714), G(1019, 704), G(1023, 702), G(1023, 688), G(1025, 681), G(1030, 676), G(1036, 674), G(1049, 674), G(1049, 683), G(1037, 683), G(1033, 686), G(1031, 692), G(1031, 702), G(1030, 714)];
const GALLEY_SINK = [G(988, 750), G(1050, 750), G(1059, 758), G(1003, 758)];
// The toaster's wire handle and the twig in the vase on the splashback, kept by colour (softProtect)
const GALLEY_THIN = [[[G(532, 715), G(550, 715), G(550, 730), G(532, 730)]], [[G(683, 702), G(693, 675), G(703, 675), G(694, 702)]]];

const PENDANTS = [dome(488, 230, 63.5, 66, 6), dome(843, 230, 63.5, 66, 6)];

const C = px(1600, 1067); // sideboard photo
const F = px(1600, 1280); // fencing photo
// The fence's cedar in sun and shade (hue 15–35°): the garden through the gaps is yellow-green
// (hue 43°+) or grey, the tree's trunk and leaves green or near-black, the sign blue. Sunlit
// garden glimpsed through a gap can be pale cream, so the brightest pixels must be more saturated;
// the weathered bottom rails are greyer but redder (hue ≤ 30°)
export const CEDAR = {
  // The street run's gaps are 2–3 px and broken up: refill only the smallest dropped specks
  maxHole: 4,
  hueMin: 8,
  hueMax: 40,
  minSat: 0.21,
  minValue: 0.1,
  maxValue: 0.9,
  also: [
    { hueMin: 8, hueMax: 40, minSat: 0.3, minValue: 0.9 },
    { hueMin: 8, hueMax: 30, minSat: 0.13, minValue: 0.3, maxValue: 0.9 },
  ],
};
const M = px(1600, 1280); // media wall render
const MEDIA_TV = [M(316, 371), M(863, 371), M(863, 686), M(316, 686)];
const MEDIA_UNIT = [M(128, 853), M(1028, 853), M(1028, 970), M(128, 970)];

const files = (id: SceneCategory) => {
  const entry = photos.find((ph) => ph.id === id);
  return {
    photo: assetUrl(`/scenes/${id}/${(entry as { file?: string } | undefined)?.file ?? 'photo.jpg'}`),
    thumbnail: assetUrl(`/scenes/${id}/thumb.jpg`),
    credit: entry?.credit ?? '',
    source: (entry?.source ?? 'unsplash') as Scene['source'],
  };
};

export const SCENES: Scene[] = [
  {
    id: 'kitchen',
    title: 'Classic with island',
    tagline: 'Painted shaker kitchen with an oak-topped island',
    ...files('kitchen'),
    items: [
      {
        id: 'wall-cabinets',
        label: 'Wall cabinets',
        kind: 'cabinet',
        role: 'front',
        recipe: {
          label: 'cabinet',
          anchors: [],
          outline: [
            { points: [K(164, 130), K(467, 130), K(467, 390), K(164, 390)], snap: false },
            { points: [K(867, 130), K(1168, 130), K(1168, 390), K(867, 390)], snap: false },
          ],
          protect: [K(488, 205), K(843, 205)],
          protectShapes: PENDANTS,
          protectColour: [brass([[K(160, 130), K(1170, 130), K(1170, 390), K(160, 390)]])],
        },
      },
      {
        id: 'tall-units',
        label: 'Tall larder units',
        kind: 'cabinet',
        role: 'front',
        recipe: {
          label: 'cabinet',
          anchors: [],
          outline: [
            // Where they meet the wall cabinets they stay as traced, overlapping them a little:
            // snapped, both sides would pull back to different edges and leave a sliver
            { points: [K(0, 121), K(168, 121), K(168, 390), K(177, 390), K(177, 489), K(140, 489), K(140, 700), K(0, 700)], snap: false },
            { points: [K(1176, 121), K(1344, 121), K(1344, 700), K(1192, 700), K(1192, 489), K(1150, 489), K(1150, 390), K(1164, 390), K(1164, 121)], snap: false },
          ],
          // The larders' knobs are the smallest in the scene. The search stops short of the worktop
          // ends beside them and of the floor (their knobs are at y 231 and 491): oak is warm and
          // saturated, and a blob of shaded paint touching it (the bracket at the worktop's right
          // end, the plinth's corner) would pass for brass
          protectColour: [
            brass(
              [
                [K(0, 121), K(180, 121), K(180, 487), K(140, 487), K(140, 600), K(0, 600)],
                [K(1150, 121), K(1344, 121), K(1344, 600), K(1192, 600), K(1192, 487), K(1150, 487)],
              ],
              8
            ),
          ],
          protectShapes: [knob(1264.4, 231.3), knob(1279.4, 231.6), knob(1265.3, 490), knob(1280.9, 490.3)],
        },
      },
      {
        id: 'canopy',
        label: 'Chimney canopy',
        kind: 'cabinet',
        role: 'front',
        recipe: {
          label: 'cabinet',
          anchors: [],
          // The panelled breast, its mantel and the two pilasters
          outline: [
            [K(459, 122), K(876, 122), K(876, 270), K(459, 270)],
            // The mantel, as traced: snapped, its lit ends (x 467–470, 861–867) and the row above
            // the tiles were left to nothing
            { points: [K(467, 268), K(867.5, 268), K(867.5, 320.5), K(467, 320.5)], snap: false },
            // The left pilaster as traced, its shaded side face (x 467–468) included: snapped, it
            // pulled in to x 469 and left that face to nothing above the tiles and to the
            // splashback below
            { points: [K(467, 320), K(537.5, 320), K(537.5, 492), K(467, 492)], snap: false },
            // The right pilaster: its lit side face reaches x 867 beside the wall cabinets, x 862.5
            // beside the tiles (traced; snapped, it stopped at x 860)
            { points: [K(795, 320), K(867.5, 320), K(867.5, 390), K(862.5, 390), K(862.5, 492), K(795, 492)], snap: false },
          ],
          protect: [K(488, 205), K(843, 205)],
          protectShapes: PENDANTS,
        },
      },
      {
        id: 'base-cabinets',
        label: 'Base cabinets',
        kind: 'cabinet',
        role: 'front',
        recipe: {
          label: 'cabinet',
          anchors: [],
          // To the run's lit end panel at the right (x 1183–1191, beside the larder): snapped, the
          // outline stopped short of it
          outline: [{ points: [K(139.5, 502), K(1192, 502), K(1192, 700), K(139.5, 700)], snap: false }],
          // The range cooker, and the island in front
          subtract: [ISLAND_TOP, ISLAND_SHAPE, [K(547, 476), K(782, 476), K(782, 524), K(547, 524)]],
          protect: [K(400, 515), K(380, 512), K(425, 512), K(400, 527)],
          protectColour: [brass([[K(140, 502), K(1190, 502), K(1190, 700), K(140, 700)]])],
        },
      },
      {
        id: 'island',
        label: 'Island',
        kind: 'cabinet',
        role: 'front',
        recipe: { label: 'cabinet', anchors: [], outline: [ISLAND_SHAPE, ...ISLAND_FEET], protectColour: [brass([ISLAND_BODY])] },
      },
      {
        id: 'worktop',
        label: 'Worktops',
        kind: 'countertop',
        role: 'worktop',
        recipe: {
          label: 'countertop',
          anchors: [p(0.5, 0.6)],
          outline: [ISLAND_TOP, [K(137, 489), K(547, 489), K(547, 502), K(137, 502)], [K(782, 489), K(1192, 489), K(1192, 502), K(782, 502)]],
          // The lemons in their bowl stand on it
          protect: [K(400, 515), K(380, 512), K(425, 512), K(400, 527)],
        },
      },
      {
        id: 'splashback',
        label: 'Splashback',
        kind: 'wall',
        role: 'splashback',
        recipe: {
          label: 'wall',
          anchors: [],
          outline: [
            // As traced: it meets the tall unit, the wall cabinets and the canopy's pilaster on
            // traced lines, and snapping took the pilaster's side face
            { points: [K(177, 390), K(467, 390), K(467, 489), K(177, 489)], snap: false },
            [K(538, 320), K(795, 320), K(795, 489), K(538, 489)],
            [K(867, 390), K(1150, 390), K(1150, 489), K(867, 489)],
          ],
          subtract: [[K(547, 476), K(782, 476), K(782, 524), K(547, 524)]],
          // The pan on the range
          protect: [K(617, 462)],
        },
      },
      {
        id: 'floor',
        label: 'Floor',
        kind: 'floor',
        role: 'floor',
        recipe: {
          label: 'floor',
          anchors: [p(0.08, 0.92), p(0.92, 0.92)],
          outline: [[K(0, 700), K(1344, 700), K(1344, 885), K(0, 885)]],
          subtract: [ISLAND_SHAPE, ...ISLAND_FEET],
        },
      },
    ],
  },
  {
    id: 'kitchen-modern',
    collection: 'kitchen',
    title: 'Modern U-shape',
    tagline: 'Handleless slab kitchen with oak accents',
    ...files('kitchen-modern'),
    items: [
      {
        id: 'wall-cabinets',
        label: 'Wall cabinets',
        kind: 'cabinet',
        role: 'front',
        recipe: {
          label: 'cabinet',
          anchors: [],
          outline: [
            [U(443, 116), U(1175, 116), U(1175, 375), U(443, 375)],
            // The side run on the left wall, under the sloping ceiling line
            { points: [U(254, 0), U(351, 0), U(443, 116), U(443, 472), U(254, 428)], snap: false },
          ],
        },
      },
      {
        id: 'base-cabinets',
        label: 'Base cabinets',
        kind: 'cabinet',
        role: 'front',
        recipe: {
          label: 'cabinet',
          anchors: [U(880, 770), U(430, 880), U(1420, 900)],
          outline: [
            [U(514, 657), U(1244, 657), U(1244, 887), U(514, 887)],
            // Where the left run meets the main one (snapped, the main run's edge pulled in to 516)
            { points: [U(511, 659), U(518, 657), U(518, 887), U(511, 887)], snap: false },
            // The left run's white fronts, and the right run under the window, in perspective
            { points: [U(351, 707), U(514, 661), U(514, 887), U(351, 1118)], snap: false },
            { points: [U(1244, 658), U(1600, 746), U(1600, 1136), U(1585, 1136), U(1244, 888)], snap: false },
          ],
        },
      },
      {
        id: 'end-panel',
        label: 'Oak panels',
        kind: 'cabinet',
        role: 'front',
        recipe: {
          label: 'cabinet',
          anchors: [U(185, 200), U(210, 900)],
          outline: [
            // To the panel's dark side face beside the wall cabinets (x 246–253): snapped, it
            // stopped at x 245
            { points: [U(121, 0), U(253.5, 0), U(253.5, 428), U(121, 428)], snap: false },
            [U(71, 704), U(351, 704), U(351, 1118), U(71, 1118)],
          ],
        },
      },
      {
        id: 'worktop',
        label: 'Worktops',
        kind: 'countertop',
        role: 'worktop',
        recipe: {
          label: 'countertop',
          anchors: [],
          outline: [
            // (down to the foot of the left run's dark front edge, y 708)
            { points: [U(71, 692), U(360, 636), U(1242, 636), U(1244, 657), U(514, 657), U(351, 708.5), U(71, 708.5)], snap: false },
            { points: [U(1244, 640), U(1600, 668), U(1600, 746), U(1244, 658)], snap: false },
          ],
          // The induction hob's black glass stays as it is
          subtract: [{ points: [U(764, 635), U(993, 635), U(993, 647), U(764, 647)], snap: false }],
          // What stands on it: utensils, the basket, the tap, jars, kettle, boards, pan, grinder, vase
          protect: [U(255, 640), U(290, 625), U(330, 625), U(295, 632), U(500, 618), U(527, 622), U(560, 615), U(650, 605), U(700, 600), U(950, 625), U(1075, 615), U(1115, 615), U(1320, 625)],
        },
      },
      {
        id: 'splashback',
        label: 'Splashback wall',
        kind: 'wall',
        role: 'splashback',
        recipe: {
          label: 'wall',
          anchors: [],
          outline: [
            { points: [U(443, 474), U(1175, 474), U(1175, 375), U(1244, 375), U(1244, 637), U(443, 637)], snap: false },
            { points: [U(71, 0), U(121, 0), U(121, 428), U(254, 428), U(443, 472), U(443, 637), U(360, 637), U(71, 692)], snap: false },
          ],
          // What stands before it, clicked low on each object as for the worktop (a click higher up,
          // on a board or a jar against the wall, took the wall itself), plus the pampas grass and
          // the big vase's branches
          protect: [U(255, 640), U(290, 625), U(330, 625), U(295, 632), U(500, 618), U(527, 622), U(560, 615), U(650, 605), U(700, 600), U(950, 625), U(1075, 615), U(1115, 615), U(1320, 625), U(395, 545), U(1320, 520)],
        },
      },
      {
        id: 'floor',
        label: 'Floor',
        kind: 'floor',
        role: 'floor',
        recipe: {
          label: 'floor',
          anchors: [p(0.5, 0.92)],
          outline: [{ points: [U(0, 1120), U(71, 1118), U(351, 1118), U(514, 887), U(1244, 888), U(1585, 1136), U(0, 1136)], snap: false }],
        },
      },
    ],
  },
  {
    id: 'kitchen-galley',
    collection: 'kitchen',
    title: 'Galley with island',
    tagline: 'Oak galley kitchen with a marble waterfall island',
    ...files('kitchen-galley'),
    items: [
      {
        id: 'wall-cabinets',
        label: 'Wall cabinets',
        kind: 'cabinet',
        role: 'front',
        recipe: {
          label: 'cabinet',
          anchors: [],
          // The run's oak case, frames and end box (down to the hood: its niche left of the steel
          // front, and its sloped foot right of it); the fluted glass doors stay glass. Then the
          // end box's side strip beside the hood and the oak shelf with downlights under the hood
          outline: [
            { points: [G(328, 13), G(457, 13), G(652, 382), ...GALLEY_END_BOX_TOP, G(736, 617), G(706, 589), G(686, 587), G(686, 622), G(652, 622), G(652, 632), G(328, 540)], snap: false },
            { points: [G(736, 522), G(744, 530), G(744, 664), G(736, 660)], snap: false },
            { points: GALLEY_HOOD_SHELF, snap: false },
          ],
          // …and the downlights in its underside stay lit
          subtract: [{ points: [G(466, 52), G(648, 388), G(648, 612), G(466, 542)], snap: false }, ...[...GALLEY_DOWNLIGHTS, ...GALLEY_HOOD_LIGHTS].map((points) => ({ points, snap: false }))],
        },
      },
      {
        id: 'tall-units',
        label: 'Tall units',
        kind: 'cabinet',
        role: 'front',
        recipe: {
          label: 'cabinet',
          anchors: [],
          outline: [
            [G(902, 493), G(1047, 493), G(1047, 742), G(902, 742)],
            // (inside the doorway's white architrave)
            [G(784, 575), G(902, 575), G(902, 799), G(784, 799)],
          ],
          // The oven in the far run and the pantry's pale brass bar handles and knobs (too pale
          // for the colour rule); the bowl and the tap before the island's tall unit
          subtract: [
            [G(781, 682), G(814, 682), G(814, 745), G(781, 745)],
            ...[GALLEY_BOWL, GALLEY_TAP, ...GALLEY_PANTRY_HANDLES].map((points) => ({ points, snap: false })),
          ],
        },
      },
      {
        id: 'base-cabinets',
        label: 'Base cabinets',
        kind: 'cabinet',
        role: 'front',
        recipe: {
          label: 'cabinet',
          anchors: [],
          // From under the worktop's front edge down to the floor line (GALLEY_FLOOR_LINE)
          outline: [{ points: [G(571, 828), G(725, 757.4), G(725, 937.4), G(571, 1261.6)], snap: false }],
          protectColour: [
            brass([[G(571, 740), G(735, 740), G(735, 1280), G(571, 1280)]]),
            // The upright handle on the right-hand drawer is longer than a knob
            { ...brass([[G(664, 918), G(703, 918), G(703, 960), G(664, 960)]]), blobs: { minArea: 22, maxArea: 1500, maxAspect: 8, core: { minSat: 0.55, minShare: 0.1 } } },
          ],
        },
      },
      {
        id: 'island',
        label: 'Island',
        kind: 'cabinet',
        role: 'front',
        recipe: {
          label: 'cabinet',
          anchors: [],
          // From the narrow end door beside the tall unit
          outline: [{ points: [G(911, 739), G(927, 741), G(1035, 778), G(1035, 1026), G(927, 851), G(911, 825.5)], snap: false }],
          subtract: GALLEY_ISLAND_HANDLES.map((points) => ({ points, snap: false })),
          // Its oak is warmer than the other runs' (sat 0.45–0.5), so brass is only what is clearly
          // more saturated (0.6–0.8)
          protectColour: [{ ...brass([[G(905, 735), G(1040, 735), G(1040, 1025), G(905, 1025)]], 12), minSat: 0.58, blobs: { minArea: 12, maxArea: 700, maxAspect: 12, core: { minSat: 0.65, minShare: 0.1 } } }],
        },
      },
      {
        id: 'worktop',
        label: 'Worktops',
        kind: 'countertop',
        role: 'worktop',
        recipe: {
          label: 'countertop',
          // The tops and the two waterfall ends are separate planes
          anchors: [G(420, 1050), G(1180, 900), G(1200, 772), G(500, 805)],
          outline: [
            // The top: its back edge where the tile (and at the left end the window frame) meets
            // it, traced (GALLEY_BACK_EDGE), to the front arris, and down past the waterfall front's
            // snapped top so no row between them is left out
            { points: [G(262, 818.5), ...GALLEY_BACK_EDGE, G(750, 733), G(770, 732.5), G(770, 736), G(750, 736.5), G(727, 752.4), G(571, 819.4), G(262, 819)], snap: false },
            // The slab's front edge over the base run, a lit band 5–8 px tall
            { points: [G(571, 819.4), G(727, 752.4), G(727, 757), G(571, 828)], snap: false },
            [G(262, 817), G(571, 817), G(571, 1280), G(262, 1280)],
            { points: [G(927, 736), G(1368, 770), G(1368, 779), G(1035, 780)], snap: false },
            [G(1035, 778), G(1331, 778), G(1331, 1037), G(1035, 1037)],
          ],
          // The hob on the range and the island's sink stay as they are
          subtract: [[G(600, 736), G(765, 728), G(765, 754), G(600, 754)], { points: GALLEY_SINK, snap: false }],
          // The toaster, the copper vase, the tap and the bowl
          protect: [G(533, 746), G(688, 712), G(1052, 712), G(1014, 724)],
        },
      },
      {
        id: 'splashback',
        label: 'Splashback',
        kind: 'wall',
        role: 'splashback',
        recipe: {
          label: 'wall',
          anchors: [],
          // The tile ends at the corner with the end wall (x 715), and at the worktop on the
          // traced back edge (from x 310, left of which is the window frame)
          outline: [{ points: [G(310, 535), G(328, 540), G(652, 632), G(715, 654), G(715, 734.4), ...GALLEY_BACK_EDGE.filter((q) => q.xPct * 1600 >= 309.9).reverse()], snap: false }],
          // The cooker hood above the range, and the oak shelf under it
          subtract: [[G(652, 587), G(735, 587), G(735, 661), G(652, 640)], { points: GALLEY_HOOD_SHELF, snap: false }],
          protect: [G(533, 746), G(688, 712)],
          protectSoft: GALLEY_THIN,
        },
      },
      {
        id: 'floor',
        label: 'Floor',
        kind: 'floor',
        role: 'floor',
        recipe: {
          label: 'floor',
          anchors: [p(0.5, 0.9)],
          // It meets the base run and the range on one straight line (x = 671.5 + (1050 − y) × 0.475,
          // traced from the photo) and the island and its waterfall end at their feet, edge to edge
          // with those items' outlines so no seam of the old floor shows between them
          outline: [{ points: [G(571, 1280), G(571, 1261.6), G(781, 819.5), G(781, 800), G(902, 800), G(911, 825.5), G(927, 851), G(1035, 1026), G(1035, 1037), G(1331, 1037), ...GALLEY_FLOOR_BACK, G(1600, 1280)], snap: false }],
        },
      },
    ],
  },
  {
    id: 'fencing',
    title: 'Fencing',
    tagline: 'Front garden boundary in solid timber boards',
    ...files('fencing'),
    items: [
      {
        id: 'front-fence',
        label: 'Front fence',
        kind: 'custom',
        role: 'fence',
        recipe: {
          label: 'fence',
          anchors: [p(0.65, 0.62), p(0.88, 0.63), p(0.78, 0.6)],
          // The run toward the corner, the corner post and the street run
          outline: [
            [F(890, 610), F(1182, 650), F(1182, 972), F(890, 852)],
            { points: [F(1182, 633), F(1228, 633), F(1228, 1000), F(1182, 1000)], solid: true },
            [F(1228, 652), F(1600, 617), F(1600, 940), F(1228, 995)],
          ],
          // The boards by their cedar colour: the garden through the gaps, the sign and the bin go
          keepColour: CEDAR,
          protect: [F(1167, 695)],
        },
      },
      {
        id: 'garden-fence',
        label: 'Garden fence',
        kind: 'custom',
        role: 'fence',
        recipe: {
          label: 'fence',
          anchors: [p(0.2, 0.49), p(0.36, 0.52), p(0.47, 0.55)],
          // The back run and the side run with its arched gate
          outline: [
            // (its capping edge falls from 555 at the corner to 575 at the left end, the shed wall
            // above it is the same cedar colour; two post caps stand a few px proud of it)
            [F(60, 575), F(452, 555), F(452, 692), F(60, 705)],
            { points: [F(175, 561), F(188, 561), F(188, 572), F(175, 572)], solid: true, snap: false },
            { points: [F(280, 556), F(292, 556), F(292, 566), F(280, 566)], solid: true, snap: false },
            [F(452, 562), F(500, 560), F(560, 543), F(600, 548), F(630, 560), F(890, 610), F(890, 852), F(452, 692)],
          ],
          // The boards by their cedar colour: the young tree before the side run (trunk, leaves in
          // sun and shade), the hedge above it, the grey air-conditioning unit and the plant at the
          // left end go
          keepColour: CEDAR,
          // …and its sunlit green leaves are its occluder (the renderer restores them exactly)
          protectColour: [{ region: [[F(600, 540), F(890, 540), F(890, 860), F(600, 860)]], hueMin: 55, hueMax: 170, minSat: 0.2 }],
        },
      },
    ],
  },
  {
    id: 'media-wall',
    title: 'Media Wall',
    tagline: 'Slatted feature wall with a floating TV unit',
    ...files('media-wall'),
    items: [
      {
        id: 'feature-panel',
        label: 'Feature panel',
        kind: 'wall',
        role: 'panel',
        recipe: {
          label: 'wall',
          anchors: [],
          outline: [[M(503, 48), M(890, 48), M(890, 1145), M(503, 1145)]],
          subtract: [MEDIA_TV, MEDIA_UNIT],
          // The vases, books and glass coffee table in front; the chrome chandelier by its brightness
          protect: [M(810, 1070), M(790, 1050), M(855, 990), M(680, 1112), M(560, 1118), M(740, 1170)],
          protectColour: [{ region: [[M(503, 90), M(890, 90), M(890, 275), M(503, 275)]], minValue: 0.62 }],
        },
      },
      {
        id: 'side-panel',
        label: 'Tall side panel',
        kind: 'wall',
        role: 'panel',
        // The TV unit runs in front of it
        recipe: { label: 'wall', anchors: [], outline: [[M(1005, 48), M(1100, 48), M(1100, 1143), M(1005, 1143)]], subtract: [MEDIA_UNIT] },
      },
      {
        id: 'tv-unit',
        label: 'TV unit',
        kind: 'cabinet',
        role: 'front',
        recipe: { label: 'cabinet', anchors: [], outline: [MEDIA_UNIT], protect: [M(300, 1100), M(220, 1000)] },
      },
      {
        id: 'walls',
        label: 'Walls',
        kind: 'wall',
        role: 'wall',
        recipe: {
          label: 'wall',
          anchors: [],
          outline: [
            [M(145, 25), M(503, 25), M(503, 1145), M(145, 1145)],
            [M(1100, 25), M(1550, 25), M(1550, 1150), M(1100, 1150)],
          ],
          subtract: [MEDIA_TV, MEDIA_UNIT],
          // The armchair and its cushion, the diffuser and books on the unit
          protect: [M(300, 1100), M(220, 1000), M(222, 800), M(220, 845)],
        },
      },
    ],
  },
  {
    id: 'cabinet',
    title: 'Cabinets',
    tagline: 'A statement sideboard on oak herringbone',
    ...files('cabinet'),
    items: [
      {
        id: 'sideboard',
        label: 'Sideboard',
        kind: 'cabinet',
        role: 'front',
        recipe: {
          label: 'cabinet',
          anchors: [],
          // The whole carcass, open niche included: a real re-spray changes its inside too
          outline: [[C(350, 326), C(1095, 326), C(1095, 756), C(350, 756)]],
          protect: [
            // On top: elephant, glass vases, lamp, gold vase, eggs
            C(505, 290), C(625, 270), C(730, 295), C(820, 300), C(930, 250), C(910, 305), C(960, 305), C(1025, 305),
            // In the niche: glasses, candle, little elephant, gnome
            C(690, 400), C(745, 400), C(668, 412), C(660, 500), C(678, 530), C(730, 525), C(770, 522),
            // …and the parts one click left out (SAM took the candle's label and left half only,
            // not the gnome's hat or the glasses' rims): the candle's dark right half and its lid,
            // the elephant's legs, the hat, both rims of the two glasses on the right
            C(764, 406), C(760, 420), C(760, 383), C(665, 420), C(665, 451), C(718, 541), C(716, 521), C(760, 505), C(785, 520),
          ],
          // The lamp's black cable down the back of the niche, and on down to the glasses
          protectColour: [
            { region: [[C(704, 337), C(752, 337), C(752, 535), C(704, 535)]], maxValue: 0.12 },
            // The gold band near the gnome's hat tip, which no click takes: saturated gold against
            // the niche's neutral grey
            { region: [[C(650, 438), C(685, 438), C(685, 470), C(650, 470)]], hueMin: 20, hueMax: 60, minSat: 0.4 },
          ],
        },
      },
      {
        id: 'floor',
        label: 'Floor',
        kind: 'floor',
        role: 'floor',
        recipe: {
          label: 'floor',
          anchors: [p(0.6, 0.85)],
          // Below the skirting and the door's threshold, under the sideboard too (its black frame stays)
          outline: [[C(100, 1067), C(160, 990), C(352, 800), C(352, 756), C(1095, 756), C(1095, 740), C(1600, 735), C(1600, 1067)]],
          // The black frame is neutral; the parquet in the deep shadow under the cabinet is as dark but
          // stays warm (hue 20–45°, sat 0.7+), so it is floor
          // …with its dark contact shadows a few px either side (too thin for the half-res baked light,
          // they would come out lit)
          protectColour: [
            { region: [[C(345, 750), C(1100, 750), C(1100, 810), C(345, 810)]], maxValue: 0.13, maxSat: 0.5, spread: { radius: 4, range: { maxValue: 0.1 } } },
          ],
        },
      },
      {
        id: 'wall',
        label: 'Walls',
        kind: 'wall',
        role: 'wall',
        recipe: {
          label: 'wall',
          anchors: [p(0.15, 0.25), p(0.55, 0.08)],
          // The side wall down to its skirting (above the door casing's plinth block), and the back wall above the sideboard
          outline: [
            [C(152, 0), C(400, 0), C(400, 326), C(350, 326), C(350, 706), C(160, 852), C(160, 824), C(152, 824)],
            [C(400, 0), C(1052, 0), C(1052, 328), C(400, 328)],
          ],
          // Everything standing on the sideboard
          protect: [C(505, 290), C(625, 270), C(730, 295), C(730, 180), C(820, 300), C(930, 250), C(910, 305), C(960, 305), C(1025, 305), C(940, 70), C(925, 140)],
        },
      },
    ],
  },
  {
    id: 'wardrobe',
    title: 'Wardrobe',
    tagline: 'Full-height fitted wardrobe with mirror doors',
    ...files('wardrobe'),
    items: [
      {
        id: 'doors',
        label: 'Wardrobe doors',
        kind: 'cabinet',
        role: 'front',
        recipe: {
          label: 'wardrobe',
          anchors: [p(0.45, 0.45)],
          // Top boxes, cornice strip and the main body (plinth inset 7 px on the left)
          outline: [
            [W(312, 76), W(1272, 76), W(1272, 208), W(312, 208)],
            [W(296, 208), W(1288, 208), W(1288, 218), W(296, 218)],
            [W(300, 218), W(1283, 218), W(1283, 882), W(307, 882), W(307, 849), W(300, 849)],
          ],
          // The two mirrors' glass keeps its reflection
          subtract: [
            [W(484, 236), W(604, 236), W(604, 665), W(484, 665)],
            [W(976, 236), W(1097, 236), W(1094, 666), W(973, 666)],
          ],
          // The palm in front of the right edge: its green leaves, by colour, where they cross the doors
          protectColour: [
            { region: [[W(1195, 500), W(1290, 500), W(1290, 890), W(1195, 890)]], hueMin: 50, hueMax: 170, minSat: 0.12 },
            // The bars themselves: grey aluminium (saturation ≤ 0.23) against oak (≥ 0.35), inside each bar's box
            { region: WARDROBE_HANDLES, maxSat: 0.28 },
          ],
        },
      },
      {
        id: 'floor',
        label: 'Floor',
        kind: 'floor',
        role: 'floor',
        recipe: {
          label: 'floor',
          anchors: [p(0.5, 0.9)],
          // From the door's foot and the skirtings to the wardrobe's plinth; the planter stands on it
          // (the door's foot runs from (31, 1067) to its frame; the right wall's skirting meets the floor
          // from behind the planter to (1600, 935))
          outline: [[W(31, 1067), W(212, 931), W(250, 925), W(300, 882), W(1283, 882), W(1283, 808), W(1325, 806), W(1600, 935), W(1600, 1067)]],
          protect: [W(1410, 860), W(1380, 830)],
        },
      },
    ],
  },
];

export const sceneById = (id: string | null | undefined): Scene | undefined => SCENES.find((s) => s.id === id);
