// Dev-server-only endpoints for the scene bake tool (/dev/scenes) and the style lab (/dev/styles).
// Not part of the production build (`apply: 'serve'`); the AI keys are read from .env here and
// never reach the browser bundle.
//   POST /__scenes/save     a baked item's masks → public/scenes/<scene>/[styles/<key>/]<item>.part<N>.png
//                           (+ .occluder.png) and its planes → scenes/baked.json or scenes/styles.baked.json
//   POST /__styles/generate photo + mask + prompt → AI candidates (Gemini or OpenAI, server-side)
//   POST /__styles/save     a chosen style's patch → public/scenes/<scene>/styles/<key>/patch.webp
//   GET  /__scenes/baked, /__styles/baked
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv, type Plugin } from 'vite';

type Json = Record<string, unknown>;

// Image-AI providers. Each takes the (padded) photo and a mask whose white area may change, and
// returns full images at the input's size or the provider's nearest size (the page crops back)
const gemini = async (key: string, image: string, mask: string, prompt: string): Promise<string> => {
  const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image';
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: `${prompt} The second image is the mask: change only where it is white.` },
            { inline_data: { mime_type: 'image/png', data: image } },
            { inline_data: { mime_type: 'image/png', data: mask } },
          ],
        },
      ],
      generationConfig: { responseModalities: ['IMAGE'] },
    }),
  });
  const body = (await res.json()) as Json;
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  const parts = ((body.candidates as Json[] | undefined)?.[0]?.content as Json | undefined)?.parts as Json[] | undefined;
  const img = parts?.map((p) => (p.inlineData ?? p.inline_data) as Json | undefined).find((d) => d?.data);
  if (!img) throw new Error('Gemini returned no image');
  return img.data as string;
};

const openai = async (key: string, image: string, alphaMask: string, prompt: string, size: string): Promise<string> => {
  const form = new FormData();
  form.append('model', process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1');
  form.append('prompt', prompt);
  form.append('size', size);
  form.append('quality', 'high');
  form.append('image', new Blob([Buffer.from(image, 'base64')], { type: 'image/png' }), 'image.png');
  form.append('mask', new Blob([Buffer.from(alphaMask, 'base64')], { type: 'image/png' }), 'mask.png');
  const res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form });
  const body = (await res.json()) as Json;
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  const b64 = (body.data as Json[] | undefined)?.[0]?.b64_json as string | undefined;
  if (!b64) throw new Error('OpenAI returned no image');
  return b64;
};

export const sceneBakeDevServer = (root: string): Plugin => {
  const bakedFile = path.join(root, 'scenes', 'baked.json');
  const stylesFile = path.join(root, 'scenes', 'styles.baked.json');
  // The latest AI candidates per style, kept so a pick can come later (git-ignored)
  const candidateDir = (sceneId: string, key: string) => path.join(root, 'scenes', '.candidates', sceneId, key);
  const readJson = (f: string) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {});
  const writeJson = (f: string, v: unknown) => fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n');
  // Only plain names ever reach the file system (no path separators or dots)
  const safe = (s: unknown): s is string => typeof s === 'string' && /^[a-z0-9_-]+$/i.test(s);
  return {
    name: 'scene-bake-dev-server',
    apply: 'serve',
    configureServer(server) {
      const env = loadEnv(server.config.mode, root, '');
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        const json = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };
        // Read through here, not imported, so a save doesn't hot-reload the page mid-run
        if (req.method === 'GET' && url === '/__scenes/baked') return json(200, readJson(bakedFile));
        if (req.method === 'GET' && url === '/__styles/baked') return json(200, readJson(stylesFile));
        if (req.method === 'GET' && url === '/__styles/candidates') {
          const q = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
          const sceneId = q.get('sceneId');
          const key = q.get('styleKey');
          if (!safe(sceneId) || !safe(key)) return json(400, { error: 'bad ids' });
          const dir = candidateDir(sceneId, key);
          const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort() : [];
          return json(200, { candidates: files.map((f) => fs.readFileSync(path.join(dir, f)).toString('base64')) });
        }
        if (req.method === 'GET' && url === '/__styles/provider')
          return json(200, { provider: env.GEMINI_API_KEY ? 'gemini' : env.OPENAI_API_KEY ? 'openai' : null });
        if (req.method !== 'POST' || !['/__scenes/save', '/__styles/generate', '/__styles/save'].includes(url)) return next();
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', async () => {
          try {
            const body = JSON.parse(raw);
            const { sceneId } = body;
            if (!safe(sceneId)) return json(400, { error: 'bad scene id' });
            const sceneDir = path.join(root, 'public', 'scenes', sceneId);
            if (!['photo.jpg', 'photo.png'].some((f) => fs.existsSync(path.join(sceneDir, f)))) return json(400, { error: `${sceneId} has no photo — run npm run scenes:fetch` });

            if (url === '/__styles/generate') {
              const { image, mask, alphaMask, prompt, size, count = 1, styleKey } = body;
              const runs = Array.from({ length: Math.min(4, Math.max(1, count)) }, () =>
                env.GEMINI_API_KEY
                  ? gemini(env.GEMINI_API_KEY, image, mask, prompt)
                  : env.OPENAI_API_KEY
                    ? openai(env.OPENAI_API_KEY, image, alphaMask, prompt, size)
                    : Promise.reject(new Error('Set GEMINI_API_KEY or OPENAI_API_KEY in .env, then restart the dev server'))
              );
              const settled = await Promise.allSettled(runs);
              const candidates = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
              const errors = settled.flatMap((r) => (r.status === 'rejected' ? [String(r.reason?.message ?? r.reason)] : []));
              if (candidates.length && safe(styleKey)) {
                const dir = candidateDir(sceneId, styleKey);
                fs.rmSync(dir, { recursive: true, force: true });
                fs.mkdirSync(dir, { recursive: true });
                candidates.forEach((c, i) => fs.writeFileSync(path.join(dir, `c${i + 1}.png`), Buffer.from(c, 'base64')));
              }
              return json(candidates.length ? 200 : 502, { candidates, errors, provider: env.GEMINI_API_KEY ? 'gemini' : 'openai' });
            }

            if (url === '/__styles/save') {
              const { styleKey, rect, patch, provider, prompt } = body;
              if (!safe(styleKey)) return json(400, { error: 'bad style key' });
              const dir = path.join(sceneDir, 'styles', styleKey);
              fs.mkdirSync(dir, { recursive: true });
              // A new patch makes the style's old item bakes stale: start the folder fresh
              for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f));
              fs.writeFileSync(path.join(dir, 'patch.webp'), Buffer.from(patch, 'base64'));
              const styles = readJson(stylesFile);
              (styles[sceneId] ??= {})[styleKey] = {
                rect,
                patch: `/scenes/${sceneId}/styles/${styleKey}/patch.webp?v=${Date.now().toString(36)}`,
                provider,
                prompt,
                createdAt: new Date().toISOString(),
                items: {},
              };
              writeJson(stylesFile, styles);
              return json(200, { ok: true });
            }

            // /__scenes/save — an item of the scene, or of one of its styles
            const { itemId, styleKey, width, height, analysisVersion, confidence, edited, parts, occluder } = body;
            if (!safe(itemId) || (styleKey !== undefined && !safe(styleKey))) return json(400, { error: 'bad item or style id' });
            if (!Array.isArray(parts) || !parts.length) return json(400, { error: 'no parts' });
            const dir = styleKey ? path.join(sceneDir, 'styles', styleKey) : sceneDir;
            const urlBase = styleKey ? `/scenes/${sceneId}/styles/${styleKey}` : `/scenes/${sceneId}`;
            if (styleKey && !fs.existsSync(path.join(dir, 'patch.webp'))) return json(400, { error: `style ${styleKey} has no patch yet` });
            // Drop the item's previous files (a re-bake may have fewer planes)
            for (const f of fs.readdirSync(dir)) if (f.startsWith(`${itemId}.`) && f.endsWith('.png')) fs.unlinkSync(path.join(dir, f));
            const partFiles = parts.map((p: { png: string }, i: number) => {
              const name = `${itemId}.part${i}.png`;
              fs.writeFileSync(path.join(dir, name), Buffer.from(p.png, 'base64'));
              return `${urlBase}/${name}`;
            });
            let occluderUrl: string | null = null;
            if (occluder) {
              fs.writeFileSync(path.join(dir, `${itemId}.occluder.png`), Buffer.from(occluder, 'base64'));
              occluderUrl = `${urlBase}/${itemId}.occluder.png`;
            }
            const item = {
              parts: parts.map((p: { plane: unknown }, i: number) => ({ mask: partFiles[i], plane: p.plane ?? null })),
              occluder: occluderUrl,
              confidence: Math.round(confidence * 1000) / 1000,
              edited: !!edited,
              bakedAt: new Date().toISOString(),
            };
            if (styleKey) {
              const styles = readJson(stylesFile);
              const entry = styles[sceneId]?.[styleKey];
              if (!entry) return json(400, { error: `style ${styleKey} is not in styles.baked.json` });
              entry.items[itemId] = item;
              writeJson(stylesFile, styles);
            } else {
              const baked = readJson(bakedFile);
              const scene = (baked[sceneId] ??= { width, height, analysisVersion, items: {} });
              Object.assign(scene, { width, height, analysisVersion });
              scene.items[itemId] = item;
              writeJson(bakedFile, baked);
            }
            json(200, { ok: true });
          } catch (err) {
            json(400, { error: String(err) });
          }
        });
      });
    },
  };
};
