import jwt from 'jsonwebtoken';

export interface JwtPayload {
  userId: string;
  tenantId: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
}

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
