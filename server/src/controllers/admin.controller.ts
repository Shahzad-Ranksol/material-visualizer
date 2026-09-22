import type { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { signToken } from '../lib/jwt.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const adminLogin = async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { email, password } = parsed.data;

  const admin = await prisma.admin.findUnique({ where: { email } });
  if (!admin) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const valid = await bcrypt.compare(password, admin.passwordHash);
  if (!valid) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const token = signToken({ kind: 'admin', adminId: admin.id });
  res.status(200).json({
    token,
    admin: { id: admin.id, email: admin.email, name: admin.name },
  });
};

const statusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED']);

export const listTenants = async (req: Request, res: Response) => {
  const statusParam = req.query.status;
  const parsedStatus = typeof statusParam === 'string' ? statusSchema.safeParse(statusParam) : null;

  const tenants = await prisma.tenant.findMany({
    where: parsedStatus?.success ? { status: parsedStatus.data } : undefined,
    include: { users: { where: { role: 'OWNER' }, take: 1 } },
    orderBy: { createdAt: 'desc' },
  });

  res.json(
    tenants.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      materialCategory: t.materialCategory,
      status: t.status,
      createdAt: t.createdAt,
      ownerEmail: t.users[0]?.email ?? null,
    }))
  );
};

const setTenantStatus = (status: 'APPROVED' | 'REJECTED') => async (req: Request, res: Response) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
  if (!tenant) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const updated = await prisma.tenant.update({ where: { id: req.params.id }, data: { status } });
  res.json({
    id: updated.id,
    name: updated.name,
    slug: updated.slug,
    materialCategory: updated.materialCategory,
    status: updated.status,
  });
};

export const approveTenant = setTenantStatus('APPROVED');
export const rejectTenant = setTenantStatus('REJECTED');
