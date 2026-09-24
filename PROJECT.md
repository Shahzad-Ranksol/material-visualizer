# Project

## Vision

Material Visualizer is becoming a generic, multi-tenant SaaS studio for visualizing materials — tile, sheet flooring, carpet, wallpaper, paint, and the original luxury-finish categories (stone, wood, plaster, metal, fabric) — on room and house photos. Any client (a tile vendor, a carpet retailer, an interior studio) should eventually be able to bring their own material catalog into the same visualization engine, including publishing a public, no-login showroom of their own catalog for their end customers.

## Principle: API-free by default

Room analysis and rendering run entirely in the browser with **zero external API cost and no API keys**: local models (SegFormer, SAM 2.1, MoGe-2) served from the app's own origin, and one deterministic WebGL2 renderer (`renderMaterial()`) shared by the studio, showcase editor and storefront. It lays each material out at its real physical size and in perspective, lit by the photo's own light, and leaves every pixel outside the accepted surface untouched. A surface it can't render faithfully goes to a review step, never to a guessed fallback. The plan behind this is `Material_Visualizer_Market_Ready_Rendering_Plan.md`. Optional "Studio Lighting" through a self-hosted worker (`vision-service/`) is off by default; Gemini remains only as a temporary staff-only comparison.

## Current state

- Rendering (plan phases 0–2 done, 3 scaffolded): surface analysis with confidence and review (`auto`/`confirm`/`correct`), per-surface planes, WebGL2 linear-light renderer, physical material profiles, analysis cache. Covered by Vitest unit tests and Playwright golden-image + end-to-end suites (see `CLAUDE.md` Commands). Studio Lighting's MatSwap call is a stub until a GPU host exists.
- Frontend: material schema generalized (new categories, `tenantId` field, physical profile). The real generic catalog (tile/sheet/carpet/wallpaper/paint) is populated with verified thumbnails and has working category filters in the UI.
- Backend (`server/`): standalone Node/Express/Prisma/MySQL API with tenant registration, JWT auth, and tenant-scoped material CRUD.
- Frontend↔backend wiring: `App.tsx` holds an auth session (persisted to `localStorage`), `components/AuthPanel.tsx` handles sign in/register/sign out, and `components/MaterialGrid.tsx` renders live data from `GET /api/materials` (merged tenant + shared-default materials) once signed in. Signed-out users still get the full offline experience from `constants.ts` — auth is additive, not a gate.
- Database seeding: `server/prisma/seed.ts` (run via `npm run prisma:seed`, or automatically through `npx prisma migrate reset`/`db seed` since it's wired into `package.json`'s `prisma.seed`) upserts the same 22 materials as `constants.ts` (same IDs, `tenantId: null`) into the database, so a brand-new tenant's live catalog is never empty — it matches the offline default catalog from day one.
- Catalog admin UI: a signed-in tenant can add (`components/AddMaterialForm.tsx`), edit in place (`components/EditMaterialModal.tsx`), bulk-import via pasted JSON with per-item success/failure reporting (`components/BulkImportModal.tsx`), and delete their own materials — never the shared defaults. All four flows verified end-to-end (create → edit → reload-persists → bulk import with one deliberately-invalid entry → delete).
- Vendor storefront + hotspots: a signed-in tenant builds a showroom (`components/ShowcaseEditorModal.tsx`) — add a room image by URL, click on it to drop labeled "hotspots" (a zone name + which material categories apply there, e.g. a floor hotspot allowing carpet/tile/wood). That showroom is published, with no login required, at `/store/<tenant-slug>` (`components/StorefrontPage.tsx`, added via `react-router-dom`): visitors click a hotspot, see only the materials relevant to that zone (`components/HotspotMaterialPicker.tsx`), pick one, and see it rendered on the photo by the same renderer as the main studio, using the vendor's saved, reviewed surface. The public API (`GET /api/public/tenants/:slug/...`) deliberately returns only that tenant's own materials — never the shared platform defaults — so each vendor's storefront shows just their own catalog. Verified end-to-end including the empty-state ("no materials for this zone yet") and the actual render swap after picking a material.
- No billing, no multi-user tenant invites yet.

## Roadmap

- Billing/subscription (Stripe or equivalent) per tenant.
- Multi-user tenant invites (currently registration always creates a brand-new tenant; there's no "join an existing tenant" flow).
- Storefront/hotspot follow-ups: editing an existing hotspot's position (currently only label/categories are editable in place — repositioning means deleting and re-adding).
- Rendering (plan phase 4): the 60-photo validation set and quality dashboard, cancellation, GPU-worker queue, privacy/retention controls for customer photos. Known weak spot: where the class map mislabels part of an object as wall (e.g. the lower half of a curtain), the vendor or user removes it with one click of the Area Editor's Cut out object tool.
