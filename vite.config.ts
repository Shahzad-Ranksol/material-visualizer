import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { validationDevServer } from './scripts/validationDevServer';
import { sceneBakeDevServer } from './scripts/sceneBakeDevServer';

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

// The full-size scans and the analysis models in public/ are for local work (the bake tool, the
// validation tools); the studio ships only the web-sized /materials/ and the baked scenes, so a
// production build leaves them out of dist/
const devOnlyPublic = (): Plugin => ({
  name: 'dev-only-public',
  apply: 'build',
  closeBundle() {
    for (const dir of ['models', 'textures']) fs.rmSync(path.join(__dirname, 'dist', dir), { recursive: true, force: true });
  },
});

// Production only: a short content hash of every file under public/scenes/, which the scene data
// appends to its URLs (scenes/assetUrl.ts), so a changed mask or photo is never served from a
// browser's cache of the old one
const sceneAssetHashes = () => {
  const root = path.join(__dirname, 'public');
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else out['/' + path.relative(root, full).split(path.sep).join('/')] = crypto.createHash('sha1').update(fs.readFileSync(full)).digest('hex').slice(0, 10);
    }
  };
  walk(path.join(root, 'scenes'));
  return out;
};

export default defineConfig(({ command }) => {
    return {
      define: command === 'build' ? { __SCENE_ASSETS__: JSON.stringify(sceneAssetHashes()) } : {},
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react(), modelsNotFound(), validationDevServer(__dirname), sceneBakeDevServer(__dirname), devOnlyPublic()],
      // Served as-is (not pre-bundled) so ONNX Runtime resolves its own .wasm/.mjs files next to
      // itself: from node_modules in dev, emitted into the build for production — the app serves
      // them from its own origin, never a CDN
      optimizeDeps: {
        exclude: ['@huggingface/transformers', 'onnxruntime-web'],
      },
      worker: {
        format: 'es' as const,
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
