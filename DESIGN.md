# Design

## Visual system

Tailwind is loaded via CDN script (`index.html`), configured inline — there is no `tailwind.config.js` file. Custom tokens (`index.html`):

- **Fonts**: `font-sans` (Plus Jakarta Sans, body default), `font-serif` (Playfair Display, headings like the "Material Visualizer" wordmark), `font-display` (Cinzel). See `FONTS.md`.
- **Colors**: `atelier-{950,900,850,800,700}` (near-black backgrounds, `#0b0c10` → `#282c3f`), `champagne-{300,400,500,600}` (warm accent tones, `#f5e6cc` → `#c8a97e`). Most components also use raw Tailwind utilities with arbitrary values (e.g. `bg-[#12141c]`, `border-white/[0.08]`) rather than the named tokens — the named tokens exist but aren't consistently used yet.
- Amber (`amber-400/500/600`) is the primary accent for CTAs and active states throughout (e.g. the "Materialize Finish" button, the AI-detected engine-status dot).
- Dark theme only — background is hardcoded to `#0b0c10` in both `index.html` and `App.tsx`'s root div, no light mode.

## Component inventory (`components/`)

- **`StudioHeader`** — top nav: brand mark, room-type selector, engine-status pill (Gemini vs. canvas), the "AI Enhance" opt-in toggle, spec-sheet/reset actions.
- **`CuratedRoomsGallery`** — picks one of the preset demo rooms (`CURATED_ROOMS` in `constants.ts`).
- **`FileUpload`** — custom room photo upload, replaces the curated room selection.
- **`DetectedItems`** — lists detected/preset architectural elements, lets the user select which ones to re-texture or add a custom one.
- **`MaterialGrid`** — the material picker ("Finishes Atelier"), renders `MATERIALS` as selectable swatches.
- **`ResultDisplay`** — the visualizer canvas itself: before/after comparison (`ViewMode`: `'slider' | 'side-by-side' | 'rendered' | 'original'`).
- **`SpecSheetModal`** — exportable summary of the current room/material/selected-items configuration.
- **`ToggleSwitch`** — generic on/off switch (`isOn`/`onToggle` props); used for the AI Enhance control.
- **`Dropdown`**, **`Spinner`** — shared primitives.

## Material data model

`Material` (`types.ts`):

```ts
interface Material {
  id: string;
  tenantId: string | null;   // null = shared platform default catalog
  name: string;
  category: MaterialCategory;
  description: string;
  thumbnail: string;
  finishType: string;
  colorTone: string;
  renderOverlayTone?: string;   // CSS rgba(), tints the canvas render for this material
  tileScale?: number;           // optional per-material override for canvas pattern repeat scale
  blendMode?: 'soft-light' | 'color' | 'overlay'; // optional per-material canvas blend-mode override
}
```

`MaterialCategory` = `'all' | 'tile' | 'sheet' | 'carpet' | 'wallpaper' | 'paint' | 'stone' | 'wood' | 'plaster' | 'metal' | 'fabric'`.

The first five (`tile`/`sheet`/`carpet`/`wallpaper`/`paint`) are the generic categories added to support arbitrary vendor catalogs (tile shops, carpet retailers, etc.); the latter five are the original Google-AI-Studio-export categories, still populated by the 14 seed materials in `constants.ts`. `tileScale`/`blendMode` are optional escape hatches so a specific material can override the default canvas compositing behavior in `synthesizeStudioRender()` (`services/geminiService.ts`) without changing that function's logic.
