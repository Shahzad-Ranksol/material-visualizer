import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { serializeImage, showcaseInclude } from './showcase.controller.js';

const findApprovedTenantBySlug = (slug: string) => prisma.tenant.findFirst({ where: { slug, status: 'APPROVED' } });

export const getPublicTenant = async (req: Request, res: Response) => {
  const tenant = await findApprovedTenantBySlug(req.params.slug);
  if (!tenant) {
    res.status(404).json({ error: 'Storefront not found' });
    return;
  }
  res.json({ id: tenant.id, name: tenant.name, slug: tenant.slug });
};

export const listPublicMaterials = async (req: Request, res: Response) => {
  const tenant = await findApprovedTenantBySlug(req.params.slug);
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
  const tenant = await findApprovedTenantBySlug(req.params.slug);
  if (!tenant) {
    res.status(404).json({ error: 'Storefront not found' });
    return;
  }
  const images = await prisma.showcaseImage.findMany({
    where: { tenantId: tenant.id },
    include: showcaseInclude,
    orderBy: { createdAt: 'desc' },
  });
  // Surfaces ship with the showroom so customers render from saved analysis — no models run for them
  res.json(images.map(serializeImage));
};
