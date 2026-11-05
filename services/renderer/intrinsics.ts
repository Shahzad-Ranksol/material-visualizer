import { SRGB8_TO_LINEAR } from './colorSpace';

/**
 * A scene photo's light, baked offline (scripts/intrinsic/bake.py, Marigold-IID): the photo is
 * albedo × diffuse shading + residual (reflections, highlights), all in linear light. With these
 * layers a finish renders as new albedo × shading + residual — the photo's real shadows, sun and
 * window falloff stay exactly, and the old surface's own colour and grain (which belong to the
 * albedo) are gone instead of being guessed apart from the light.
 *
 * Stored as sRGB-encoded 8-bit PNGs the size of the photo: shading × `shadingScale` (0.5 — light
 * up to twice a white sheet's — or less for a scene in direct sun), residual as is.
 */
export interface IntrinsicSources {
  shading: string;
  reflection: string;
  shadingScale: number;
}

export interface Intrinsics {
  // Linear RGB per pixel (3 floats each): diffuse shading (1 = a white sheet's light) and residual
  shading: Float32Array;
  reflection: Float32Array;
  // The decoded images, for upload as sRGB textures (shading × shadingScale)
  shadingImage: HTMLCanvasElement;
  shadingScale: number;
  reflectionImage: HTMLCanvasElement;
}

/** Linear-light layers from 8-bit sRGB RGBA data (shading divided back by its scale). */
export const decodeIntrinsics = (shadingRgba: ArrayLike<number>, reflectionRgba: ArrayLike<number>, n: number, shadingScale: number) => {
  const shading = new Float32Array(n * 3);
  const reflection = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      shading[i * 3 + c] = SRGB8_TO_LINEAR[shadingRgba[i * 4 + c]] / shadingScale;
      reflection[i * 3 + c] = SRGB8_TO_LINEAR[reflectionRgba[i * 4 + c]];
    }
  }
  return { shading, reflection };
};

const drawToCanvas = async (src: string, w: number, h: number) => {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = src;
  await img.decode();
  if (img.naturalWidth !== w || img.naturalHeight !== h) {
    throw new Error(`Baked light ${src} is ${img.naturalWidth}×${img.naturalHeight}, the photo ${w}×${h}`);
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  return { canvas, data: ctx.getImageData(0, 0, w, h).data };
};

export const loadIntrinsics = async (sources: IntrinsicSources, w: number, h: number): Promise<Intrinsics> => {
  const [s, r] = await Promise.all([drawToCanvas(sources.shading, w, h), drawToCanvas(sources.reflection, w, h)]);
  return { ...decodeIntrinsics(s.data, r.data, w * h, sources.shadingScale), shadingImage: s.canvas, reflectionImage: r.canvas, shadingScale: sources.shadingScale };
};
