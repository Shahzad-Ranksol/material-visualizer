# Area Editor — design

Date: 2026-09-24
Status: approved (design), awaiting spec review

## Problem

Vendors define the area a hotspot re-surfaces (its mask) in `ShowcaseEditorModal`. The current
tools — Include/Exclude clicks, a freehand brush/eraser and a size slider — make that hard:

- **Include/Exclude re-cut the whole surface.** Each click re-runs SAM for the entire wall with the
  extra prompt, so fixing one spot can change others, and small leaks (headboard, lamp,
  chandelier) often survive.
- **The brush is imprecise.** The image is small, there is no zoom, and mistakes can't be undone.
- **Leaks are hard to see.** The amber fill hides small stray regions until after the render.

The studio's `SurfaceReviewModal` has the same tools and the same problems.

## Goal

Every correction is one click or a few corner clicks, with an exactly predictable result, and any
step can be undone. For the reference bedroom photo, cutting out the two lamps, the chandelier and
the headboard takes about five clicks and produces a clean render.

## Approach

Keep the AI cut as the starting area, and make every tool an **edit of that one mask**. No tool
re-computes the whole surface.

## Components

### `components/AreaEditor.tsx` (new, shared)

The whole editing surface: toolbar, zoomable canvas, view modes, undo/redo, preview button.
Used by `ShowcaseEditorModal` (replacing its current tool row and brush controls) and by
`SurfaceReviewModal` (replacing its tool row). It opens in a large layout that fills most of the
viewport.

Props:

- `imageUrl: string`
- `initialMask: HTMLCanvasElement`: the AI cut, the same format the editors hold today (white,
  alpha = coverage)
- `onChange(mask: HTMLCanvasElement)`: called after every committed edit
- `onPreview?(mask: HTMLCanvasElement)`: renders the material on the current mask
- `label: string`: surface name for the size read-out

The component owns the working mask, the undo history, the zoom/pan state and the active tool.

### Tools (exactly one active)

| Tool | Input | Effect on the mask |
|---|---|---|
| Cut out object | one click | AI object mask at the click, dilated by 2 px, is subtracted |
| Add object/area | one click | AI object mask at the click is added |
| Polygon: add | corner clicks; close by double-click or clicking the first corner | polygon filled into the mask |
| Polygon: remove | same | polygon cleared from the mask |
| Brush / Eraser | drag | as today (`SurfaceMaskOverlay` stroke logic), size slider kept |

- Polygon input: Backspace removes the last corner, Esc cancels. A polygon needs at least 3 corners.
- Before Cut out or Add is applied, the AI object shape is shown briefly (red for cut, green for
  add, about 400 ms). Then it is committed as one undoable step.
- If the AI returns nothing usable at the click (empty mask, or a mask covering more than 60% of
  the photo, which would mean it grabbed the room rather than an object), nothing changes and a
  short inline message says "Couldn't find a distinct object there — try the polygon tool".

### Undo / redo

- A history of mask snapshots (`ImageData`), capped at 30. Every committed tool action pushes one.
- A brush stroke counts as one action, from pointer down to pointer up.
- Keys: Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z redo, plus toolbar buttons.

### View

- Zoom: wheel/pinch around the cursor, and +/−/Fit buttons, range 1×–8×. Pan by holding Space
  and dragging, or by dragging with the middle mouse button. Panning works with any tool active.
- View modes:
  - **Fill**: amber at an adjustable opacity (default 45%).
  - **Outline**: a 2 px bright contour of the mask only.
  - **Original**: the photo alone.
- Read-out: "`<label>`: N% of photo".
- Click-to-percentage maths must keep working under zoom. Points are mapped through the current
  transform to image pixels, then to percentages. The `HotspotImage` rule (image rendered
  `w-full h-auto`, never cropped) still holds at zoom 1.

### Worker: `cutObject` request (new)

`workers/analysis.worker.ts` gets a request `{ type: 'cutObject', imageUrl, point }`. It reuses
the room's cached SAM image encoding (`room.prompts`) and prompts with a single positive point and
no box. From SAM's candidates it picks the highest-scoring mask whose area is ≤ 60% of the photo
(the plain point prompt's smaller candidates are object-level). It returns a guided-filter-refined
`Uint8Array` mask at image resolution. `services/roomAnalysis.ts` exposes
`cutObject(imageUrl, point): Promise<HTMLCanvasElement | null>`.

### Pure mask operations: `services/areaMaskOps.ts` (new)

Unit-testable functions, with no React:

- `fillPolygon(mask, points, mode: 'add' | 'remove')`
- `combine(mask, objectMask, mode: 'add' | 'subtract', dilatePx)`
- `coveragePct(mask)`
- `maskOutline(mask)` for the Outline view
- a history helper: `createHistory(limit)` with `push` / `undo` / `redo` / `canUndo` / `canRedo`

## Data flow and saving

Unchanged outside the editor. `ShowcaseEditorModal` still uploads the final mask
(`handleUploadShowcaseMask`) and saves the surface (`onSaveSurface`). `SurfaceReviewModal` still
calls `onAccept` with the edited mask applied to the surface parts (`applyEditsToParts`). When the
vendor edits, the surface's `needsReview` becomes `false`, as today when accepting.

## Error handling

- Worker errors on Cut out/Add: inline message, and the mask is unchanged.
- Preview failures (`NeedsSurfaceReviewError`, e.g. an empty mask): shown inline; nothing is saved.
- Saving an empty mask is blocked with "The area is empty — add some of the surface first."

## Testing

- **Vitest** (`tests/unit/areaMaskOps.test.ts`):
  - polygon fill add/remove on a known shape;
  - subtract with 2 px dilation leaves no halo;
  - coverage;
  - history limit and undo/redo order.
- **Playwright** (`tests/e2e/area-editor.spec.ts`): open the editor on an image, cut out an object,
  draw a remove polygon, undo it, redo it, save, and assert the mask changed as expected. This
  runs against the demo room with the local models.
- **Manual check**: on the bedroom photo, cut out both lamps, the chandelier and the headboard,
  then render wood. There should be no material on those objects.

## Out of scope

- Edge-snapping ("magnetic") polygon.
- Editing a committed polygon's corners afterwards.
- Changes to the automatic cut in the worker, beyond the new `cutObject` request.
