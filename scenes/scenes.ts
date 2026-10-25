import { PctPoint, Scene, SceneCategory } from './types';
import photos from './photos.json';

// The five preset scenes and the items a customer can re-finish in each. Coordinates are
// fractions of the photo. Each item's `recipe` is what /dev/scenes runs to bake it.

const p = (xPct: number, yPct: number): PctPoint => ({ xPct, yPct });
const rect = (x0: number, y0: number, x1: number, y1: number): PctPoint[] => [p(x0, y0), p(x1, y0), p(x1, y1), p(x0, y1)];

// Pixel coordinates on a photo of the given size, for outlines traced on the photo itself
const px = (w: number, h: number) => (x: number, y: number): PctPoint => ({ xPct: x / w, yPct: y / h });
const W = px(1600, 1067); // wardrobe photo
const K = px(1344, 885); // the client's kitchen render

// The kitchen island: its oak top (seen from slightly above) and its painted body
const ISLAND_TOP = [K(300, 524), K(1020, 524), K(1097, 548), K(1097, 560), K(231, 560), K(231, 548)];
const ISLAND_BODY = [K(243, 560), K(1088, 560), K(1088, 840), K(243, 840)];

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
const brass = (region: PctPoint[][], minArea = 22) => ({ region, hueMin: 15, hueMax: 60, minSat: 0.38, blobs: { minArea, maxArea: 700, maxAspect: 3 } });

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

const PENDANTS = [dome(488, 230, 63.5, 66, 6), dome(843, 230, 63.5, 66, 6)];

const C = px(1600, 1067); // sideboard photo
const F = px(1600, 1280); // fencing photo
const M = px(1600, 1280); // media wall render
const MEDIA_TV = [M(316, 371), M(863, 371), M(863, 686), M(316, 686)];
const MEDIA_UNIT = [M(128, 853), M(1028, 853), M(1028, 970), M(128, 970)];

const files = (id: SceneCategory) => {
  const entry = photos.find((ph) => ph.id === id);
  return {
    photo: `/scenes/${id}/${(entry as { file?: string } | undefined)?.file ?? 'photo.jpg'}`,
    thumbnail: `/scenes/${id}/thumb.jpg`,
    credit: entry?.credit ?? '',
    source: (entry?.source ?? 'unsplash') as Scene['source'],
  };
};

export const SCENES: Scene[] = [
  {
    id: 'kitchen',
    title: 'Kitchen',
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
          // The larders' knobs are the smallest in the scene
          protectColour: [brass([[K(0, 121), K(180, 121), K(180, 700), K(0, 700)], [K(1150, 121), K(1344, 121), K(1344, 700), K(1150, 700)]], 8)],
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
            [K(467, 268), K(866, 268), K(866, 320), K(467, 320)],
            [K(467, 320), K(538, 320), K(538, 492), K(467, 492)],
            [K(795, 320), K(866, 320), K(866, 492), K(795, 492)],
          ],
          protect: [K(488, 205), K(843, 205), K(768, 245), K(835, 425), K(852, 455)],
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
          outline: [[K(140, 502), K(1190, 502), K(1190, 700), K(140, 700)]],
          // The range cooker, and the island in front
          subtract: [ISLAND_TOP, ISLAND_BODY, [K(547, 476), K(782, 476), K(782, 524), K(547, 524)]],
          protect: [K(400, 515), K(380, 512), K(425, 512), K(400, 527), K(890, 505)],
          protectColour: [brass([[K(140, 502), K(1190, 502), K(1190, 700), K(140, 700)]])],
        },
      },
      {
        id: 'island',
        label: 'Island',
        kind: 'cabinet',
        role: 'front',
        recipe: { label: 'cabinet', anchors: [], outline: [ISLAND_BODY], protectColour: [brass([ISLAND_BODY])] },
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
          // The lemons in their bowl and the vase stand on it
          protect: [K(400, 515), K(380, 512), K(425, 512), K(400, 527), K(890, 505)],
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
            [K(177, 390), K(467, 390), K(467, 489), K(177, 489)],
            [K(538, 320), K(795, 320), K(795, 489), K(538, 489)],
            [K(867, 390), K(1150, 390), K(1150, 489), K(867, 489)],
          ],
          subtract: [[K(547, 476), K(782, 476), K(782, 524), K(547, 524)]],
          // The pan on the range, and the olive branches before the right-hand tiles
          protect: [K(617, 462), K(895, 435), K(835, 425), K(852, 455)],
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
          subtract: [ISLAND_BODY],
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
          intersectCut: true,
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
            [F(60, 553), F(452, 553), F(452, 692), F(60, 705)],
            [F(452, 562), F(500, 560), F(560, 543), F(600, 548), F(630, 560), F(890, 610), F(890, 852), F(452, 692)],
          ],
          // Solid boards, so no cut intersection: the tree before them is kept by its leaves' colour
          // The young tree before the side run, by its green leaves
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
          ],
          // The lamp's black cable down the back of the niche
          protectColour: [{ region: [[C(712, 337), C(750, 337), C(750, 492), C(712, 492)]], maxValue: 0.12 }],
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
          protectColour: [{ region: [[C(345, 750), C(1100, 750), C(1100, 810), C(345, 810)]], maxValue: 0.13 }],
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
          // The side wall down to its skirting, and the back wall above the sideboard
          outline: [
            [C(152, 0), C(400, 0), C(400, 326), C(350, 326), C(350, 706), C(160, 852), C(152, 852)],
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
          outline: [[W(0, 1067), W(0, 1045), W(212, 935), W(250, 925), W(300, 882), W(1283, 882), W(1283, 808), W(1478, 808), W(1600, 925), W(1600, 1067)]],
          protect: [W(1410, 860), W(1380, 830)],
        },
      },
    ],
  },
];

export const sceneById = (id: string | null | undefined): Scene | undefined => SCENES.find((s) => s.id === id);
