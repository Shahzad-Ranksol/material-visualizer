import jwt from 'jsonwebtoken';

export interface TenantJwtPayload {
  kind: 'tenant';
  userId: string;
  tenantId: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  materialCategory: string;
}

export interface AdminJwtPayload {
  kind: 'admin';
  adminId: string;
}

export type JwtPayload = TenantJwtPayload | AdminJwtPayload;

const getSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set');
  }
  return secret;
};

export const signToken = (payload: JwtPayload): string => {
  return jwt.sign(payload, getSecret(), { expiresIn: '7d' });
};

export const verifyToken = (token: string): JwtPayload => {
  return jwt.verify(token, getSecret()) as JwtPayload;
};

export const isTenantPayload = (payload: JwtPayload): payload is TenantJwtPayload => payload.kind === 'tenant';
export const isAdminPayload = (payload: JwtPayload): payload is AdminJwtPayload => payload.kind === 'admin';
