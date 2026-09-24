import fs from 'fs';
import path from 'path';
import { defineConfig, loadEnv, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// The model loader probes for optional files (tokenizer.json, …). The SPA fallback would answer
// a missing one with index.html and 200, which the loader takes as the file — so under /models/
// a missing file must be a real 404. (Production hosting needs the same rule.)
const modelsNotFound = (): Plugin => {
  const guard = (req: { url?: string }, res: { statusCode: number; end: () => void }, next: () => void) => {
    const url = decodeURIComponent((req.url ?? '').split('?')[0]);
    if (url.startsWith('/models/') && !fs.existsSync(path.join(__dirname, 'public', url))) {
      res.statusCode = 404;
      res.end();
      return;
    }
    next();
  };
  return {
    name: 'models-not-found',
    configureServer: (server) => void server.middlewares.use(guard),
    configurePreviewServer: (server) => void server.middlewares.use(guard),
  };
};

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react(), modelsNotFound()],
      // Served as-is (not pre-bundled) so ONNX Runtime resolves its own .wasm/.mjs files next to
      // itself: from node_modules in dev, emitted into the build for production — the app serves
      // them from its own origin, never a CDN
      optimizeDeps: {
        exclude: ['@huggingface/transformers', 'onnxruntime-web'],
      },
      worker: {
        format: 'es',
      },
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
