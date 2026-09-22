import type { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { signToken } from '../lib/jwt.js';
import { slugify } from '../lib/slugify.js';

const registerSchema = z.object({
  tenantName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
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
  const { tenantName, email, password, name } = parsed.data;

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
      users: {
        create: {
          email,
          passwordHash,
          name,
          role: 'OWNER',
        },
      },
    },
    include: { users: true },
  });

  const user = tenant.users[0];
  const token = signToken({ userId: user.id, tenantId: tenant.id, role: user.role });

  res.status(201).json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, tenantId: tenant.id },
    tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
  });
};

export const login = async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const token = signToken({ userId: user.id, tenantId: user.tenantId, role: user.role });
  const tenant = await prisma.tenant.findUnique({ where: { id: user.tenantId } });
  res.status(200).json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenantId },
    tenant: tenant ? { id: tenant.id, name: tenant.name, slug: tenant.slug } : undefined,
  });
};
