import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

const materialSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  description: z.string().min(1),
  thumbnail: z.string().url(),
  finishType: z.string().min(1),
  colorTone: z.string().min(1),
  renderOverlayTone: z.string().optional(),
  tileScale: z.number().optional(),
  blendMode: z.enum(['soft-light', 'color', 'overlay']).optional(),
});

export const listMaterials = async (req: Request, res: Response) => {
  const { category } = req.query;
  const materials = await prisma.material.findMany({
    where: {
      AND: [
        { OR: [{ tenantId: req.user!.tenantId }, { tenantId: null }] },
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
  const material = await prisma.material.create({
    data: { ...parsed.data, tenantId: req.user!.tenantId },
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

  const updated = await prisma.material.update({
    where: { id: req.params.id },
    data: parsed.data,
  });
  res.json(updated);
};

export const deleteMaterial = async (req: Request, res: Response) => {
  const result = await loadOwnedMaterial(req.params.id, req.user!.tenantId);
  if ('error' in result) {
    res.status(result.error).json({ error: result.error === 404 ? 'Not found' : 'Forbidden' });
    return;
  }

  await prisma.material.delete({ where: { id: req.params.id } });
  res.status(204).send();
};
