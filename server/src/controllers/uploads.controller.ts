import type { Request, Response } from 'express';
import { uploadImage, type UploadFolder } from '../lib/storage.js';

const FOLDERS: UploadFolder[] = ['materials', 'showcase'];

export const uploadImageHandler = async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'Attach a PNG, JPEG or WebP image as the "file" field.' });
    return;
  }
  const folder = FOLDERS.find((f) => f === req.body.folder) ?? 'materials';
  try {
    const url = await uploadImage(req.user!.tenantId, folder, req.file.buffer, req.file.mimetype);
    res.status(201).json({ url });
  } catch (err) {
    console.error('Image upload to object storage failed', err);
    res.status(502).json({ error: 'Could not store the image. Is object storage running?' });
  }
};
