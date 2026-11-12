// Downloads the renderer's local assets once into public/ so the app serves them from its own
// origin — no third-party API or CDN at runtime. Idempotent: existing files are skipped.
//   public/textures/<id>.jpg | <id>_thumb.png | <id>_nor_gl.jpg | <id>_rough.jpg   (Poly Haven, CC0;
//   an entry with `ambientcg` is that ambientCG material instead, also CC0)
//   public/models/<repo>/<file>                                               (Hugging Face)
import { mkdir, writeFile, stat, readFile, copyFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

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

// An ambientCG material (2K JPG zip): its colour, OpenGL normal and roughness maps, the preview
// as the thumbnail, the chip cut from the colour map as for Poly Haven scans
const fetchAmbientCg = async (id, asset) => {
  const dir = join(root, 'public/textures');
  const maps = { Color: `${id}.jpg`, NormalGL: `${id}_nor_gl.jpg`, Roughness: `${id}_rough.jpg` };
  if (!(await Promise.all(Object.values(maps).map((f) => exists(join(dir, f))))).every(Boolean)) {
    const tmp = join(root, 'node_modules/.cache/ambientcg', asset);
    await mkdir(tmp, { recursive: true });
    const zip = join(tmp, `${asset}.zip`);
    await download(`https://ambientcg.com/get?file=${asset}_2K-JPG.zip`, zip);
    for (const [kind, name] of Object.entries(maps)) {
      const entry = `${asset}_2K-JPG_${kind}.jpg`;
      execFileSync('unzip', ['-o', '-j', '-q', zip, entry, '-d', tmp]);
      await copyFile(join(tmp, entry), join(dir, name));
      log(true, `textures/${name}`);
    }
  }
  log(await download(`https://acg-media.struffelproductions.com/file/ambientCG-Web/media/thumbnail/256-PNG/${asset}.png`, join(dir, `${id}_thumb.png`)), `textures/${id}_thumb.png`);
  const chip = join(dir, `${id}_chip.jpg`);
  if (!(await exists(chip))) {
    execFileSync('ffmpeg', ['-loglevel', 'error', '-i', join(dir, `${id}.jpg`), '-vf', 'crop=iw/3:iw/3,scale=256:256', '-q:v', '3', chip]);
    log(true, `textures/${id}_chip.jpg`);
  }
};

if (!only || only === 'textures') {
  for (const [id, opts] of Object.entries(manifest.textures)) {
    if (opts.ambientcg) {
      await fetchAmbientCg(id, opts.ambientcg);
      continue;
    }
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
    // The studio's swatch chip: a flat 256 px crop from the middle of the scan (needs ffmpeg)
    const chip = join(root, 'public/textures', `${id}_chip.jpg`);
    if (!(await exists(chip))) {
      execFileSync('ffmpeg', ['-loglevel', 'error', '-i', join(root, 'public/textures', `${id}.jpg`), '-vf', 'crop=iw/3:iw/3,scale=256:256', '-q:v', '3', chip]);
      log(true, `textures/${id}_chip.jpg`);
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
