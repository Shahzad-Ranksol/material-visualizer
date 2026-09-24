// Downloads the renderer's local assets once into public/ so the app serves them from its own
// origin — no third-party API or CDN at runtime. Idempotent: existing files are skipped.
//   public/textures/<id>.jpg | <id>_thumb.png | <id>_nor_gl.jpg | <id>_rough.jpg   (Poly Haven, CC0)
//   public/models/<repo>/<file>                                               (Hugging Face)
import { mkdir, writeFile, stat, readFile, copyFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(join(root, 'scripts/assets.manifest.json'), 'utf8'));
const only = process.argv[2]; // optional: "textures" | "models"

const exists = async (p) => stat(p).then(() => true, () => false);

const download = async (url, dest) => {
  if (await exists(dest)) return false;
  await mkdir(dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return true;
};

const log = (fresh, what) => console.log(`${fresh ? 'downloaded' : 'present   '} ${what}`);

if (!only || only === 'textures') {
  for (const [id, opts] of Object.entries(manifest.textures)) {
    const files = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json();
    const color = files[opts.colorKey ?? 'Diffuse'] ?? files.diff ?? files.Color;
    const maps = {
      [`${id}.jpg`]: color?.['2k']?.jpg?.url,
      [`${id}_nor_gl.jpg`]: files.nor_gl?.['1k']?.jpg?.url,
      [`${id}_rough.jpg`]: files.Rough?.['1k']?.jpg?.url ?? files.rough?.['1k']?.jpg?.url,
      [`${id}_thumb.png`]: `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=384&height=384`,
    };
    for (const [name, url] of Object.entries(maps)) {
      if (!url) continue;
      log(await download(url, join(root, 'public/textures', name)), `textures/${name}`);
    }
  }
}

if (!only || only === 'models') {
  for (const [repo, files] of Object.entries(manifest.models)) {
    for (const file of files) {
      const fresh = await download(`https://huggingface.co/${repo}/resolve/main/${file}`, join(root, 'public/models', repo, file));
      log(fresh, `models/${repo}/${file}`);
    }
  }
}
console.log('Assets ready.');
