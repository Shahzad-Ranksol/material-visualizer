/**
 * The validation set: free-licence room photos (URL + credit, never the photo itself), each with
 * the surfaces to score. Approved masks live next to it in validation/approved/.
 */
export type ValidationCategory = 'wall' | 'floor' | 'cabinet-door' | 'countertop' | 'hard';
export const VALIDATION_CATEGORIES: ValidationCategory[] = ['wall', 'floor', 'cabinet-door', 'countertop', 'hard'];

export interface ValidationPhoto {
  id: string;
  url: string;
  source: 'unsplash';
  // Photographer name and profile, as the licence asks
  credit: string;
  category: ValidationCategory;
  // ADE20K labels to score on this photo
  surfaces: string[];
}

export const validateManifest = (photos: unknown): string[] => {
  if (!Array.isArray(photos)) return ['the manifest must be an array'];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const p of photos as ValidationPhoto[]) {
    if (!p?.id || !/^[a-z0-9_-]+$/i.test(p.id)) problems.push(`invalid id ${JSON.stringify(p?.id)}`);
    else if (seen.has(p.id)) problems.push(`duplicate id "${p.id}"`);
    seen.add(p?.id);
    if (!VALIDATION_CATEGORIES.includes(p?.category)) problems.push(`"${p?.id}": unknown category ${JSON.stringify(p?.category)}`);
    if (!Array.isArray(p?.surfaces) || p.surfaces.length === 0) problems.push(`"${p?.id}": surfaces must list at least one label`);
    if (typeof p?.url !== 'string' || !p.url.startsWith('https://')) problems.push(`"${p?.id}": url must be https`);
    if (p?.source !== 'unsplash') problems.push(`"${p?.id}": source must be "unsplash"`);
    if (!p?.credit) problems.push(`"${p?.id}": missing credit`);
  }
  return problems;
};

export const approvedName = (id: string, surface: string) => `${id}__${surface.replace(/[^a-z0-9]+/gi, '-')}`;

export const isListed = (photos: ValidationPhoto[], id: string, surface: string) =>
  photos.some((p) => p.id === id && p.surfaces.includes(surface));
