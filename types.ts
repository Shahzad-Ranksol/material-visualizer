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
  renderOverlayTone?: string;
  tileScale?: number;
  blendMode?: 'soft-light' | 'color' | 'overlay';
}

export interface DetectedItem {
  id: string;
  name: string;
  category?: 'Surfaces & Walls' | 'Furniture' | 'Flooring' | 'Cabinetry' | 'Architectural' | 'Decor';
  description?: string;
  confidence?: number;
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
  }>;
}

export type ViewMode = 'slider' | 'side-by-side' | 'rendered' | 'original';
