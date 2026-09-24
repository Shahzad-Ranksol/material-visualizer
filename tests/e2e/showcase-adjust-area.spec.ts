import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, Page, Route, test } from '@playwright/test';
import type {
  AuthSession,
  NewHotspotInput,
  NewSurfaceInput,
  RemoteHotspot,
  RemoteShowcaseImage,
  RemoteSurface,
} from '../../services/apiClient';

// The vendor's "Adjust area" save path in the showcase editor: detect a wall, remove a block of
// it with the polygon tool, switch the plane to manual corners (which must keep the edit), save,
// and check both the uploaded mask and the reopened area carry the reduced coverage. The API is
// mocked with page.route (no MySQL/MinIO/API needed); the local models run for real. Uses the
// room photo cached by studio-flow.spec.ts (same URL).
const ROOM_URL = 'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1600&q=85';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, '.cache', 'room.jpg');
const API = 'http://localhost:4000';
// Served by the Vite dev server from the repo root, so the analysis worker loads it same-origin
const SHOWCASE_PHOTO = 'http://localhost:3000/tests/e2e/.cache/room.jpg';
const LABEL = 'Feature Wall';

const roomPhoto = async (): Promise<string | null> => {
  if (fs.existsSync(CACHE)) return CACHE;
  try {
    const res = await fetch(ROOM_URL);
    if (!res.ok) return null;
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    fs.writeFileSync(CACHE, Buffer.from(await res.arrayBuffer()));
    return CACHE;
  } catch {
    return null;
  }
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
};

const SESSION: AuthSession = {
  token: 'test-token',
  user: { id: 'user-1', email: 'vendor@example.com', name: 'Vendor', role: 'OWNER', tenantId: 'tenant-1' },
  tenant: { id: 'tenant-1', name: 'Test Studio', slug: 'test-studio', materialCategory: 'wood', status: 'APPROVED' },
};

// The PNG inside a multipart body (the upload is a single PNG file part)
const pngFromMultipart = (body: Buffer): Buffer => {
  const start = body.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const iend = body.indexOf(Buffer.from('IEND'), start);
  if (start < 0 || iend < 0) throw new Error('upload carried no PNG');
  return body.subarray(start, iend + 8); // "IEND" + its 4-byte CRC
};

// A minimal in-memory API: showcase images, surfaces, hotspots and uploads
const mockApi = async (page: Page) => {
  const image: RemoteShowcaseImage = {
    id: 'image-1',
    tenantId: SESSION.user.tenantId,
    name: 'Living Room',
    imageUrl: SHOWCASE_PHOTO,
    hotspots: [],
    surfaces: [],
  };
  const uploads = new Map<string, Buffer>();
  const surfaceBodies: Array<Partial<NewSurfaceInput>> = [];
  let nextId = 1;

  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  await page.route(`${API}/**`, async (route) => {
    const req = route.request();
    const method = req.method();
    const { pathname } = new URL(req.url());
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });

    if (method === 'GET' && pathname.startsWith('/uploads/')) {
      const bytes = uploads.get(req.url());
      if (!bytes) return route.fulfill({ status: 404, headers: CORS });
      return route.fulfill({ status: 200, headers: { ...CORS, 'Content-Type': 'image/png' }, body: bytes });
    }
    if (method === 'GET' && pathname === '/api/render/capabilities') return json(route, { exactPreview: true, studioLighting: false });
    if (method === 'GET' && pathname === '/api/materials') return json(route, []);
    if (method === 'GET' && pathname === '/api/showcase/images') return json(route, [image]);

    if (method === 'POST' && pathname === '/api/uploads/image') {
      const url = `${API}/uploads/mask-${nextId++}.png`;
      uploads.set(url, pngFromMultipart(req.postDataBuffer()!));
      return json(route, { url });
    }
    if (method === 'POST' && pathname === `/api/showcase/images/${image.id}/surfaces`) {
      const body = req.postDataJSON() as NewSurfaceInput;
      surfaceBodies.push(body);
      const surface = { ...body, id: `surface-${nextId++}`, imageId: image.id } as RemoteSurface;
      image.surfaces.push(surface);
      return json(route, { ...surface, showcaseImageId: image.id });
    }
    const surfaceMatch = /^\/api\/showcase\/surfaces\/([^/]+)$/.exec(pathname);
    if (surfaceMatch && method === 'PUT') {
      const body = req.postDataJSON() as Partial<NewSurfaceInput>;
      surfaceBodies.push(body);
      const k = image.surfaces.findIndex((s) => s.id === surfaceMatch[1]);
      image.surfaces[k] = { ...image.surfaces[k], ...body };
      return json(route, { ...image.surfaces[k], showcaseImageId: image.id });
    }
    if (surfaceMatch && method === 'DELETE') {
      image.surfaces = image.surfaces.filter((s) => s.id !== surfaceMatch[1] && s.parentSurfaceId !== surfaceMatch[1]);
      return route.fulfill({ status: 204, headers: CORS });
    }
    if (method === 'POST' && pathname === `/api/showcase/images/${image.id}/hotspots`) {
      const hotspot: RemoteHotspot = { ...(req.postDataJSON() as NewHotspotInput), id: `hotspot-${nextId++}`, showcaseImageId: image.id };
      image.hotspots.push(hotspot);
      return json(route, hotspot);
    }
    const hotspotMatch = /^\/api\/showcase\/hotspots\/([^/]+)$/.exec(pathname);
    if (hotspotMatch && method === 'PUT') {
      const k = image.hotspots.findIndex((h) => h.id === hotspotMatch[1]);
      image.hotspots[k] = { ...image.hotspots[k], ...(req.postDataJSON() as Partial<NewHotspotInput>) };
      return json(route, image.hotspots[k]);
    }
    return json(route, { error: `unmocked ${method} ${pathname}` }, 500);
  });
  return { uploads, surfaceBodies };
};

// Coverage (% of photo, alpha-weighted) of the union of saved white-on-black mask PNGs
const unionCoverage = (page: Page, pngs: Buffer[]) =>
  page.evaluate(async (b64s: string[]) => {
    let union: Float32Array | null = null;
    let size = 0;
    for (const b64 of b64s) {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      size = canvas.width * canvas.height;
      union ??= new Float32Array(size);
      for (let i = 0; i < size; i++) union[i] = Math.max(union[i], data[i * 4] / 255);
    }
    let sum = 0;
    for (let i = 0; i < size; i++) sum += union![i];
    return (sum / size) * 100;
  }, pngs.map((b) => b.toString('base64')));

const coverage = async (page: Page) => {
  const text = (await page.getByTestId('area-coverage').textContent()) ?? '';
  return Number(/([\d.]+)% of photo/.exec(text)?.[1]);
};

test('showcase editor: Adjust area edit survives manual corners, is saved and reloads', async ({ page }) => {
  test.setTimeout(8 * 60_000);
  test.skip(!fs.existsSync(path.join(HERE, '../../public/models')), 'local models missing — run npm run assets:fetch');
  const photo = await roomPhoto();
  test.skip(!photo, 'room photo could not be downloaded (offline?)');

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const api = await mockApi(page);
  // Signed in as a vendor: the session App.tsx restores from localStorage
  await page.addInitScript((session) => localStorage.setItem('mv_session', JSON.stringify(session)), SESSION);
  await page.goto('/studio');

  // Open the showcase editor and the vendor's room; analysis proposes surfaces
  await page.getByRole('button', { name: 'Manage Showcase & Hotspots' }).click();
  await page.getByText('0 hotspots').click();
  const wallChip = page.getByRole('button', { name: /^Wall\b/ }).first();
  await expect(wallChip).toBeVisible({ timeout: 6 * 60_000 });

  // Create a hotspot on the wall and wait for its area (SAM cut)
  await wallChip.click();
  const adjust = page.getByRole('button', { name: 'Adjust area' });
  await expect(adjust).toBeEnabled({ timeout: 3 * 60_000 });
  await page.getByPlaceholder('Hotspot name — e.g. Feature Wall').fill(LABEL);

  // Where the pin sits (the wall's anchor), as fractions of the photo
  const pinStyle = (await page.locator('div.rounded-full.animate-pulse.border-amber-400').locator('xpath=..').getAttribute('style')) ?? '';
  const anchorX = Number(/left:\s*([\d.]+)%/.exec(pinStyle)?.[1]) / 100;
  const anchorY = Number(/top:\s*([\d.]+)%/.exec(pinStyle)?.[1]) / 100;
  expect(anchorX).toBeGreaterThan(0);

  // Adjust area: remove a block of the wall around the pin with the polygon tool
  await adjust.click();
  const viewport = page.getByTestId('area-editor-viewport');
  await expect(viewport).toBeVisible({ timeout: 60_000 });
  const img = viewport.locator('img');
  const at = async (fx: number, fy: number) => {
    const b = (await img.boundingBox())!;
    const clamp = (v: number) => Math.min(0.98, Math.max(0.02, v));
    return { x: b.x + b.width * clamp(fx), y: b.y + b.height * clamp(fy) };
  };
  const before = await coverage(page);
  expect(before).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Polygon: remove' }).click();
  const d = 0.08;
  const corners = [
    await at(anchorX - d, anchorY - d),
    await at(anchorX + d, anchorY - d),
    await at(anchorX + d, anchorY + d),
    await at(anchorX - d, anchorY + d),
  ];
  for (const c of corners) await page.mouse.click(c.x, c.y);
  await page.mouse.click(corners[0].x, corners[0].y); // click the first corner to close
  const edited = await coverage(page);
  expect(edited).toBeLessThan(before - 0.5);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(viewport).toHaveCount(0);

  // Regression: switching to manual corners must keep the edit
  const manual = page.getByRole('button', { name: 'Edit corners manually' });
  await expect(manual.first()).toBeVisible();
  await manual.first().click();
  await expect(page.getByText('Manual corners — drag the blue handles').first()).toBeVisible();

  // Save
  await page.getByRole('button', { name: 'Add Hotspot' }).click();
  // (the studio behind the modal shows the same hotspot as a pin too)
  const pin = page.getByTestId('showcase-editor').locator(`button[title="${LABEL}"]`);
  await expect(pin).toBeVisible({ timeout: 60_000 });

  // The uploaded surface masks carry the edit: lower coverage than the unedited area
  const mains = api.surfaceBodies;
  expect(mains.length).toBeGreaterThan(0);
  expect(mains[0].plane?.homographyFallback).toBeTruthy();
  const maskPngs = mains.map((s) => api.uploads.get(s.maskUrl!)!);
  expect(maskPngs.every(Boolean)).toBe(true);
  const saved = await unionCoverage(page, maskPngs);
  expect(saved).toBeLessThan(before - 0.5);
  expect(saved).toBeCloseTo(edited, 0);

  // Reopen: the saved area loads back from the uploaded masks with the reduced coverage
  await pin.click();
  await expect(adjust).toBeEnabled({ timeout: 60_000 });
  await expect(page.getByText('Manual corners — drag the blue handles').first()).toBeVisible();
  await adjust.click();
  await expect(viewport).toBeVisible({ timeout: 60_000 });
  const reopened = await coverage(page);
  expect(reopened).toBeLessThan(before - 0.5);
  expect(reopened).toBeCloseTo(edited, 0);
  await page.getByRole('button', { name: 'Done' }).click();

  expect(errors).toEqual([]);
});
