import type { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { signToken } from '../lib/jwt.js';
import { slugify } from '../lib/slugify.js';
import { MATERIAL_CATEGORIES } from '../lib/materialCategories.js';

const registerSchema = z.object({
  tenantName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
  materialCategory: z.enum(MATERIAL_CATEGORIES),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const register = async (req: Request, res: Response) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { tenantName, email, password, name, materialCategory } = parsed.data;

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    res.status(409).json({ error: 'Email already registered' });
    return;
  }

  const baseSlug = slugify(tenantName);
  let slug = baseSlug;
  let suffix = 1;
  while (await prisma.tenant.findUnique({ where: { slug } })) {
    suffix += 1;
    slug = `${baseSlug}-${suffix}`;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const tenant = await prisma.tenant.create({
    data: {
      name: tenantName,
      slug,
      materialCategory,
      status: 'PENDING',
      users: {
        create: {
          email,
          passwordHash,
          name,
          role: 'OWNER',
        },
      },
    },
  });

  // No token is minted here — a PENDING tenant can't use the API yet, so a
  // session would just be rejected by every subsequent call. `login` is the
  // single place that gates on approval status.
  res.status(201).json({
    status: tenant.status,
    message: 'Your studio account has been submitted for review. You will be able to sign in once an admin approves it.',
    tenant: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      materialCategory: tenant.materialCategory,
      status: tenant.status,
    },
  });
};

export const login = async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email }, include: { tenant: true } });
  if (!user) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  if (user.tenant.status === 'PENDING') {
    res.status(403).json({ error: 'Your studio account is awaiting admin approval.' });
    return;
  }
  if (user.tenant.status === 'REJECTED') {
    res.status(403).json({ error: 'Your studio account application was not approved.' });
    return;
  }

  const token = signToken({
    kind: 'tenant',
    userId: user.id,
    tenantId: user.tenantId,
    role: user.role,
    materialCategory: user.tenant.materialCategory,
  });
  res.status(200).json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenantId },
    tenant: {
      id: user.tenant.id,
      name: user.tenant.name,
      slug: user.tenant.slug,
      materialCategory: user.tenant.materialCategory,
      status: user.tenant.status,
    },
  });
};
