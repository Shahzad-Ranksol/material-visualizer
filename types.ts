// types.ts

export type RoomType = 
  | 'Living Room'
  | 'Bedroom'
  | 'Kitchen'
  | 'Dining Room'
  | 'Office / Study'
  | 'Bathroom'
  | 'Penthouse Lounge';

export type MaterialCategory =
  | 'all'
  | 'tile'
  | 'sheet'
  | 'carpet'
  | 'wallpaper'
  | 'paint'
  | 'stone'
  | 'wood'
  | 'plaster'
  | 'metal'
  | 'fabric';

export interface Material {
  id: string;
  tenantId: string | null;
  name: string;
  category: MaterialCategory;
  description: string;
  thumbnail: string;
  finishType: string;
  colorTone: string;
  // Physical profile — how the renderer lays the photo out on a real surface
  realWidthMm: number;
  // Null keeps the photo's aspect ratio
  realHeightMm: number | null;
  repeatMode: RepeatMode;
  orientationDeg: 0 | 90 | 180 | 270;
  jointWidthMm: number | null;
  jointColor: string | null;
  roughness: number;
  metallic: number;
  normalStrength: number;
  // Full-resolution colour map for rendering; the thumbnail stays small for the catalogue
  albedoUrl?: string | null;
  normalUrl?: string | null;
  roughnessUrl?: string | null;
  heightUrl?: string | null;
}

// How a material's photo repeats across a surface
//  seamless:  one continuous texture (made tileable)
//  sheet:     each photo = one sheet/panel, joints between sheets, each sheet varied
//  tile:      each photo = one tile, grout joints
//  plank:     each photo = one plank, rows staggered
//  bookmatch: mirrored in pairs, as book-matched stone/veneer is installed
//  none:      shown once, no repeat
export type RepeatMode = 'seamless' | 'sheet' | 'tile' | 'plank' | 'bookmatch' | 'none';

export type SurfaceKind = 'wall' | 'floor' | 'ceiling' | 'cabinet' | 'countertop' | 'door' | 'furniture' | 'custom';
export type Vec3 = [number, number, number];

// Pinhole camera, focal lengths and principal point as fractions of image width/height
export interface CameraIntrinsics {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
}

/**
 * Geometry of a surface. Preferred: a fitted 3D plane in camera space (metres) with the
 * intrinsics it was fitted under — the renderer intersects each pixel's camera ray with it.
 * Fallback: the four-corner homography a vendor can drag by hand.
 */
export interface SurfaceGeometry {
  normal?: Vec3;
  origin?: Vec3;
  axisU?: Vec3;
  axisV?: Vec3;
  residual?: number;
  intrinsics?: CameraIntrinsics;
  homographyFallback?: SurfacePlane;
}

// Two image points (fractions of width/height) a known real distance apart
export interface SurfaceCalibration {
  p1: [number, number];
  p2: [number, number];
  distanceMm: number;
}

/** One analysed, re-surfaceable area of a room photo — the contract every render uses. */
export interface SurfaceAnalysis {
  id: string;
  imageId: string;
  kind: SurfaceKind;
  label: string;
  maskUrl: string;
  occluderMaskUrl?: string | null;
  analysisVersion: string;
  modelVersions?: Record<string, string> | null;
  confidence: number;
  needsReview: boolean;
  plane?: SurfaceGeometry | null;
  calibration?: SurfaceCalibration | null;
  lightingMapUrl?: string | null;
  // Extra planes of one user-level surface (e.g. a wall across a corner) point at the main one
  parentSurfaceId?: string | null;
}

// A surface ready to render: saved (URLs) or in-editor (canvases)
export type MaskSource = string | HTMLCanvasElement | HTMLImageElement | ImageBitmap;
export interface RenderableSurface {
  kind?: SurfaceKind;
  mask: MaskSource;
  occluderMask?: MaskSource | null;
  plane?: SurfaceGeometry | null;
  calibration?: SurfaceCalibration | null;
}

export type RenderMode = 'exact' | 'studio';
export type RenderDebugView = 'none' | 'mask' | 'uv' | 'lighting';
export interface RenderSettings {
  mode?: RenderMode;
  debug?: RenderDebugView;
}

export interface DetectedItem {
  id: string;
  name: string;
  category?: 'Surfaces & Walls' | 'Furniture' | 'Flooring' | 'Cabinetry' | 'Architectural' | 'Decor';
  description?: string;
  confidence?: number;
  // The analysed surface(s) behind this target — one per physical plane; targets without
  // any can't be rendered
  surfaces?: RenderableSurface[];
  // Where the surface was detected (for cutting its mask on demand)
  anchor?: PlanePoint;
  surfaceLabel?: string;
  surfaceKind?: SurfaceKind;
  // Share of the photo the detected surface covers
  areaPct?: number;
  // Low analysis confidence: rendered, but flagged for the user to check
  needsReview?: boolean;
  // 'confirm' = render but ask to check; 'correct' = must be corrected before a final render
  reviewDecision?: 'auto' | 'confirm' | 'correct';
}

export interface PlanePoint {
  xPct: number;
  yPct: number;
}

/**
 * The real, flat surface behind a hotspot: where its rectangle's corners sit in the photo
 * (top-left, top-right, bottom-right, bottom-left, as % of the image) and how tall it is in
 * reality. Lets the renderer lay materials out in true perspective at real-world scale.
 */
export interface SurfacePlane {
  corners: [PlanePoint, PlanePoint, PlanePoint, PlanePoint];
  // Real-world length of the plane's top-to-bottom edge (a wall's height, a floor's depth)
  heightMm: number;
}


export interface CuratedRoom {
  id: string;
  title: string;
  roomType: RoomType;
  style: string;
  thumbnail: string;
  fullImage: string;
  aspectRatio?: string;
  detectedDefaults: Array<{
    name: string;
    category?: DetectedItem['category'];
    description: string;
    surfaces?: RenderableSurface[];
  }>;
}

export type ViewMode = 'slider' | 'side-by-side' | 'rendered' | 'original' | 'hotspots';
