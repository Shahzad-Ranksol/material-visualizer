import type { Request, Response } from 'express';

// Optional "Studio Lighting" worker (Phase 3 of the rendering plan): a private, self-hosted
// service that harmonises low-frequency lighting of an exact render. Disabled unless
// VISION_SERVICE_URL is set; the product never depends on it and never calls a metered API.
const visionServiceUrl = () => process.env.VISION_SERVICE_URL?.replace(/\/+$/, '') || null;

export const getRenderCapabilities = (_req: Request, res: Response) => {
  res.json({ exactPreview: true, studioLighting: Boolean(visionServiceUrl()) });
};

export const harmonizeRender = async (req: Request, res: Response) => {
  const base = visionServiceUrl();
  if (!base) {
    res.status(501).json({ error: 'Studio Lighting is not enabled on this server.' });
    return;
  }
  try {
    const upstream = await fetch(`${base}/harmonize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(120_000),
    });
    res.status(upstream.status).type(upstream.headers.get('content-type') || 'application/json').send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.error('Vision service request failed', err);
    res.status(502).json({ error: 'The Studio Lighting worker did not respond.' });
  }
};
