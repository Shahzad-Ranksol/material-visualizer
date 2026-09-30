// Dev-server-only endpoints for the validation tools (/dev/validation): the cached photos, the
// approved masks, writing a new approval (only for surfaces the manifest lists), and the latest
// scores with their history. Not part of the production build (`apply: 'serve'`).
import fs from 'node:fs';
import path from 'node:path';
import type { ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { approvedName, isListed, validateManifest, ValidationPhoto } from '../services/validation/manifest';

export const validationDevServer = (root: string): Plugin => {
  const dir = path.join(root, 'validation');
  const manifest = (): ValidationPhoto[] => {
    const photos = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    const problems = validateManifest(photos);
    if (problems.length) throw new Error(`validation/manifest.json: ${problems.join('; ')}`);
    return photos;
  };
  const sendFile = (res: ServerResponse, file: string, type: string) => {
    if (!fs.existsSync(file)) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader('Content-Type', type);
    res.end(fs.readFileSync(file));
  };
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  };
  // Only plain names ever reach the file system (no path separators or dots)
  const safe = (s: string) => /^[a-z0-9_-]+$/i.test(s);
  return {
    name: 'validation-dev-server',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? '').split('?')[0]);
        if (req.method === 'GET' && url.startsWith('/validation-cache/')) {
          const id = url.slice('/validation-cache/'.length).replace(/\.jpg$/, '');
          return safe(id) ? sendFile(res, path.join(dir, '.cache', `${id}.jpg`), 'image/jpeg') : json(res, 400, { error: 'bad id' });
        }
        if (req.method === 'GET' && url.startsWith('/validation-approved/')) {
          const name = url.slice('/validation-approved/'.length).replace(/\.png$/, '');
          return safe(name) ? sendFile(res, path.join(dir, 'approved', `${name}.png`), 'image/png') : json(res, 400, { error: 'bad name' });
        }
        if (req.method === 'GET' && url === '/__validation/state') {
          const approvedDir = path.join(dir, 'approved');
          const approved = fs.existsSync(approvedDir) ? fs.readdirSync(approvedDir).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)) : [];
          return json(res, 200, { photos: manifest(), approved });
        }
        if (req.method === 'GET' && url === '/__validation/results') {
          const latestFile = path.join(dir, 'results', 'latest.json');
          const historyFile = path.join(dir, 'history.jsonl');
          const latest = fs.existsSync(latestFile) ? JSON.parse(fs.readFileSync(latestFile, 'utf8')) : null;
          const history = fs.existsSync(historyFile) ? fs.readFileSync(historyFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
          return json(res, 200, { latest, history });
        }
        if (req.method === 'POST' && url === '/__validation/approve') {
          let body = '';
          req.on('data', (c) => (body += c));
          req.on('end', () => {
            try {
              const { id, surface, png, analysisVersion, notes } = JSON.parse(body);
              if (!isListed(manifest(), id, surface)) return json(res, 400, { error: `${id} / ${surface} is not in the manifest` });
              const name = approvedName(id, surface);
              fs.mkdirSync(path.join(dir, 'approved'), { recursive: true });
              fs.writeFileSync(path.join(dir, 'approved', `${name}.png`), Buffer.from(png, 'base64'));
              fs.writeFileSync(
                path.join(dir, 'approved', `${name}.json`),
                JSON.stringify({ approvedAt: new Date().toISOString(), analysisVersion, ...(notes ? { notes } : {}) }, null, 2) + '\n'
              );
              json(res, 200, { ok: true });
            } catch (err) {
              json(res, 400, { error: String(err) });
            }
          });
          return;
        }
        next();
      });
    },
  };
};
