import { harmonizeRender } from '../apiClient';
import { StudioLightingProvider } from './studioLighting';

// Browser side of Studio Lighting: encodes the images, sends them through the Node API (which
// alone talks to the private worker) and decodes the answer. The worker never sees a token.

const toPngBase64 = (canvas: HTMLCanvasElement) => canvas.toDataURL('image/png').split(',')[1];

const imageDataCanvas = (img: ImageData) => {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.putImageData(img, 0, 0);
  return c;
};

const maskCanvas = (mask: Float32Array, w: number, h: number) => {
  const img = new ImageData(w, h);
  for (let i = 0; i < mask.length; i++) {
    const v = Math.round(mask[i] * 255);
    img.data.set([v, v, v, 255], i * 4);
  }
  return imageDataCanvas(img);
};

const urlToBase64 = async (url: string) => {
  const blob = await (await fetch(url)).blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
  return dataUrl.split(',')[1];
};

const decode = (b64: string, w: number, h: number) =>
  new Promise<ImageData>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0, w, h);
      resolve(ctx.getImageData(0, 0, w, h));
    };
    img.onerror = () => reject(new Error('Could not decode the Studio Lighting result'));
    img.src = `data:image/png;base64,${b64}`;
  });

export const createStudioLightingProvider = (token: string): StudioLightingProvider => async ({ original, exact, mask, materialUrl }) => {
  const res = await harmonizeRender(token, {
    original: toPngBase64(imageDataCanvas(original)),
    exact: toPngBase64(imageDataCanvas(exact)),
    mask: toPngBase64(maskCanvas(mask, exact.width, exact.height)),
    material: await urlToBase64(materialUrl),
  });
  // The worker already harmonised and drift-checked; null = it kept the exact render
  return { image: res.image ? await decode(res.image, exact.width, exact.height) : exact, harmonized: true };
};
