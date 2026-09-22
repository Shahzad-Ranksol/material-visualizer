import type { TenantJwtPayload, AdminJwtPayload } from '../lib/jwt.js';

declare global {
  namespace Express {
    interface Request {
      user?: TenantJwtPayload;
      admin?: AdminJwtPayload;
    }
  }
}

export {};
