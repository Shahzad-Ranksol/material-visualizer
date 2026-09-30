// Fills the validation set towards the plan's mix (20 wall, 15 floor, 10 cabinet-door,
// 10 countertop, 5 hard) with free-licence Unsplash photos, credited. Needs a free Unsplash
// developer Access Key in .env as UNSPLASH_ACCESS_KEY. Unsplash+ (premium) photos are skipped.
// Review the added photos in /dev/validation and delete any that don't fit.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const key = process.env.UNSPLASH_ACCESS_KEY;
if (!key) {
  console.error('Set UNSPLASH_ACCESS_KEY in .env (free key from https://unsplash.com/developers).');
  process.exit(1);
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, 'validation/manifest.json');
const photos = JSON.parse(await readFile(file, 'utf8'));

const TARGET = { wall: 20, floor: 15, 'cabinet-door': 10, countertop: 10, hard: 5 };
const SEARCH = {
  wall: { queries: ['living room interior wall', 'bedroom interior', 'empty room interior wall', 'dining room interior'], surfaces: ['wall'] },
  floor: { queries: ['living room floor interior', 'hardwood floor room', 'tiled floor interior', 'empty room floor'], surfaces: ['floor'] },
  'cabinet-door': { queries: ['kitchen cabinets', 'wardrobe interior', 'interior door hallway'], surfaces: ['cabinet'] },
  countertop: { queries: ['kitchen countertop', 'kitchen island interior', 'bathroom vanity countertop'], surfaces: ['countertop'] },
  hard: { queries: ['room with mirror interior', 'room curtains sunlight', 'living room plants interior', 'wide angle room interior'], surfaces: ['wall', 'floor'] },
};

const have = new Set(photos.map((p) => p.id));
for (const [category, { queries, surfaces }] of Object.entries(SEARCH)) {
  let count = photos.filter((p) => p.category === category).length;
  for (const q of queries) {
    if (count >= TARGET[category]) break;
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=30&orientation=landscape&content_filter=high`;
    const res = await fetch(url, { headers: { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' } });
    if (!res.ok) {
      console.error(`search "${q}": HTTP ${res.status}`);
      continue;
    }
    for (const r of (await res.json()).results) {
      if (count >= TARGET[category]) break;
      if (r.premium || r.plus || have.has(r.id)) continue;
      photos.push({
        id: r.id,
        url: `${r.urls.raw}&w=1600&q=85&fm=jpg&fit=max`,
        source: 'unsplash',
        credit: `${r.user.name} (${r.user.links.html})`,
        category,
        surfaces,
      });
      have.add(r.id);
      count++;
    }
  }
  console.log(`${category}: ${count}/${TARGET[category]}`);
}
await writeFile(file, JSON.stringify(photos, null, 2) + '\n');
