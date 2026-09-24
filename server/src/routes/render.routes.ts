import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getRenderCapabilities, harmonizeRender } from '../controllers/render.controller.js';

export const renderRouter = Router();

renderRouter.get('/capabilities', getRenderCapabilities);
renderRouter.post('/harmonize', requireAuth, harmonizeRender);
