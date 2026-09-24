import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { deleteTenantImage } from '../lib/storage.js';
import { defaultProfileFor, materialProfileSchema } from '../lib/materialProfile.js';

// A pasted http(s) link, or the object-storage URL returned by POST /api/uploads/image
const thumbnailSchema = z.string().url().max(2048).regex(/^https?:\/\//i, 'Must be an http(s) URL');

const materialSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  description: z.string().min(1),
  thumbnail: thumbnailSchema,
  finishType: z.string().min(1),
  colorTone: z.string().min(1),
}).merge(materialProfileSchema.partial());

export const listMaterials = async (req: Request, res: Response) => {
  const { category } = req.query;
  const materials = await prisma.material.findMany({
    where: {
      AND: [
        // Vendors see only their own catalog — a new tenant starts empty
        { tenantId: req.user!.tenantId },
        { category: req.user!.materialCategory },
        category ? { category: String(category) } : {},
      ],
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(materials);
};

export const createMaterial = async (req: Request, res: Response) => {
  const parsed = materialSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  if (parsed.data.category !== req.user!.materialCategory) {
    res.status(400).json({ error: `Category must be '${req.user!.materialCategory}' for this tenant.` });
    return;
  }
  // Profile fields the vendor didn't send start from the category's defaults
  const defaults = defaultProfileFor(parsed.data.category, `${parsed.data.finishType} ${parsed.data.description}`);
  const material = await prisma.material.create({
    data: { ...defaults, ...parsed.data, tenantId: req.user!.tenantId },
  });
  res.status(201).json(material);
};

type OwnedResult =
  | { error: 404 | 403 }
  | { material: Awaited<ReturnType<typeof prisma.material.findUniqueOrThrow>> };

const loadOwnedMaterial = async (id: string, tenantId: string): Promise<OwnedResult> => {
  const material = await prisma.material.findUnique({ where: { id } });
  if (!material) {
    return { error: 404 };
  }
  if (material.tenantId !== tenantId) {
    return { error: 403 };
  }
  return { material };
};

export const updateMaterial = async (req: Request, res: Response) => {
  const result = await loadOwnedMaterial(req.params.id, req.user!.tenantId);
  if ('error' in result) {
    res.status(result.error).json({ error: result.error === 404 ? 'Not found' : 'Forbidden' });
    return;
  }

  const parsed = materialSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  if (parsed.data.category && parsed.data.category !== req.user!.materialCategory) {
    res.status(400).json({ error: `Category must be '${req.user!.materialCategory}' for this tenant.` });
    return;
  }

  const updated = await prisma.material.update({
    where: { id: req.params.id },
    data: parsed.data,
  });
  if (parsed.data.thumbnail && parsed.data.thumbnail !== result.material.thumbnail) {
    await deleteTenantImage(req.user!.tenantId, result.material.thumbnail);
  }
  res.json(updated);
};

export const deleteMaterial = async (req: Request, res: Response) => {
  const result = await loadOwnedMaterial(req.params.id, req.user!.tenantId);
  if ('error' in result) {
    res.status(result.error).json({ error: result.error === 404 ? 'Not found' : 'Forbidden' });
    return;
  }

  await prisma.material.delete({ where: { id: req.params.id } });
  await deleteTenantImage(req.user!.tenantId, result.material.thumbnail);
  res.status(204).send();
};
