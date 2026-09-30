# Project

## Vision

Material Visualizer is becoming a generic, multi-tenant SaaS studio for visualizing materials — tile, sheet flooring, carpet, wallpaper, paint, and the original luxury-finish categories (stone, wood, plaster, metal, fabric) — on room and house photos. Any client (a tile vendor, a carpet retailer, an interior studio) should eventually be able to bring their own material catalog into the same visualization engine, including publishing a public, no-login showroom of their own catalog for their end customers.

## Principle: API-free by default

Room analysis and rendering run entirely in the browser with **zero external API cost and no API keys**: local models (SegFormer, SAM 2.1, MoGe-2) served from the app's own origin, and one deterministic WebGL2 renderer (`renderMaterial()`) shared by the studio, showcase editor and storefront. It lays each material out at its real physical size and in perspective, lit by the photo's own light, and leaves every pixel outside the accepted surface untouched. A surface it can't render faithfully goes to a review step, never to a guessed fallback. The plan behind this is `Material_Visualizer_Market_Ready_Rendering_Plan.md`. Optional "Studio Lighting" through a self-hosted worker (`vision-service/`) is off by default; Gemini remains only as a temporary staff-only comparison.

## Current state

- **Rendering (plan phases 0–2 done, 3 scaffolded, 4 in progress):**
  - Surface analysis is local (SegFormer, SAM 2.1, MoGe-2). It produces a composite confidence, plain-language review reasons, and a review step (`auto`/`confirm`/`correct`).
  - Each surface gets its own planes, rendered by a WebGL2 linear-light renderer with physical material profiles, backed by an analysis cache.
  - Segmentation faults are measured stage by stage. The opt-in evidence run covers the curated rooms with regression limits, and staff get a Pipeline stages view.
  - The Area Editor offers Protect object (restored on top) and Include area (re-cut, only the clicked region), with Apply/Discard, undo and a material preview. Preview, studio accept and showcase save share one rule, so the preview is what customers see.
  - Every analysis job can be cancelled and has a hard time limit.
  - Validation tooling: a manifest of free-licence photos, a dev-only approve tool for the correct areas, a scoring run (coverage, leak, IoU, boundary accuracy, failing stage, false autos, threshold calibration) and a dev-only results dashboard with history.
  - Tests: Vitest unit tests, plus Playwright golden-image, studio, Area Editor, showcase, storefront-consistency and cancellation suites (see `CLAUDE.md` Commands).
  - Studio Lighting's MatSwap call is a stub until a GPU host exists.
- **Catalog:** the material schema is generalized (tile/sheet/carpet/wallpaper/paint plus the luxury finishes, `tenantId`, a physical profile). Signed-out users get the offline catalog in `constants.ts`. A signed-in tenant sees **only its own materials**: `GET /api/materials` and the public endpoint both exclude the shared `tenantId: null` defaults, which `server/prisma/seed.ts` mirrors from `constants.ts`.
- **Backend (`server/`):** Node/Express/Prisma/MySQL, with tenant registration, JWT auth and tenant-scoped CRUD. S3-compatible object storage holds uploaded images and saved surface masks.
- **Platform:** a landing page (`/`), platform-admin approval of new vendors (`/admin`), and category-scoped vendors.
- **Catalog admin:** add, edit, bulk-import (JSON) and delete a tenant's own materials.
- **Vendor showroom:**
  - Built in `ShowcaseEditorModal`: add a room photo, place hotspots (including moving one by clicking the photo while editing it, which re-detects the surface there), detect and adjust each surface, and save.
  - Published with no login at `/store/<slug>`, where customers render a vendor's material on the saved, reviewed surface through the same renderer.
  - Replacing a showroom photo flags its surfaces, and the storefront won't render them until the vendor detects them again.
- **Not yet:** billing, multi-user tenant invites.

## Roadmap

1. **Fill the validation set** to about 60 approved surfaces (`npm run validation:find` + `/dev/validation`), then calibrate `CONFIDENCE_THRESHOLDS` from its calibration table. Also privacy/retention controls for customer photos.
2. **Multi-user tenant invites:** registration always creates a new tenant today, and there's no "join an existing tenant" flow.
3. **Billing:** Stripe or equivalent, per tenant.
4. **Rendering phase 3, once a GPU host exists:** benchmark SAM 3.1 and MoGe-3 against the lighter pipeline, MatSwap Studio Lighting, and a GPU-worker queue.
5. **Demo data:** the "Monolithic Island Kitchen" preset shows an outside view of a house; it needs a real, licensed kitchen photo.
