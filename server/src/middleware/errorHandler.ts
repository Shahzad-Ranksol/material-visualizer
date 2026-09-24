import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const errorHandler = (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof multer.MulterError) {
    res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Image must be 5MB or smaller.' : err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
};
