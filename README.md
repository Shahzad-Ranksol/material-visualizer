# Material Visualizer

A generic, multi-tenant material visualization studio: upload or pick a room photo, apply tile/sheet/carpet/wallpaper/paint/stone/wood/plaster/metal/fabric finishes to it, and preview the result — entirely client-side, zero API cost by default (see `PROJECT.md`).

Any signed-in vendor can also build a public, no-login showroom of their own catalog with clickable hotspots, published at `/store/<their-slug>` — see `CLAUDE.md`'s "Vendor storefront & hotspots" section for how that works.

This repo is two independently-run projects:

- **Frontend** (this directory): React 19 + Vite + TypeScript.
- **`server/`**: Node + Express + Prisma + MySQL backend (auth, tenants, materials, showcases).

## Run locally

### Frontend

```bash
npm install
npm run dev
```
Runs at `http://localhost:3000`. Works fully offline out of the box — no API key or backend required for the core studio experience.

Optional: copy `.env.example` to `.env.local` to set `GEMINI_API_KEY` (enables the opt-in "AI Enhance" toggle) or `VITE_API_URL` (point at a non-default backend URL).

### Backend (`server/`)

```bash
cd server
npm install
docker compose up -d mysql   # from the repo root, or point DATABASE_URL at your own MySQL
cp .env.example .env
npx prisma migrate dev
npm run prisma:seed          # populates the shared default material catalog
npm run dev
```
Runs at `http://localhost:4000`. Sign in from the running frontend to exercise the tenant catalog, showcase editor, and public storefront.

## Docs

- `CLAUDE.md` — architecture guide for working in this codebase.
- `PROJECT.md` — vision, current state, and roadmap.
- `DESIGN.md`, `FONTS.md`, `REFERENCES.md` — design system, typography, and external dependencies.
