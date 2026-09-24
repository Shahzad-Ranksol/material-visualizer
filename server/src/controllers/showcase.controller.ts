import type { Request, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { deleteTenantImage } from '../lib/storage.js';
import { hotspotSchema, surfaceSchema } from '../lib/showcaseSchemas.js';

const imageSchema = z.object({
  name: z.string().min(1).max(191),
  imageUrl: z.string().url(),
});

const jsonOrNull = (value: unknown) => (value === null || value === undefined ? Prisma.JsonNull : (value as Prisma.InputJsonValue));

export const serializeHotspot = (h: { allowedCategories: string; [key: string]: unknown }) => ({
  ...h,
  allowedCategories: h.allowedCategories.split(',').filter(Boolean),
});

export const serializeImage = (img: {
  hotspots?: Array<{ allowedCategories: string; [key: string]: unknown }>;
  surfaces?: unknown[];
  [key: string]: unknown;
}) => ({
  ...img,
  hotspots: (img.hotspots ?? []).map(serializeHotspot),
  surfaces: img.surfaces ?? [],
});

export const showcaseInclude = { hotspots: true, surfaces: true } as const;

const surfaceFiles = (s: { maskUrl: string; occluderMaskUrl: string | null; lightingMapUrl: string | null }) =>
  [s.maskUrl, s.occluderMaskUrl, s.lightingMapUrl].filter((u): u is string => Boolean(u));

export const listShowcaseImages = async (req: Request, res: Response) => {
  const images = await prisma.showcaseImage.findMany({
    where: { tenantId: req.user!.tenantId },
    include: showcaseInclude,
    orderBy: { createdAt: 'desc' },
  });
  res.json(images.map(serializeImage));
};

export const createShowcaseImage = async (req: Request, res: Response) => {
  const parsed = imageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const image = await prisma.showcaseImage.create({
    data: { ...parsed.data, tenantId: req.user!.tenantId },
    include: showcaseInclude,
  });
  res.status(201).json(serializeImage(image));
};

type OwnedImageResult = { error: 404 | 403 } | { image: Awaited<ReturnType<typeof prisma.showcaseImage.findUniqueOrThrow>> };

const loadOwnedShowcaseImage = async (id: string, tenantId: string): Promise<OwnedImageResult> => {
  const image = await prisma.showcaseImage.findUnique({ where: { id } });
  if (!image) {
    return { error: 404 };
  }
  if (image.tenantId !== tenantId) {
    return { error: 403 };
  }
  return { image };
};

export const updateShowcaseImage = async (req: Request, res: Response) => {
  const result = await loadOwnedShowcaseImage(req.params.id, req.user!.tenantId);
  if ('error' in result) {
    res.status(result.error).json({ error: result.error === 404 ? 'Not found' : 'Forbidden' });
    return;
  }

  const parsed = imageSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const updated = await prisma.showcaseImage.update({
    where: { id: req.params.id },
    data: parsed.data,
    include: showcaseInclude,
  });
  res.json(serializeImage(updated));
};

export const deleteShowcaseImage = async (req: Request, res: Response) => {
  const result = await loadOwnedShowcaseImage(req.params.id, req.user!.tenantId);
  if ('error' in result) {
    res.status(result.error).json({ error: result.error === 404 ? 'Not found' : 'Forbidden' });
    return;
  }
  const surfaces = await prisma.surface.findMany({ where: { showcaseImageId: req.params.id } });
  await prisma.showcaseImage.delete({ where: { id: req.params.id } });
  await Promise.all(
    [result.image.imageUrl, ...surfaces.flatMap(surfaceFiles)].map((url) => deleteTenantImage(req.user!.tenantId, url))
  );
  res.status(204).send();
};

// --- Surfaces ---------------------------------------------------------------------------

type OwnedSurfaceResult =
  | { error: 404 | 403 }
  | { surface: Awaited<ReturnType<typeof prisma.surface.findUniqueOrThrow>> };

const loadOwnedSurface = async (id: string, tenantId: string): Promise<OwnedSurfaceResult> => {
  const surface = await prisma.surface.findUnique({ where: { id }, include: { showcaseImage: true } });
  if (!surface) {
    return { error: 404 };
  }
  if (surface.showcaseImage.tenantId !== tenantId) {
    return { error: 403 };
  }
  const { showcaseImage: _image, ...rest } = surface;
  return { surface: rest };
};

export const createSurface = async (req: Request, res: Response) => {
  const result = await loadOwnedShowcaseImage(req.params.imageId, req.user!.tenantId);
  if ('error' in result) {
    res.status(result.error).json({ error: result.error === 404 ? 'Not found' : 'Forbidden' });
    return;
  }
  const parsed = surfaceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  if (!(await surfaceBelongsTo(parsed.data.parentSurfaceId, req.params.imageId))) {
    res.status(400).json({ error: 'parentSurfaceId must belong to this image' });
    return;
  }
  const { plane, calibration, modelVersions, ...rest } = parsed.data;
  const surface = await prisma.surface.create({
    data: {
      ...rest,
      showcaseImageId: req.params.imageId,
      plane: jsonOrNull(plane),
      calibration: jsonOrNull(calibration),
      modelVersions: jsonOrNull(modelVersions),
    },
  });
  res.status(201).json(surface);
};

export const updateSurface = async (req: Request, res: Response) => {
  const result = await loadOwnedSurface(req.params.id, req.user!.tenantId);
  if ('error' in result) {
    res.status(result.error).json({ error: result.error === 404 ? 'Not found' : 'Forbidden' });
    return;
  }
  const parsed = surfaceSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  if (!(await surfaceBelongsTo(parsed.data.parentSurfaceId, result.surface.showcaseImageId))) {
    res.status(400).json({ error: 'parentSurfaceId must belong to this image' });
    return;
  }
  const { plane, calibration, modelVersions, ...rest } = parsed.data;
  const updated = await prisma.surface.update({
    where: { id: req.params.id },
    data: {
      ...rest,
      ...(plane !== undefined ? { plane: jsonOrNull(plane) } : {}),
      ...(calibration !== undefined ? { calibration: jsonOrNull(calibration) } : {}),
      ...(modelVersions !== undefined ? { modelVersions: jsonOrNull(modelVersions) } : {}),
    },
  });
  // Files the update replaced are no longer referenced
  const kept = new Set(surfaceFiles(updated));
  await Promise.all(
    surfaceFiles(result.surface)
      .filter((url) => !kept.has(url))
      .map((url) => deleteTenantImage(req.user!.tenantId, url))
  );
  res.json(updated);
};

export const deleteSurface = async (req: Request, res: Response) => {
  const result = await loadOwnedSurface(req.params.id, req.user!.tenantId);
  if ('error' in result) {
    res.status(result.error).json({ error: result.error === 404 ? 'Not found' : 'Forbidden' });
    return;
  }
  const parts = await prisma.surface.findMany({ where: { parentSurfaceId: req.params.id } });
  await prisma.surface.delete({ where: { id: req.params.id } }); // parts cascade
  await Promise.all(
    [result.surface, ...parts].flatMap(surfaceFiles).map((url) => deleteTenantImage(req.user!.tenantId, url))
  );
  res.status(204).send();
};

// A hotspot may only point at a surface of its own image
const surfaceBelongsTo = async (surfaceId: string | null | undefined, showcaseImageId: string) => {
  if (!surfaceId) return true;
  const surface = await prisma.surface.findUnique({ where: { id: surfaceId } });
  return surface?.showcaseImageId === showcaseImageId;
};

// --- Hotspots ---------------------------------------------------------------------------

export const createHotspot = async (req: Request, res: Response) => {
  const result = await loadOwnedShowcaseImage(req.params.imageId, req.user!.tenantId);
  if ('error' in result) {
    res.status(result.error).json({ error: result.error === 404 ? 'Not found' : 'Forbidden' });
    return;
  }
  const parsed = hotspotSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  if (!(await surfaceBelongsTo(parsed.data.surfaceId, req.params.imageId))) {
    res.status(400).json({ error: 'surfaceId must belong to this image' });
    return;
  }
  const hotspot = await prisma.hotspot.create({
    data: {
      showcaseImageId: req.params.imageId,
      label: parsed.data.label,
      xPct: parsed.data.xPct,
      yPct: parsed.data.yPct,
      allowedCategories: parsed.data.allowedCategories.join(','),
      surfaceId: parsed.data.surfaceId ?? null,
    },
  });
  res.status(201).json(serializeHotspot(hotspot));
};

type OwnedHotspotResult =
  | { error: 404 | 403 }
  | { hotspot: Awaited<ReturnType<typeof prisma.hotspot.findUniqueOrThrow>> };

const loadOwnedHotspot = async (id: string, tenantId: string): Promise<OwnedHotspotResult> => {
  const hotspot = await prisma.hotspot.findUnique({ where: { id }, include: { showcaseImage: true } });
  if (!hotspot) {
    return { error: 404 };
  }
  if (hotspot.showcaseImage.tenantId !== tenantId) {
    return { error: 403 };
  }
  return { hotspot };
};

export const updateHotspot = async (req: Request, res: Response) => {
  const result = await loadOwnedHotspot(req.params.id, req.user!.tenantId);
  if ('error' in result) {
    res.status(result.error).json({ error: result.error === 404 ? 'Not found' : 'Forbidden' });
    return;
  }

  const parsed = hotspotSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  if (!(await surfaceBelongsTo(parsed.data.surfaceId, result.hotspot.showcaseImageId))) {
    res.status(400).json({ error: 'surfaceId must belong to this image' });
    return;
  }

  const { allowedCategories, ...rest } = parsed.data;
  const updated = await prisma.hotspot.update({
    where: { id: req.params.id },
    data: {
      ...rest,
      ...(allowedCategories ? { allowedCategories: allowedCategories.join(',') } : {}),
    },
  });
  res.json(serializeHotspot(updated));
};

export const deleteHotspot = async (req: Request, res: Response) => {
  const result = await loadOwnedHotspot(req.params.id, req.user!.tenantId);
  if ('error' in result) {
    res.status(result.error).json({ error: result.error === 404 ? 'Not found' : 'Forbidden' });
    return;
  }
  // The surface is kept: it belongs to the photo and can serve other hotspots
  await prisma.hotspot.delete({ where: { id: req.params.id } });
  res.status(204).send();
};
