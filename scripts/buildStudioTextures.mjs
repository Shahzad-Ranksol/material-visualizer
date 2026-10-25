// Web-sized copies of the scans the studio uses (scenes/materials.ts), committed under
// public/materials/ so a static deploy (Vercel) needs no asset download: colour 1024 px,
// normal/roughness 512 px, the swatch chip 256 px. Reads the full scans from public/textures/
// (npm run assets:fetch textures) and needs ffmpeg. Re-run after adding a scan to the catalogue.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'scenes/materials.ts'), 'utf8');
const ids = [...new Set([...src.matchAll(/scan\('([a-z0-9_]+)'\)/g)].map((m) => m[1]))];
const out = join(root, 'public/materials');
mkdirSync(out, { recursive: true });
const jobs = [
  ['.jpg', '.jpg', 1024, 4],
  ['_nor_gl.jpg', '_nor.jpg', 512, 3],
  ['_rough.jpg', '_rough.jpg', 512, 4],
  ['_chip.jpg', '_chip.jpg', 256, 3],
];
for (const id of ids) {
  for (const [from, to, size, q] of jobs) {
    const input = join(root, 'public/textures', id + from);
    if (!existsSync(input)) {
      console.error(`missing ${input} — run npm run assets:fetch textures`);
      process.exitCode = 1;
      continue;
    }
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', input, '-vf', `scale=${size}:${size}`, '-q:v', String(q), join(out, id + to)]);
  }
  console.log(`built ${id}`);
}
