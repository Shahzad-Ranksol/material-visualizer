import { Material, RenderableSurface } from '../types';
import { selectedAreaAlpha } from './renderer/materialRenderer';
import { RenderLayerInput } from './renderer/materialRenderer';

export type LightingPresetId = 'daylight-noon' | 'warm-evening' | 'cool-led' | 'night-lamp';

export interface LightingPreset {
  id: LightingPresetId;
  name: string;
  intensity: number;
  whiteBalance: [number, number, number];
  note: (material: Material) => string;
}

export interface PixelBuffer {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

const undertones = (material: Material) => `${material.name} ${material.colorTone}`.toLowerCase();

export const LIGHTING_PRESETS: LightingPreset[] = [
  {
    id: 'daylight-noon',
    name: 'Daylight Noon',
    intensity: 1.08,
    whiteBalance: [1, 1, 1],
    note: () => 'Neutral daylight makes undertones easiest to judge.',
  },
  {
    id: 'warm-evening',
    name: 'Warm Evening',
    intensity: 0.78,
    whiteBalance: [1.06, 1.01, 0.9],
    note: (material) =>
      /gr[ae]y|blue|cool/.test(undertones(material))
        ? 'Warm light can pull cool grey tones toward taupe.'
        : 'Warm light enriches amber and red undertones.',
  },
  {
    id: 'cool-led',
    name: 'Cool LED',
    intensity: 0.92,
    whiteBalance: [0.93, 0.99, 1.07],
    note: (material) =>
      /gr[ae]y/.test(undertones(material))
        ? 'Cool LEDs can make this grey read bluer.'
        : 'Cool LEDs can sharpen cool undertones.',
  },
  {
    id: 'night-lamp',
    name: 'Dim Night Lamp',
    intensity: 0.4,
    whiteBalance: [1.08, 1, 0.8],
    note: () => 'Dim light deepens shadows and can hide fine texture.',
  },
];

const SRGB_TO_LINEAR = Array.from({ length: 256 }, (_, value) => {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
});

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const srgbByte = (value: number) => {
  const linear = clamp(value, 0, 1);
  const srgb = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
  return Math.round(srgb * 255);
};

const luminance = (data: Uint8ClampedArray, pixelIndex: number) =>
  SRGB_TO_LINEAR[data[pixelIndex]] * 0.2126 +
  SRGB_TO_LINEAR[data[pixelIndex + 1]] * 0.7152 +
  SRGB_TO_LINEAR[data[pixelIndex + 2]] * 0.0722;

const estimateIllumination = (image: PixelBuffer) => {
  const columns = Math.max(1, Math.min(96, Math.ceil(image.width / 20)));
  const rows = Math.max(1, Math.min(64, Math.ceil(image.height / 20)));
  const sums = new Float32Array(columns * rows);
  const counts = new Uint32Array(columns * rows);
  let total = 0;

  for (let y = 0; y < image.height; y++) {
    const row = Math.min(rows - 1, Math.floor((y * rows) / image.height));
    for (let x = 0; x < image.width; x++) {
      const index = (y * image.width + x) * 4;
      const cell = row * columns + Math.min(columns - 1, Math.floor((x * columns) / image.width));
      const light = luminance(image.data, index);
      sums[cell] += light;
      counts[cell]++;
      total += light;
    }
  }

  const mean = total / (image.width * image.height);
  const blurred = new Float32Array(sums.length);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      let value = 0;
      let weight = 0;
      for (let offsetY = -1; offsetY <= 1; offsetY++) {
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          const sampleX = x + offsetX;
          const sampleY = y + offsetY;
          if (sampleX < 0 || sampleY < 0 || sampleX >= columns || sampleY >= rows) continue;
          const cell = sampleY * columns + sampleX;
          const sampleWeight = offsetX === 0 && offsetY === 0 ? 4 : offsetX === 0 || offsetY === 0 ? 2 : 1;
          value += (sums[cell] / Math.max(1, counts[cell])) * sampleWeight;
          weight += sampleWeight;
        }
      }
      blurred[y * columns + x] = value / Math.max(weight, 1);
    }
  }

  return { columns, rows, mean, values: blurred };
};

export const applyLightingPreset = (
  original: PixelBuffer,
  rendered: PixelBuffer,
  coverage: Float32Array,
  material: Material,
  preset: LightingPreset
): PixelBuffer => {
  if (original.width !== rendered.width || original.height !== rendered.height) {
    throw new Error('Room photo and material render dimensions do not match.');
  }
  const pixelCount = rendered.width * rendered.height;
  if (coverage.length !== pixelCount) throw new Error('Surface coverage does not match the render dimensions.');

  const illumination = estimateIllumination(original);
  const output = new Uint8ClampedArray(rendered.data);
  const roughness = clamp(material.roughness, 0, 1);
  const metallic = clamp(material.metallic, 0, 1);
  const glossResponse = (1 - roughness) ** 2 * (0.72 + metallic * 0.55);

  for (let y = 0; y < rendered.height; y++) {
    const gridY = Math.min(illumination.rows - 1, Math.floor((y * illumination.rows) / rendered.height));
    for (let x = 0; x < rendered.width; x++) {
      const pixel = y * rendered.width + x;
      const index = pixel * 4;
      const gridX = Math.min(illumination.columns - 1, Math.floor((x * illumination.columns) / rendered.width));
      const localLight = illumination.values[gridY * illumination.columns + gridX];
      const relativeLight = clamp(localLight / Math.max(illumination.mean, 0.025), 0.55, 1.5);
      const energy = preset.intensity * (0.9 + 0.1 * relativeLight);
      const sourceLight = luminance(original.data, index);
      const highlight = clamp((sourceLight / Math.max(localLight, 0.025) - 1.06) * 1.8, 0, 1);
      const alpha = clamp(coverage[pixel], 0, 1);
      const specular = alpha * highlight * glossResponse * 0.035 * preset.intensity;

      const baseRed = SRGB_TO_LINEAR[rendered.data[index]];
      const baseGreen = SRGB_TO_LINEAR[rendered.data[index + 1]];
      const baseBlue = SRGB_TO_LINEAR[rendered.data[index + 2]];
      const base = [baseRed, baseGreen, baseBlue];

      for (let channel = 0; channel < 3; channel++) {
        const lightColor = preset.whiteBalance[channel];
        const diffuse = base[channel] * lightColor * energy;
        const reflectedLight = lightColor * (1 - metallic * 0.55) + base[channel] * metallic * 0.55;
        output[index + channel] = srgbByte(diffuse + reflectedLight * specular);
      }
    }
  }

  return { width: rendered.width, height: rendered.height, data: output };
};

const objectKeys = new WeakMap<object, number>();
let nextObjectKey = 1;

const identityForMask = (mask: RenderableSurface['mask']) => {
  if (typeof mask === 'string') return `url:${hash(mask)}`;
  let id = objectKeys.get(mask);
  if (!id) {
    id = nextObjectKey++;
    objectKeys.set(mask, id);
  }
  return `object:${id}`;
};

const hash = (value: string) => {
  let result = 2166136261;
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
};

export const lightingComparisonKey = (roomKey: string, layers: RenderLayerInput[]) =>
  hash(
    JSON.stringify([
      'room-lighting-v1',
      roomKey,
      layers.map(({ surface, material }) => ({
        kind: surface.kind,
        mask: identityForMask(surface.mask),
        occluder: surface.occluderMask ? identityForMask(surface.occluderMask) : null,
        plane: surface.plane,
        calibration: surface.calibration,
        material: [
          material.id,
          material.albedoUrl,
          material.normalUrl,
          material.roughnessUrl,
          material.heightUrl,
          material.thumbnail,
          material.roughness,
          material.metallic,
          material.normalStrength,
          material.realWidthMm,
          material.realHeightMm,
          material.repeatMode,
          material.orientationDeg,
          material.jointWidthMm,
          material.jointColor,
          material.finishType,
        ],
      })),
    ])
  );

const decodeImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load the room preview for lighting comparison.'));
    image.src = url;
  });

const readPixels = async (url: string): Promise<PixelBuffer> => {
  const image = await decodeImage(url);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas pixel processing is unavailable in this browser.');
  context.drawImage(image, 0, 0);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  return { width: imageData.width, height: imageData.height, data: imageData.data };
};

const encodePng = async (pixels: PixelBuffer) => {
  const canvas = document.createElement('canvas');
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas image export is unavailable in this browser.');
  context.putImageData(new ImageData(pixels.data, pixels.width, pixels.height), 0, 0);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode a lighting preview.'))), 'image/png')
  );
};

const MAX_CACHED_COMPARISONS = 4;
const blobCache = new Map<string, Promise<Blob[]>>();

const createLightingBlobs = async (roomUrl: string, renderUrl: string, layers: RenderLayerInput[]) => {
  const [original, rendered] = await Promise.all([readPixels(roomUrl), readPixels(renderUrl)]);
  const surfaces = layers.map(({ surface }) => surface);
  const coverage = await selectedAreaAlpha(roomUrl, surfaces);
  if (coverage.width !== rendered.width || coverage.height !== rendered.height) {
    throw new Error('The selected surface mask does not match this room photo.');
  }
  const material = layers[0].material;
  const blobs: Blob[] = [];
  for (const preset of LIGHTING_PRESETS) {
    const pixels = applyLightingPreset(original, rendered, coverage.alpha, material, preset);
    blobs.push(await encodePng(pixels));
  }
  return blobs;
};

export const getLightingComparisonBlobs = async (
  roomKey: string,
  roomUrl: string,
  renderUrl: string,
  layers: RenderLayerInput[]
) => {
  if (!layers.length) throw new Error('Apply a material to a selected surface first.');
  const key = lightingComparisonKey(roomKey, layers);
  let comparison = blobCache.get(key);
  if (comparison) {
    blobCache.delete(key);
    blobCache.set(key, comparison);
    return comparison;
  }

  comparison = createLightingBlobs(roomUrl, renderUrl, layers);
  blobCache.set(key, comparison);
  while (blobCache.size > MAX_CACHED_COMPARISONS) blobCache.delete(blobCache.keys().next().value!);
  try {
    return await comparison;
  } catch (error) {
    if (blobCache.get(key) === comparison) blobCache.delete(key);
    throw error;
  }
};
