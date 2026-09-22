import type { NextFunction, Request, Response } from 'express';
import { verifyToken, isAdminPayload } from '../lib/jwt.js';

export const requireAdminAuth = (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: 'Missing bearer token' });
    return;
  }

  try {
    const payload = verifyToken(token);
    if (!isAdminPayload(payload)) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }
    req.admin = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};
