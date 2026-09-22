import { Router } from 'express';
import { getPublicTenant, listPublicMaterials, listPublicShowcase } from '../controllers/public.controller.js';

export const publicRouter = Router();

publicRouter.get('/tenants/:slug', getPublicTenant);
publicRouter.get('/tenants/:slug/materials', listPublicMaterials);
publicRouter.get('/tenants/:slug/showcase', listPublicShowcase);
