# External References

Every external URL/service this app actually depends on, grounded in the code (no invented references):

## Runtime dependencies

- **Google Fonts CDN** (`fonts.googleapis.com`, `fonts.gstatic.com`) — `index.html:10-12`. See `FONTS.md`.
- **Tailwind CSS CDN** (`cdn.tailwindcss.com`) — `index.html:13`. Not an npm dependency; the whole design system config lives inline in `index.html` rather than a `tailwind.config.js`.
- **Unsplash** (`images.unsplash.com`) — hotlinked thumbnail/full images for every entry in `CURATED_ROOMS` and `MATERIALS` (`constants.ts`). Not self-hosted; if Unsplash changes/removes an image URL, that material or room preview breaks. No API key required (these are direct CDN image URLs, not Unsplash API calls).
- **Google Gemini API** (`@google/genai`, endpoints under Google's AI infrastructure) — `services/geminiService.ts`. Only called when the "AI Enhance" toggle is on *and* `GEMINI_API_KEY`/`API_KEY` is set. See `PROJECT.md`'s "API-free by default" principle.

## Leftover / unused

- **`aistudiocdn.com` import map** — `index.html:42-51`. Maps `react`, `react-dom`, and `@google/genai` to CDN URLs. This is a leftover from the Google AI Studio export; the real Vite dev/build pipeline resolves these packages from `node_modules` instead, so this import map is effectively unused in local dev or `npm run build`. Safe to remove if not needed for some other AI-Studio-specific runtime.

## Backend (`server/`)

No external services beyond the MySQL instance it connects to (`DATABASE_URL`, either the local `docker-compose.yml` MySQL container or a MySQL server you already run). No third-party APIs are called by the backend in this pass.
