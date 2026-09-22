import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  listShowcaseImages,
  createShowcaseImage,
  deleteShowcaseImage,
  createHotspot,
  updateHotspot,
  deleteHotspot,
} from '../controllers/showcase.controller.js';

export const showcaseRouter = Router();

showcaseRouter.use(requireAuth);
showcaseRouter.get('/images', listShowcaseImages);
showcaseRouter.post('/images', createShowcaseImage);
showcaseRouter.delete('/images/:id', deleteShowcaseImage);
showcaseRouter.post('/images/:imageId/hotspots', createHotspot);
showcaseRouter.put('/hotspots/:id', updateHotspot);
showcaseRouter.delete('/hotspots/:id', deleteHotspot);
