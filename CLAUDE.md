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
- `npx tsc --noEmit` — the closest thing to a typecheck; there is no dedicated `lint`, `test`, or `typecheck` script, and no test framework is installed

### Backend (`server/`)
- `npm install`
- `docker compose up -d mysql` (from repo root) — starts a local MySQL 8 instance matching `server/.env.example`'s `DATABASE_URL`
- `npx prisma migrate dev` — applies/creates migrations against the running database
- `npm run dev` — runs the API on `PORT` (default 4000) via `tsx watch`
- `npm run build` / `npm run start` — compiled run
- `npx prisma studio` — browse the database
- `npm run prisma:seed` — upserts the 22 shared default materials (`server/prisma/seed.ts`, `tenantId: null`) into the database; mirrors `constants.ts` by id, so run it after a fresh migration so new tenants don't start with an empty live catalog

## Architecture

### Routing
`index.tsx` wraps the app in `react-router-dom`'s `BrowserRouter` with two routes: `/` → `App.tsx` (the full authed studio), `/store/:slug` → `components/StorefrontPage.tsx` (the public vendor storefront, see below). Vite's dev server default `appType: 'spa'` (not overridden in `vite.config.ts`) already serves `index.html` for both paths on a hard refresh, so no extra SPA-fallback config was needed.

### Frontend rendering pipeline
`App.tsx` is the single orchestrator component for the `/` route — all state (selected room, uploaded image, detected items, selected material, render results) lives here and flows down into `components/`. There is no global state library.

Two-stage render flow, both implemented in `services/geminiService.ts`:
1. **`detectObjectsInImage()`** — identifies architectural elements (walls, flooring, cabinetry, etc.) worth re-texturing.
2. **`applyTextureToObjects()`** — renders the selected material onto the selected elements.

Both take a `useAI: boolean` flag. **This is the key architectural decision**: the built-in Canvas2D compositor (`synthesizeStudioRender()`) is the default, zero-cost render path — it tiles the material's thumbnail image onto the photo with blend modes (`soft-light`/`color`/`overlay`), applies the material's `renderOverlayTone` color wash, and exports via `canvas.toDataURL()`, entirely client-side. Gemini (`@google/genai`) is only ever called when `useAI` is `true` *and* a `GEMINI_API_KEY`/`API_KEY` env var is present — it's opt-in via the "AI Enhance" toggle in `StudioHeader`, defaulting to off. When `useAI` is `false`, neither function references the Gemini client at all. When `useAI` is `true`, both functions still fall back to the canvas/simulated path on any API error.

### Data layer
`constants.ts` is the offline/guest data layer — `MATERIALS` (22 seed materials spanning all categories, real verified Unsplash thumbnails) and `CURATED_ROOMS` (demo room photos with preset detected elements). `Material` (`types.ts`) carries a `tenantId: string | null` field: `null` marks these as the shared/platform default catalog, matching the tenant-scoping convention used by the backend's `Material` model. `server/prisma/seed.ts` upserts the same 22 records (same ids) into the database as the live shared-default catalog — see Commands below.

`MaterialCategory` spans both the original luxury-finish categories (`stone`/`wood`/`plaster`/`metal`/`fabric`) and the newer generic ones (`tile`/`sheet`/`carpet`/`wallpaper`/`paint`) added to support arbitrary client catalogs.

### Auth & live catalog wiring
`App.tsx` holds an `AuthSession | null` (`services/apiClient.ts`'s `AuthSession`), persisted to `localStorage` under `mv_session` so a sign-in survives reloads. `components/AuthPanel.tsx` renders sign-in/register forms (calling `apiClient.login`/`apiClient.register`) when signed out, or the tenant name + sign-out button when signed in.

When `session` is set, an effect in `App.tsx` calls `apiClient.listMaterials()` and stores the result in `remoteMaterials`; `MaterialGrid` renders `remoteMaterials ?? MATERIALS` (`materialsList` in `App.tsx`) — so signed-out users always get the offline `constants.ts` catalog, and signed-in users get their live tenant catalog (shared defaults + their own materials, merged server-side per `GET /api/materials`'s query). Catalog management for a signed-in tenant, all scoped to `material.tenantId === session.user.tenantId` (never the shared defaults):
- **Add**: `components/AddMaterialForm.tsx` → `apiClient.createMaterial()`.
- **Edit**: `MaterialGrid`'s pencil icon → `EditMaterialModal.tsx` (pre-filled) → `apiClient.updateMaterial()`.
- **Bulk import**: `BulkImportModal.tsx` parses a pasted JSON array client-side, then posts each entry via `apiClient.createMaterial()` in sequence, reporting per-item success/failure (a partial failure doesn't roll back the successes).
- **Delete**: `MaterialGrid`'s trash icon → `apiClient.deleteMaterial()`.

All four update `remoteMaterials` locally on success rather than refetching the whole list.

This wiring is intentionally additive — nothing in the app requires signing in; auth only swaps where the material catalog comes from.

### Vendor storefront & hotspots
A signed-in tenant can build a public showroom: `components/ShowcaseEditorModal.tsx` (opened from the "Manage Showcase & Hotspots" button in `App.tsx`'s right column, next to `AuthPanel`) lets them add a room image by URL and click on it to drop "hotspots" — a zone label plus which `MaterialCategory` values apply there. The click-to-percentage math lives in the shared `components/HotspotImage.tsx` (used by both the editor and the public page): it reads `getBoundingClientRect()` off the `<img>` itself and divides the click offset by the box's own width/height, so `xPct`/`yPct` reproduce the same point at any render size — **both consumers must render the image at `w-full h-auto`, never `object-cover`-cropped**, or the percentages stop lining up.

That showroom is published with no login required at `/store/:slug` (`components/StorefrontPage.tsx`), which fetches from the *public* API (`apiClient.getPublicTenant`/`listPublicMaterials`/`listPublicShowcase`, no token) — a deliberately different data set from the authed `GET /api/materials`: the public materials endpoint returns **only that tenant's own materials, never the shared `tenantId: null` defaults**, so each vendor's storefront shows just their own catalog. Clicking a hotspot pin opens `components/HotspotMaterialPicker.tsx`, filtered to `materials.filter(m => hotspot.allowedCategories.includes(m.category))`; picking one calls the same `applyTextureToObjects(image, mimeType, [hotspot.label], material, false)` the main studio checklist uses (`useAI` hard-`false` here — the storefront never touches Gemini). **Known limitation**: a hotspot's `label` is the sole entry in that array, so it's matched by the same coarse floor/wall/island/cabinet/table/desk substring heuristic in `synthesizeStudioRender()` that the checklist relies on — there's no real per-region masking. The editor's hotspot-label field has helper text nudging vendors to include one of those keywords; this doesn't fix the heuristic, it just improves the odds. Render state on the storefront (`activeHotspot`/`renderedUrl`) is session-only and resets on reload — nothing about a customer's chosen look is persisted.

### Backend (`server/`)
Multi-tenant from the ground up: `Tenant` → `User` (role `OWNER`/`ADMIN`/`MEMBER`) → `Material` (nullable `tenantId`, `null` = shared default) / `ShowcaseImage` (required `tenantId`) → `Hotspot` (no `tenantId` of its own — ownership is checked transitively via its parent `ShowcaseImage`, to avoid a driftable duplicate column). Registration creates a brand-new tenant plus its first `OWNER` user in one call (`POST /api/auth/register`) — there's no "join an existing tenant" flow yet; both `register` and `login` return `{token, user, tenant}`. JWT (`{userId, tenantId, role}`) is required on every `/api/materials` and `/api/showcase` route via `requireAuth` middleware; the tenant-scoping enforcement point is the `loadOwned*()` helper pattern (`materials.controller.ts`'s `loadOwnedMaterial`, `showcase.controller.ts`'s `loadOwnedShowcaseImage`/`loadOwnedHotspot`) that every write route (`PUT`/`DELETE`) funnels through — it 403s on tenant mismatch, including attempts to edit the shared material catalog (`tenantId: null`). `POST` always sets `tenantId` server-side from the JWT, never from the request body. `/api/public/*` (`public.controller.ts`/`public.routes.ts`) is the one route group mounted **without** `requireAuth` — it resolves a tenant by `slug` first, 404s if unknown, and is what the public storefront reads from.

Uses `.js` extensions on relative imports throughout `server/src` — required because `tsconfig.json` targets `NodeNext` module resolution for native ESM output.
