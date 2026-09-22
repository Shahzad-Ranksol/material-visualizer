import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  listMaterials,
  createMaterial,
  updateMaterial,
  deleteMaterial,
} from '../controllers/materials.controller.js';

export const materialsRouter = Router();

materialsRouter.use(requireAuth);
materialsRouter.get('/', listMaterials);
materialsRouter.post('/', createMaterial);
materialsRouter.put('/:id', updateMaterial);
materialsRouter.delete('/:id', deleteMaterial);
