# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

This is two independently-run projects in one directory, connected only over HTTP at runtime (no shared build/types):

- **Frontend** (repo root): React 19 + Vite 6 + TypeScript, flat layout (no `src/`). Originally exported from Google AI Studio.
- **`server/`**: Node + Express + TypeScript + Prisma + MySQL backend, the start of a multi-tenant SaaS foundation. The frontend calls it via `services/apiClient.ts` (base URL `VITE_API_URL`, default `http://localhost:4000`) once a user signs in — see "Auth & live catalog wiring" below and `PROJECT.md` for the roadmap.

The repo has no `.git` yet.

## Commands

### Frontend (repo root)
- `npm install` (or `bun install` — a `bun.lock` is present, but plain npm/vite works fine)
- `npm run dev` — Vite dev server
- `npm run build` — production build
- `npm run preview` — preview the production build
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — Vitest unit tests (`tests/unit/`: colour space, mapping maths, plane fitting, mask ops, quality gate)
- `npm run test:e2e` — Playwright (`tests/e2e/`): `golden.spec.ts` checks the WebGL renderer on synthetic scenes (outside-mask/occluder preservation, perspective, physical scale, colour ΔE2000, seams, determinism, safe failure); `studio-flow.spec.ts` runs upload → surface → review → material → compare → download with the real models (~2 min; downloads its room photo into the git-ignored `tests/e2e/.cache/`); `area-editor.spec.ts` covers polygon add, undo/redo and object cut-out; `showcase-adjust-area.spec.ts` runs the vendor showcase editor (detect wall → Adjust area → manual corners → save → reopen) against a `page.route`-mocked API, so it needs no MySQL/MinIO/API. The config caps Playwright at 2 workers: the model specs starve each other on CPU
- `npm run assets:fetch` — downloads the local models and CC0 texture scans into `public/models/` and `public/textures/` (both git-ignored); required before the studio can analyse photos. Missing files under `/models/` must 404 (a Vite plugin in `vite.config.ts` does this in dev/preview; production hosting needs the same rule, since an SPA fallback returning `index.html` breaks model loading)

### Backend (`server/`)
- `npm install`
- `docker compose up -d mysql` (from repo root) — starts a local MySQL 8 instance matching `server/.env.example`'s `DATABASE_URL`
- `npx prisma migrate dev` — applies/creates migrations against the running database. If the DB user can't create a shadow database (P1010), generate SQL with `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script`, save it as `prisma/migrations/<timestamp>_<name>/migration.sql`, then `npx prisma migrate deploy`
- `npm run dev` — runs the API on `PORT` (default 4000) via `tsx watch`
- `npm run build` / `npm run start` — compiled run
- `npx prisma studio` — browse the database
- `npm run storage:setup` — idempotently creates the `S3_BUCKET` bucket, a public-read policy on `tenants/*`, and CORS (skipped on MinIO, which allows all origins). Locally, first start MinIO: `MINIO_ROOT_USER=minioadmin MINIO_ROOT_PASSWORD=minioadmin minio server ~/minio-data --address :9000 --console-address :9001` (installed via `brew install homebrew/core/minio`; MinIO's own tap and binary downloads return 410). The API refuses to start without the `S3_*` env vars.
- `npm run prisma:seed` — upserts the 22 shared default materials (`server/prisma/seed.ts`, `tenantId: null`) into the database; mirrors `constants.ts` by id, so run it after a fresh migration so new tenants don't start with an empty live catalog

## Architecture

### Routing
`index.tsx` wraps the app in `react-router-dom`'s `BrowserRouter`: `/` → `components/LandingPage.tsx`, `/studio` → `App.tsx` (the studio), `/admin` → `components/AdminPage.tsx` (platform admin), `/store/:slug` → `components/StorefrontPage.tsx` (the public vendor storefront, see below). Vite's dev server default `appType: 'spa'` (not overridden in `vite.config.ts`) already serves `index.html` for both paths on a hard refresh, so no extra SPA-fallback config was needed.

### Frontend rendering pipeline
The design contract is `Material_Visualizer_Market_Ready_Rendering_Plan.md`. There is **one render path**, `services/renderer/materialRenderer.ts`'s `renderMaterial(roomUrl, layers, settings)`, used by the studio (`App.tsx`), the showcase editor and the public storefront. It takes `RenderableSurface`s (an accepted mask, an optional occluder mask, a plane) and never guesses from a text label: with no usable mask or geometry it throws `NeedsSurfaceReviewError`, which the UI turns into a review step. There is no legacy overlay/`soft-light` fallback anymore (`services/geminiService.ts` is gone).

1. **Room analysis**: `services/roomAnalysis.ts` → Web Worker `workers/analysis.worker.ts`, all models local and served from `public/models/` (`npm run assets:fetch`; no Hugging Face or CDN request at runtime). SegFormer-B2 (ADE20K) proposes walls/floors/ceilings, MoGe-2 recovers 3D geometry, and model outputs are cached in IndexedDB per image + `ANALYSIS_VERSION` (`services/analysis/analysisCache.ts`). **Cutting** a surface (on first use) runs SAM 2.1 with positive/negative prompts. SAM's low-res logits are upscaled to the photo in plain JS (`upscaleMaskLogits` in `services/analysis/maskOps.ts`), not transformers.js's `post_process_masks`: that routes its resizes through a lazily built ONNX Runtime session whose first run can take tens of seconds or never finish. Other structural surfaces' and detected objects' (curtain, painting, bed, …) *confident interiors* are hard limits, and the loose band at the edges is re-decided by colour (`refineBandByColor`: only pixels where SAM and the class map agree seed the surface colour) and then grown across edge-free colour (`growAcrossContinuousColour`). The rest of the cut: skirting removal, one plane per physical surface (`services/surfacePlaneFit.ts`), guided-filter edges, and a composite confidence scored by `services/qualityGate.ts` (`auto` / `confirm` / `correct`). Areas are adjusted in the shared `components/AreaEditor.tsx` (used by `SurfaceReviewModal` in the studio and by `ShowcaseEditorModal` behind "Adjust area"): one-click **Cut out object** / **Add object/area** (worker `cutObject` request, a single SAM object, cut-outs dilated 2 px), polygon add/remove, brush/eraser, 30-step undo/redo, zoom/pan, Fill/Outline/Original views and a material Preview. Every tool edits the mask directly (`services/areaMaskOps.ts`, unit-tested); nothing re-cuts the whole surface.
2. **Rendering** (WebGL2, `services/renderer/`): each masked pixel's camera ray is intersected with the surface plane (or the vendor's four-corner homography) to get real millimetres (`surfaceMapping.ts`, the same maths as the shader `material.frag.glsl`). The material's albedo is laid out at its physical size and repeat mode (seamless/sheet/tile/plank/bookmatch, joints in mm), shaded in linear light with the photo's recovered illumination (`lightingRecovery.ts`), and highlights roll off instead of clipping. Occluders are restored exactly and every pixel outside the masks is byte-identical to the original. Output is a lossless PNG object URL.
3. **Studio Lighting** (`settings.mode === 'studio'`, off unless `VISION_SERVICE_URL` is configured on the API): optional low-frequency harmonisation through the private `vision-service/` (MatSwap stub). **Gemini** survives only as a staff-only comparison (`services/geminiCompare.ts`, shown to OWNER/ADMIN when a key is set) and is never on the product path.

Staff (OWNER/ADMIN) get diagnostics in `ResultDisplay`: mask & occluders, layout grid, recovered lighting.

### Data layer
`constants.ts` is the offline/guest data layer — `MATERIALS` (22 seed materials spanning all categories, each with a physical profile — `realWidthMm`/`realHeightMm`, `repeatMode`, joints, roughness — and CC0 texture scans under `/textures/` from `npm run assets:fetch`) and `CURATED_ROOMS` (demo room photos with preset detected elements). `Material` (`types.ts`) carries a `tenantId: string | null` field: `null` marks these as the shared/platform default catalog, matching the tenant-scoping convention used by the backend's `Material` model. `server/prisma/seed.ts` upserts the same 22 records (same ids) into the database as the live shared-default catalog — see Commands below.

`MaterialCategory` spans both the original luxury-finish categories (`stone`/`wood`/`plaster`/`metal`/`fabric`) and the newer generic ones (`tile`/`sheet`/`carpet`/`wallpaper`/`paint`) added to support arbitrary client catalogs.

### Auth & live catalog wiring
`App.tsx` holds an `AuthSession | null` (`services/apiClient.ts`'s `AuthSession`), persisted to `localStorage` under `mv_session` so a sign-in survives reloads. `components/AuthPanel.tsx` renders sign-in/register forms (calling `apiClient.login`/`apiClient.register`) when signed out, or the tenant name + sign-out button when signed in.

When `session` is set, an effect in `App.tsx` calls `apiClient.listMaterials()` and stores the result in `remoteMaterials`; `MaterialGrid` renders `materialsList` (`App.tsx`: `session ? remoteMaterials ?? [] : MATERIALS`) — so signed-out users always get the offline `constants.ts` catalog, and signed-in users get only their own tenant's materials (`GET /api/materials` excludes the shared `tenantId: null` defaults, so a brand-new vendor starts with an empty catalog and no showcase images). Catalog management for a signed-in tenant, all scoped to `material.tenantId === session.user.tenantId` (never the shared defaults):
- **Add**: `components/AddMaterialForm.tsx` → `apiClient.createMaterial()`. The image comes from `components/MaterialImageInput.tsx` (shared with the edit modal): either an uploaded file — downscaled client-side to ≤1024px JPEG, posted to `POST /api/uploads/image`, and stored in S3-compatible object storage (see "Object storage" below) — or a pasted `http(s)` URL. Either way `Material.thumbnail` holds only a URL.
- **Edit**: `MaterialGrid`'s pencil icon → `EditMaterialModal.tsx` (pre-filled) → `apiClient.updateMaterial()`.
- **Bulk import**: `BulkImportModal.tsx` parses a pasted JSON array client-side, then posts each entry via `apiClient.createMaterial()` in sequence, reporting per-item success/failure (a partial failure doesn't roll back the successes).
- **Delete**: `MaterialGrid`'s trash icon → `apiClient.deleteMaterial()`.

All four update `remoteMaterials` locally on success rather than refetching the whole list.

The left-column presets (`CuratedRoomsGallery`) follow the same split: signed out it shows `CURATED_ROOMS`; signed in it shows only the tenant's own showcase images (`galleryRooms` in `App.tsx`, mapped via `toCuratedRoom()` — hotspot labels become the target elements, or the template room's defaults if the image was added from one), and the vendor's first room is put on the canvas after sign-in.

This wiring is intentionally additive — nothing in the app requires signing in; auth only swaps where the material catalog comes from.

### Vendor storefront & hotspots
A signed-in tenant can build a public showroom: `components/ShowcaseEditorModal.tsx` (opened from the "Manage Showcase & Hotspots" button in `App.tsx`'s right column, next to `AuthPanel`) lets them add a room image by URL and click on it to drop "hotspots" — a zone label plus which `MaterialCategory` values apply there. The click-to-percentage math lives in the shared `components/HotspotImage.tsx` (used by both the editor and the public page): it reads `getBoundingClientRect()` off the `<img>` itself and divides the click offset by the box's own width/height, so `xPct`/`yPct` reproduce the same point at any render size — **both consumers must render the image at `w-full h-auto`, never `object-cover`-cropped**, or the percentages stop lining up.

That showroom is published with no login required at `/store/:slug` (`components/StorefrontPage.tsx`), which fetches from the *public* API (`apiClient.getPublicTenant`/`listPublicMaterials`/`listPublicShowcase`, no token) — a deliberately different data set from the authed `GET /api/materials`: the public materials endpoint returns **only that tenant's own materials, never the shared `tenantId: null` defaults**, so each vendor's storefront shows just their own catalog. Clicking a hotspot pin opens `components/HotspotMaterialPicker.tsx`, filtered to `materials.filter(m => hotspot.allowedCategories.includes(m.category))`; picking one renders it on the hotspot's saved surface through `renderMaterial()` (the storefront never touches Gemini or the models). Each hotspot points at an analysed `Surface` (`surfaceId`; mask/occluder PNGs in object storage, `plane` and `calibration` JSON, confidence, `parentSurfaceId` for extra planes of one wall across a corner). Surfaces are created and reviewed in `ShowcaseEditorModal` with the same worker pipeline as the studio. The models only ever run in the vendor's editor or the studio; storefront customers just download the saved masks and planes and render through `renderMaterial()`, with no label-based fallback. A hotspot without a surface can't render until the vendor reviews it. In the studio, a signed-in vendor's room shows its hotspots as clickable pins (ResultDisplay's "Hotspots" view); each hotspot keeps its own finish and `App.tsx` re-renders all of them as layers. Render state on the storefront (`activeHotspot`/`renderedUrl`) is session-only and resets on reload — nothing about a customer's chosen look is persisted.

### Backend (`server/`)
Multi-tenant from the ground up: `Tenant` → `User` (role `OWNER`/`ADMIN`/`MEMBER`) → `Material` (nullable `tenantId`, `null` = shared default) / `ShowcaseImage` (required `tenantId`) → `Hotspot` (no `tenantId` of its own — ownership is checked transitively via its parent `ShowcaseImage`, to avoid a driftable duplicate column). Registration creates a brand-new tenant plus its first `OWNER` user in one call (`POST /api/auth/register`) — there's no "join an existing tenant" flow yet; both `register` and `login` return `{token, user, tenant}`. JWT (`{userId, tenantId, role}`) is required on every `/api/materials` and `/api/showcase` route via `requireAuth` middleware; the tenant-scoping enforcement point is the `loadOwned*()` helper pattern (`materials.controller.ts`'s `loadOwnedMaterial`, `showcase.controller.ts`'s `loadOwnedShowcaseImage`/`loadOwnedHotspot`) that every write route (`PUT`/`DELETE`) funnels through — it 403s on tenant mismatch, including attempts to edit the shared material catalog (`tenantId: null`). `POST` always sets `tenantId` server-side from the JWT, never from the request body. `/api/public/*` (`public.controller.ts`/`public.routes.ts`) is the one route group mounted **without** `requireAuth` — it resolves a tenant by `slug` first, 404s if unknown, and is what the public storefront reads from.

**Object storage**: `server/src/lib/storage.ts` wraps `@aws-sdk/client-s3` and is configured purely by `S3_*` env vars (`server/.env.example`) — MinIO locally, AWS S3 (or R2/Spaces) in production, same code. `POST /api/uploads/image` (`uploads.routes.ts`, `requireAuth`, multer in-memory, ≤5MB, PNG/JPEG/WebP only) writes to `tenants/<tenantId>/<materials|showcase>/<uuid>.<ext>` and returns the public URL. `deleteTenantImage()` removes the old object when a material's thumbnail is replaced or the material is deleted — but only for URLs under that tenant's own prefix, so pasted external links and other tenants' files are never touched. Images must be served with CORS headers because the canvas compositor loads them with `crossOrigin="anonymous"`.

Uses `.js` extensions on relative imports throughout `server/src` — required because `tsconfig.json` targets `NodeNext` module resolution for native ESM output.
