import { Material, SurfaceGeometry, SurfaceKind } from '../types';

// The studio's preset scenes. Customers never upload a photo: each scene is a fixed photo (or
// render) whose items were cut out once, offline, in /dev/scenes and saved as masks + planes
// ("baked"), so the studio renders them instantly with no model in the browser.

export type SceneCategory = 'kitchen' | 'fencing' | 'media-wall' | 'cabinet' | 'wardrobe';

// What an item physically is — which materials make sense on it
export type SurfaceRole = 'front' | 'worktop' | 'splashback' | 'panel' | 'fence' | 'wall' | 'floor';

export interface PctPoint {
  xPct: number;
  yPct: number;
}

/**
 * How the bake tool cuts an item: one SAM cut of the SegFormer class `label` from each of
 * `anchors` (separate runs of cabinets, both sides of a room — a cut keeps only the region
 * connected to its anchor), merged with the `add` polygons, then kept inside `clip` and outside every `subtract`
 * polygon. With `polygonOnly` the item is just its `clip` polygon (flat fronts in a render are
 * exact quads).
 */
/**
 * One traced outline: its points, or with options — `snap: false` keeps it as traced (where two
 * items meet and snapping would pull them apart), `solid` takes it whole even with `intersectCut`
 * (a fence post the cut frays).
 */
export type Outline = PctPoint[] | { points: PctPoint[]; snap?: boolean; solid?: boolean };

export interface BakeRecipe {
  label: string;
  anchors: PctPoint[];
  exclude?: PctPoint[];
  // Areas the cut misses that are plainly part of the item (a run SegFormer labels as wall)
  add?: PctPoint[][];
  clip?: PctPoint[];
  subtract?: Outline[];
  polygonOnly?: boolean;
  // Keep the cut's occluders even where `add` paints over them (a tree in front of a fence, a
  // pendant light before a panel). Off by default: SegFormer's stray labels on the item itself
  // would otherwise punch holes in it
  keepOccluders?: boolean;
  // …or keep them only inside these polygons (the plant before the wardrobe's edge)
  keepOccludersIn?: PctPoint[][];
  // The precise way for straight-edged furniture: the item traced as outlines (one per visible
  // run), each side snapped onto the photo's real edge (unless `snap` is false). The cuts from
  // `anchors` then only supply the planes, and `protect` clicks the objects standing in front
  outline?: Outline[];
  // Exact polygons of objects in front, not snapped (a pendant's dome)
  protectShapes?: PctPoint[][];
  snap?: boolean;
  // Keep only what the anchors' cut also covers (the gaps between fence boards)
  intersectCut?: boolean;
  protect?: PctPoint[];
  // …and/or the pixels of one colour range inside a region (green leaves before beige wood)
  protectColour?: Array<{ region: PctPoint[][]; hueMin?: number; hueMax?: number; minSat?: number; maxSat?: number; minValue?: number; maxValue?: number; blobs?: { minArea: number; maxArea: number; maxAspect: number } }>;
}

export interface SceneItem {
  id: string;
  label: string;
  kind: SurfaceKind;
  role: SurfaceRole;
  recipe: BakeRecipe;
}

export interface Scene {
  id: SceneCategory;
  title: string;
  tagline: string;
  photo: string;
  thumbnail: string;
  credit: string;
  // A supplied render, or a free-licence photo standing in for one
  source: 'client' | 'unsplash';
  items: SceneItem[];
}

// One plane of a baked item: its mask (white on black PNG) and fitted geometry
export interface BakedPart {
  mask: string;
  plane: SurfaceGeometry | null;
}

export interface BakedItem {
  parts: BakedPart[];
  occluder: string | null;
  confidence: number;
  // Edited by hand in the Area Editor after the automatic cut
  edited: boolean;
  bakedAt: string;
}

export interface BakedScene {
  width: number;
  height: number;
  analysisVersion: string;
  items: Record<string, BakedItem>;
}

export type BakedScenes = Partial<Record<SceneCategory, BakedScene>>;

// A catalogue material plus where it belongs in the studio
export interface StudioMaterial extends Material {
  // The scene collection it is shown in ('room' = shared wall/floor finishes)
  collection: SceneCategory | 'room';
  roles: SurfaceRole[];
  tag?: 'Bestseller' | 'New' | 'Trending';
}

// A generated design style, as shipped: the patch drawn over the photo at `rect`, and the
// style's own baked items (their masks and planes follow the new shape)
export interface StyleBake {
  rect: { x: number; y: number; w: number; h: number };
  patch: string;
  provider: string;
  prompt: string;
  createdAt: string;
  items: Record<string, BakedItem>;
}

// scene → `${groupId}--${optionId}` → bake
export type StyleBakes = Partial<Record<SceneCategory, Record<string, StyleBake>>>;
