import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

const imageSchema = z.object({
  name: z.string().min(1).max(191),
  imageUrl: z.string().url(),
});

const hotspotSchema = z.object({
  label: z.string().min(1).max(191),
  xPct: z.number().min(0).max(100),
  yPct: z.number().min(0).max(100),
  allowedCategories: z.array(z.string().min(1)).min(1),
});

const serializeHotspot = (h: { allowedCategories: string; [key: string]: unknown }) => ({
  ...h,
  allowedCategories: h.allowedCategories.split(',').filter(Boolean),
});

const serializeImage = (img: { hotspots?: Array<{ allowedCategories: string; [key: string]: unknown }>; [key: string]: unknown }) => ({
  ...img,
  hotspots: (img.hotspots ?? []).map(serializeHotspot),
});

export const listShowcaseImages = async (req: Request, res: Response) => {
  const images = await prisma.showcaseImage.findMany({
    where: { tenantId: req.user!.tenantId },
    include: { hotspots: true },
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
    include: { hotspots: true },
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

export const deleteShowcaseImage = async (req: Request, res: Response) => {
  const result = await loadOwnedShowcaseImage(req.params.id, req.user!.tenantId);
  if ('error' in result) {
    res.status(result.error).json({ error: result.error === 404 ? 'Not found' : 'Forbidden' });
    return;
  }
  await prisma.showcaseImage.delete({ where: { id: req.params.id } });
  res.status(204).send();
};

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
  const hotspot = await prisma.hotspot.create({
    data: {
      showcaseImageId: req.params.imageId,
      label: parsed.data.label,
      xPct: parsed.data.xPct,
      yPct: parsed.data.yPct,
      allowedCategories: parsed.data.allowedCategories.join(','),
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
  await prisma.hotspot.delete({ where: { id: req.params.id } });
  res.status(204).send();
};
