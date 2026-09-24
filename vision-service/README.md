# vision-service — optional "Studio Lighting" worker (disabled by default)

Phase 3 of `Material_Visualizer_Market_Ready_Rendering_Plan.md`. A private, self-hosted Python
service the Node API calls **only** when `VISION_SERVICE_URL` is set (see
`server/src/controllers/render.controller.ts`). Nothing in the product depends on it; with it
off, every render is the deterministic in-browser **Exact Preview**.

What it does when enabled: runs MatSwap on the exact render's surface to get a lighting-aware AI
version, then keeps **only its low-frequency lighting difference** (clamped ±0.25 in log space)
and discards the result if it drifted from the product's colour
(`pipelines/matswap_harmonize.py`, mirrored in `services/renderer/studioLighting.ts`).
Product detail and every pixel outside the surface always come from the exact render.

Status: the harmonisation maths, API schema and tests are implemented; the MatSwap model call
(`models.py`) is a stub that returns HTTP 501 until a GPU host is provisioned.

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
pytest                      # harmonisation maths + API schema
uvicorn app:app --port 8000 # then set VISION_SERVICE_URL=http://localhost:8000 for the API
```

Requires an NVIDIA GPU for the real model (MatSwap is a diffusion model); the stub and tests run
anywhere. `pipelines/analyze_room.py` is the placeholder for the quality analysis path
(SAM 3.1 + MoGe-3) to benchmark against the browser pipeline.
