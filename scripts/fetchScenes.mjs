// Downloads the preset scene photos (scenes/photos.json) into public/scenes/<id>/photo.jpg plus a
// 480px thumb.jpg (ffmpeg). Both are committed; this only needs re-running when a photo changes
// (delete the old files first). Free-licence Unsplash photos, credited in the studio.
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const photos = JSON.parse(await readFile(join(root, 'scenes/photos.json'), 'utf8'));
const exists = (p) => stat(p).then(() => true, () => false);
for (const p of photos) {
  const dir = join(root, 'public/scenes', p.id);
  const photo = join(dir, p.file ?? 'photo.jpg');
  // Client renders are committed as supplied; only free-licence photos are downloaded
  if (!p.url) {
    console.log(`${(await exists(photo)) ? 'present   ' : 'MISSING   '} ${p.id} (supplied render)`);
    continue;
  }
  if (!(await exists(photo))) {
    const res = await fetch(p.url);
    if (!res.ok) throw new Error(`${p.id}: HTTP ${res.status}`);
    await mkdir(dir, { recursive: true });
    await writeFile(photo, Buffer.from(await res.arrayBuffer()));
    console.log(`downloaded ${p.id}`);
  } else console.log(`present    ${p.id}`);
  const thumb = join(dir, 'thumb.jpg');
  if (!(await exists(thumb))) execFileSync('ffmpeg', ['-loglevel', 'error', '-i', photo, '-vf', 'scale=480:-2', '-q:v', '4', thumb]);
}
