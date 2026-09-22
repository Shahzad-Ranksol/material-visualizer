import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';

const findTenantBySlug = (slug: string) => prisma.tenant.findUnique({ where: { slug } });

export const getPublicTenant = async (req: Request, res: Response) => {
  const tenant = await findTenantBySlug(req.params.slug);
  if (!tenant) {
    res.status(404).json({ error: 'Storefront not found' });
    return;
  }
  res.json({ id: tenant.id, name: tenant.name, slug: tenant.slug });
};

export const listPublicMaterials = async (req: Request, res: Response) => {
  const tenant = await findTenantBySlug(req.params.slug);
  if (!tenant) {
    res.status(404).json({ error: 'Storefront not found' });
    return;
  }
  // Deliberately different from GET /api/materials: never includes the shared
  // tenantId: null defaults — a public storefront shows only this vendor's own catalog.
  const materials = await prisma.material.findMany({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: 'desc' },
  });
  res.json(materials);
};

export const listPublicShowcase = async (req: Request, res: Response) => {
  const tenant = await findTenantBySlug(req.params.slug);
  if (!tenant) {
    res.status(404).json({ error: 'Storefront not found' });
    return;
  }
  const images = await prisma.showcaseImage.findMany({
    where: { tenantId: tenant.id },
    include: { hotspots: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json(
    images.map((img) => ({
      ...img,
      hotspots: img.hotspots.map((h) => ({
        ...h,
        allowedCategories: h.allowedCategories.split(',').filter(Boolean),
      })),
    }))
  );
};
