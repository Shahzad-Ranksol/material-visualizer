// Downloads the validation photos (validation/manifest.json) into the git-ignored
// validation/.cache/<id>.jpg. Idempotent; reports every failure and exits non-zero on any.
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const photos = JSON.parse(await readFile(join(root, 'validation/manifest.json'), 'utf8'));
const exists = (p) => stat(p).then(() => true, () => false);
let failed = 0;
for (const p of photos) {
  const dest = join(root, 'validation/.cache', `${p.id}.jpg`);
  if (await exists(dest)) {
    console.log(`present    ${p.id}`);
    continue;
  }
  try {
    const res = await fetch(p.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, Buffer.from(await res.arrayBuffer()));
    console.log(`downloaded ${p.id}`);
  } catch (err) {
    failed++;
    console.error(`FAILED     ${p.id}: ${err.message}`);
  }
}
if (failed) process.exit(1);
