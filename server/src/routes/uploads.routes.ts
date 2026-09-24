import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { uploadImageHandler } from '../controllers/uploads.controller.js';
import { IMAGE_EXTENSIONS } from '../lib/storage.js';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype in IMAGE_EXTENSIONS),
});

export const uploadsRouter = Router();

uploadsRouter.use(requireAuth);
uploadsRouter.post('/image', upload.single('file'), uploadImageHandler);
