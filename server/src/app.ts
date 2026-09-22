import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth.routes.js';
import { materialsRouter } from './routes/materials.routes.js';
import { showcaseRouter } from './routes/showcase.routes.js';
import { publicRouter } from './routes/public.routes.js';
import { adminRouter } from './routes/admin.routes.js';
import { errorHandler } from './middleware/errorHandler.js';

export const createApp = () => {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/materials', materialsRouter);
  app.use('/api/showcase', showcaseRouter);
  app.use('/api/public', publicRouter);
  app.use('/api/admin', adminRouter);

  app.use(errorHandler);

  return app;
};
