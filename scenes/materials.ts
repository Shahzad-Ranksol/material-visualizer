import { MaterialCategory } from '../types';
import { defaultProfileFor, PhysicalProfile } from '../services/materialProfile';
import { StudioMaterial } from './types';

// The studio catalogue: five materials per scene collection plus shared room finishes for walls
// and floors. Scans are Poly Haven CC0, web-sized and committed under /materials/; lacquers are
// flat colour swatches committed under /finishes/.

type Seed = Omit<StudioMaterial, keyof PhysicalProfile | 'tenantId'> & Partial<PhysicalProfile>;

const scan = (id: string) => ({
  // Web-sized copies committed under /materials/ (npm run materials:build)
  thumbnail: `/materials/${id}_chip.jpg`,
  albedoUrl: `/materials/${id}.jpg`,
  normalUrl: `/materials/${id}_nor.jpg`,
  roughnessUrl: `/materials/${id}_rough.jpg`,
});

const lacquer = (swatch: string) => ({ thumbnail: `/finishes/${swatch}.jpg`, albedoUrl: `/finishes/${swatch}.jpg`, realWidthMm: 1000, normalStrength: 0 });

const veneer = (category: MaterialCategory = 'wood') => ({ category, realWidthMm: 1200, repeatMode: 'seamless' as const });

// Fence scans whose boards run across (stained pine, coastal blue) are turned upright with
// orientationDeg 90; the others are already vertical
const SEEDS: Seed[] = [
  // Kitchen
  { id: 'kit-sage-lacquer', collection: 'kitchen', roles: ['front'], name: 'Sage Matte Lacquer', category: 'paint', finishType: 'Matte lacquer', colorTone: 'Sage green', description: 'Soft sage lacquer with a velvet matte finish.', tag: 'Trending', ...lacquer('sage'), roughness: 0.55 },
  { id: 'kit-navy-lacquer', collection: 'kitchen', roles: ['front'], name: 'Midnight Navy Lacquer', category: 'paint', finishType: 'Satin lacquer', colorTone: 'Deep navy', description: 'Deep navy satin lacquer for a tailored look.', ...lacquer('navy'), roughness: 0.4 },
  { id: 'kit-natural-oak', collection: 'kitchen', roles: ['front'], name: 'Natural Oak Veneer', category: 'wood', finishType: 'Oiled veneer', colorTone: 'Honey oak', description: 'Crown-cut oak veneer, lightly oiled.', tag: 'Bestseller', ...scan('oak_veneer_01'), ...veneer(), roughness: 0.6 },
  { id: 'kit-bianco-quartz', collection: 'kitchen', roles: ['worktop', 'splashback'], name: 'Bianco Quartz', category: 'stone', finishType: 'Polished', colorTone: 'Bright white', description: 'Polished white quartz with a fine speckle.', tag: 'Bestseller', ...lacquer('bianco'), realWidthMm: 1400, roughness: 0.18 },
  { id: 'kit-crema-marble', collection: 'kitchen', roles: ['worktop', 'splashback'], name: 'Crema Marble', category: 'stone', finishType: 'Honed', colorTone: 'Warm cream', description: 'Honed cream marble with soft veining.', ...scan('marble_01'), realWidthMm: 1400, roughness: 0.3 },

  // Fencing
  { id: 'fen-cedar', collection: 'fencing', roles: ['fence'], name: 'Western Red Cedar', category: 'wood', finishType: 'Natural', colorTone: 'Warm red-brown', description: 'Vertical-grain cedar boards, left natural.', tag: 'Bestseller', ...scan('japanese_cedar_planks'), realWidthMm: 1500, roughness: 0.8 },
  { id: 'fen-silver-grey', collection: 'fencing', roles: ['fence'], name: 'Silver Weathered Grey', category: 'wood', finishType: 'Weathered', colorTone: 'Silver grey', description: 'Sun-silvered timber boards with open grain.', ...scan('wood_planks_grey'), realWidthMm: 1500, roughness: 0.85 },
  { id: 'fen-charcoal', collection: 'fencing', roles: ['fence'], name: 'Charcoal Stain', category: 'wood', finishType: 'Opaque stain', colorTone: 'Charcoal black', description: 'Contemporary black stain over sawn boards.', tag: 'Trending', ...scan('black_painted_planks'), realWidthMm: 1500, roughness: 0.75 },
  { id: 'fen-honey-pine', collection: 'fencing', roles: ['fence'], name: 'Honey Pine', category: 'wood', finishType: 'Clear stain', colorTone: 'Golden pine', description: 'Pressure-treated pine with a clear honey stain.', ...scan('stained_pine'), realWidthMm: 1500, orientationDeg: 90, roughness: 0.7 },
  { id: 'fen-coastal-blue', collection: 'fencing', roles: ['fence'], name: 'Coastal Blue', category: 'paint', finishType: 'Painted', colorTone: 'Faded blue', description: 'Painted boards in a weathered coastal blue.', ...scan('blue_painted_planks'), realWidthMm: 1500, orientationDeg: 90, roughness: 0.8 },

  // Media wall
  { id: 'med-smoked-walnut', collection: 'media-wall', roles: ['panel', 'front'], name: 'Smoked Walnut', category: 'wood', finishType: 'Matte veneer', colorTone: 'Smoky brown', description: 'Smoked walnut veneer, matte lacquered.', tag: 'Bestseller', ...scan('smoked_walnut_veneer'), ...veneer(), roughness: 0.55 },
  { id: 'med-crema-marble', collection: 'media-wall', roles: ['panel'], name: 'Crema Marble Slab', category: 'stone', finishType: 'Polished', colorTone: 'Warm cream', description: 'A single cream marble feature slab.', ...scan('marble_01'), realWidthMm: 1600, roughness: 0.15 },
  { id: 'med-microcement', collection: 'media-wall', roles: ['panel', 'wall'], name: 'Microcement', category: 'plaster', finishType: 'Sealed matte', colorTone: 'Warm grey', description: 'Seamless trowelled microcement.', tag: 'Trending', ...scan('brushed_concrete'), realWidthMm: 2000, roughness: 0.7 },
  { id: 'med-charcoal-lacquer', collection: 'media-wall', roles: ['panel', 'front'], name: 'Charcoal Lacquer', category: 'paint', finishType: 'Satin lacquer', colorTone: 'Charcoal', description: 'Charcoal satin lacquer for a moody wall.', ...lacquer('charcoal'), roughness: 0.4 },
  { id: 'med-light-oak', collection: 'media-wall', roles: ['panel', 'front'], name: 'Washed Grey Oak', category: 'wood', finishType: 'Matte veneer', colorTone: 'Washed grey', description: 'Whitewashed oak veneer with soft grain.', ...scan('washed_grey_oak_veneer'), ...veneer(), roughness: 0.6 },

  // Cabinet
  { id: 'cab-terracotta', collection: 'cabinet', roles: ['front'], name: 'Terracotta Lacquer', category: 'paint', finishType: 'Matte lacquer', colorTone: 'Burnt terracotta', description: 'Earthy terracotta in a soft matte lacquer.', tag: 'New', ...lacquer('terracotta'), roughness: 0.55 },
  { id: 'cab-cream', collection: 'cabinet', roles: ['front'], name: 'Cream Lacquer', category: 'paint', finishType: 'Satin lacquer', colorTone: 'Warm cream', description: 'Timeless warm cream satin lacquer.', ...lacquer('cream'), roughness: 0.4 },
  { id: 'cab-american-walnut', collection: 'cabinet', roles: ['front'], name: 'American Walnut', category: 'wood', finishType: 'Oiled veneer', colorTone: 'Rich brown', description: 'Figured American walnut veneer.', tag: 'Bestseller', ...scan('american_walnut_veneer'), ...veneer(), roughness: 0.55 },
  { id: 'cab-ash', collection: 'cabinet', roles: ['front'], name: 'White Ash', category: 'wood', finishType: 'Matte veneer', colorTone: 'Pale ash', description: 'Pale ash veneer with a bold open grain.', ...scan('ash_veneer'), ...veneer(), roughness: 0.6 },
  { id: 'cab-black-oak', collection: 'cabinet', roles: ['front'], name: 'Black Stained Oak', category: 'wood', finishType: 'Stained veneer', colorTone: 'Ebony', description: 'Oak veneer stained ebony, grain still visible.', ...scan('black_oak_veneer'), ...veneer(), roughness: 0.5 },

  // Wardrobe
  { id: 'war-white-maple', collection: 'wardrobe', roles: ['front'], name: 'White Maple', category: 'wood', finishType: 'Matte veneer', colorTone: 'Pale maple', description: 'Light, calm maple veneer.', ...scan('white_maple_veneer'), ...veneer(), roughness: 0.6 },
  { id: 'war-teak', collection: 'wardrobe', roles: ['front'], name: 'Golden Teak', category: 'wood', finishType: 'Oiled veneer', colorTone: 'Golden brown', description: 'Mid-century teak veneer, oiled.', tag: 'Trending', ...scan('teak_veneer'), ...veneer(), roughness: 0.5 },
  { id: 'war-cashmere', collection: 'wardrobe', roles: ['front'], name: 'Cashmere Lacquer', category: 'paint', finishType: 'Matte lacquer', colorTone: 'Soft greige', description: 'Soft greige matte lacquer.', tag: 'Bestseller', ...lacquer('cashmere'), roughness: 0.55 },
  { id: 'war-forest', collection: 'wardrobe', roles: ['front'], name: 'Forest Green Lacquer', category: 'paint', finishType: 'Satin lacquer', colorTone: 'Deep green', description: 'Deep forest green satin lacquer.', ...lacquer('forest'), roughness: 0.4 },
  { id: 'war-smoked-walnut', collection: 'wardrobe', roles: ['front'], name: 'Smoked Walnut', category: 'wood', finishType: 'Matte veneer', colorTone: 'Smoky brown', description: 'Smoked walnut veneer, matte lacquered.', ...scan('smoked_walnut_veneer'), ...veneer(), roughness: 0.55 },

  // Shared room finishes (walls and floors in every scene)
  { id: 'room-oak-parquet', collection: 'room', roles: ['floor'], name: 'Oak Herringbone', category: 'wood', finishType: 'Oiled', colorTone: 'Natural oak', description: 'Classic oak herringbone parquet.', ...scan('herringbone_parquet'), realWidthMm: 1200, roughness: 0.55 },
  { id: 'room-concrete', collection: 'room', roles: ['floor', 'wall'], name: 'Polished Concrete', category: 'stone', finishType: 'Sealed', colorTone: 'Mid grey', description: 'Smooth sealed concrete.', ...scan('brushed_concrete'), realWidthMm: 2000, roughness: 0.5 },
  { id: 'room-limewash', collection: 'room', roles: ['wall'], name: 'Limewash Plaster', category: 'plaster', finishType: 'Limewash', colorTone: 'Chalk white', description: 'Soft, cloudy limewash plaster.', ...scan('white_plaster_02'), realWidthMm: 2000, roughness: 0.9 },
  { id: 'room-warm-white', collection: 'room', roles: ['wall'], name: 'Warm White Paint', category: 'paint', finishType: 'Matte emulsion', colorTone: 'Warm white', description: 'A warm, flat white emulsion.', ...lacquer('warm-white'), realWidthMm: 2000, roughness: 0.9 },
];

export const STUDIO_MATERIALS: StudioMaterial[] = SEEDS.map((m) => ({
  ...defaultProfileFor(m.category, `${m.finishType} ${m.description}`),
  tenantId: null,
  ...m,
}));

export const materialById = (id: string) => STUDIO_MATERIALS.find((m) => m.id === id);

/** Materials offered for a set of selected items: the scene's own collection plus room finishes, fitting every item. */
export const materialsFor = (collection: string, roles: string[]): StudioMaterial[] =>
  roles.length === 0
    ? []
    : STUDIO_MATERIALS.filter((m) => (m.collection === collection || m.collection === 'room') && roles.every((r) => m.roles.includes(r as never)));
