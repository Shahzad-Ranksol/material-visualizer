# Project

## Vision

Material Visualizer is becoming a generic, multi-tenant SaaS studio for visualizing materials — tile, sheet flooring, carpet, wallpaper, paint, and the original luxury-finish categories (stone, wood, plaster, metal, fabric) — on room and house photos. Any client (a tile vendor, a carpet retailer, an interior studio) should eventually be able to bring their own material catalog into the same visualization engine, including publishing a public, no-login showroom of their own catalog for their end customers.

## Principle: API-free by default

The studio's core rendering — object detection and material application — runs entirely client-side via a built-in Canvas2D compositor (`services/geminiService.ts`'s `synthesizeStudioRender()` and `getSimulatedRoomElements()`), with **zero external API cost**. This is the default experience for every user. Calling Gemini for higher-fidelity AI-driven detection/rendering is an explicit opt-in (the "AI Enhance" toggle), never a requirement.

## Current state

- Frontend: material schema generalized (new categories, `tenantId` field), AI rendering demoted to an opt-in toggle defaulting off. The real generic catalog (tile/sheet/carpet/wallpaper/paint) is populated with verified thumbnails and has working category filters in the UI.
- Backend (`server/`): standalone Node/Express/Prisma/MySQL API with tenant registration, JWT auth, and tenant-scoped material CRUD.
- Frontend↔backend wiring: `App.tsx` holds an auth session (persisted to `localStorage`), `components/AuthPanel.tsx` handles sign in/register/sign out, and `components/MaterialGrid.tsx` renders live data from `GET /api/materials` (merged tenant + shared-default materials) once signed in. Signed-out users still get the full offline experience from `constants.ts` — auth is additive, not a gate.
- Database seeding: `server/prisma/seed.ts` (run via `npm run prisma:seed`, or automatically through `npx prisma migrate reset`/`db seed` since it's wired into `package.json`'s `prisma.seed`) upserts the same 22 materials as `constants.ts` (same IDs, `tenantId: null`) into the database, so a brand-new tenant's live catalog is never empty — it matches the offline default catalog from day one.
- Catalog admin UI: a signed-in tenant can add (`components/AddMaterialForm.tsx`), edit in place (`components/EditMaterialModal.tsx`), bulk-import via pasted JSON with per-item success/failure reporting (`components/BulkImportModal.tsx`), and delete their own materials — never the shared defaults. All four flows verified end-to-end (create → edit → reload-persists → bulk import with one deliberately-invalid entry → delete).
- Vendor storefront + hotspots: a signed-in tenant builds a showroom (`components/ShowcaseEditorModal.tsx`) — add a room image by URL, click on it to drop labeled "hotspots" (a zone name + which material categories apply there, e.g. a floor hotspot allowing carpet/tile/wood). That showroom is published, with no login required, at `/store/<tenant-slug>` (`components/StorefrontPage.tsx`, added via `react-router-dom`): visitors click a hotspot, see only the materials relevant to that zone (`components/HotspotMaterialPicker.tsx`), pick one, and see it rendered on the photo using the same canvas compositor as the main studio. The public API (`GET /api/public/tenants/:slug/...`) deliberately returns only that tenant's own materials — never the shared platform defaults — so each vendor's storefront shows just their own catalog. Verified end-to-end including the empty-state ("no materials for this zone yet") and the actual render swap after picking a material.
- No billing, no multi-user tenant invites yet.

## Roadmap

- Billing/subscription (Stripe or equivalent) per tenant.
- Multi-user tenant invites (currently registration always creates a brand-new tenant; there's no "join an existing tenant" flow).
- Storefront/hotspot follow-ups: editing an existing hotspot's position (currently only label/categories are editable in place — repositioning means deleting and re-adding), and richer per-zone rendering (today a hotspot's label is matched against the same floor/wall keyword heuristic the main studio checklist uses — see `CLAUDE.md` for the known limitation).
