import { Material, RenderSettings, RenderableSurface, MaskSource, RepeatMode } from '../../types';
import { autoFitPlane, planeKindFor, Mat3 } from '../planeGeometry';
import { hexToLinear } from './colorSpace';
import { recoverLighting } from './lightingRecovery';
import { canvas2d, loadImage, prepareAlbedo } from './materialPreprocess';
import { buildSurfaceMapping, defaultIntrinsics, SurfaceMapping } from './surfaceMapping';
import { createTexture, deleteTexture, drawPass, getMaterialGL, UniformValue } from './webglContext';
import { MIN_RENDER_PIXELS } from '../areaMaskOps';
import { harmonizeStudioLighting } from './studioLighting';

/**
 * Thrown instead of rendering when a surface can't be rendered faithfully (no accepted mask,
 * no usable geometry). The UI turns it into a review step — there is no fallback render.
 */
export class NeedsSurfaceReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NeedsSurfaceReviewError';
  }
}

export interface RenderLayerInput {
  surface: RenderableSurface;
  material: Material;
}

const REPEAT_INDEX: Record<RepeatMode, number> = { seamless: 0, sheet: 1, tile: 2, plank: 3, bookmatch: 4, none: 5 };
// Real sheets/tiles/planks never match perfectly: each gets a slight tone shift (±)
const MODULE_TONE_VARIATION = 0.035;
const DEFAULT_JOINT_COLOR = '#2a2a2a';
// Rendered images are object URLs; keep only the most recent few alive
const MAX_LIVE_RESULTS = 8;
const liveResults: string[] = [];

const loadMask = async (source: MaskSource, w: number, h: number) => {
  const drawable = typeof source === 'string' ? await loadImage(source) : source;
  // Over black, so both white-on-black PNGs and in-editor alpha masks read correctly
  const [canvas, ctx] = canvas2d(w, h);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(drawable, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const values = new Float32Array(w * h);
  let covered = 0;
  for (let i = 0; i < values.length; i++) {
    values[i] = data[i * 4] / 255;
    if (values[i] > 0.5) covered++;
  }
  return { canvas, values, covered };
};

const toColumnMajor = (m: Mat3) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

const geometryUniforms = (mapping: SurfaceMapping, w: number, h: number): Record<string, UniformValue> => {
  if (mapping.kind === 'plane') {
    const k = mapping.intrinsics;
    return {
      uGeometry: { type: 'int', value: 1 },
      uPlaneN: { type: 'vec3', value: mapping.normal },
      uPlaneO: { type: 'vec3', value: mapping.origin },
      uAxisU: { type: 'vec3', value: mapping.axisU },
      uAxisV: { type: 'vec3', value: mapping.axisV },
      uIntrinsics: { type: 'vec4', value: [k.fx, k.fy, k.cx, k.cy] },
      uScale: { type: 'float', value: mapping.scale },
      uImageToPlane: { type: 'mat3', value: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
    };
  }
  const k = defaultIntrinsics(w, h);
  return {
    uGeometry: { type: 'int', value: 0 },
    uImageToPlane: { type: 'mat3', value: toColumnMajor(mapping.imageToPlane) },
    uIntrinsics: { type: 'vec4', value: [k.fx, k.fy, k.cx, k.cy] },
    uScale: { type: 'float', value: mapping.scale },
    uPlaneN: { type: 'vec3', value: [0, 0, -1] },
    uPlaneO: { type: 'vec3', value: [0, 0, 1] },
    uAxisU: { type: 'vec3', value: [1, 0, 0] },
    uAxisV: { type: 'vec3', value: [0, 1, 0] },
  };
};

const materialTextures = new WeakMap<HTMLCanvasElement, { gl: WebGL2RenderingContext; tex: WebGLTexture }>();

// Uploads a material map once per GL context (albedo in sRGB, data maps linear)
const materialTexture = (m: ReturnType<typeof getMaterialGL>, canvas: HTMLCanvasElement, srgb: boolean) => {
  let cached = materialTextures.get(canvas);
  if (!cached || cached.gl !== m.gl) {
    cached = { gl: m.gl, tex: createTexture(m, canvas, { srgb, repeat: true }) };
    materialTextures.set(canvas, cached);
  }
  return cached.tex;
};

// Bound in place of a missing optional map (samplers must always point at a texture)
let placeholder: { gl: WebGL2RenderingContext; tex: WebGLTexture } | null = null;
const placeholderTexture = (m: ReturnType<typeof getMaterialGL>) => {
  if (!placeholder || placeholder.gl !== m.gl) {
    placeholder = { gl: m.gl, tex: createTexture(m, { data: new Uint8Array([128, 128, 255, 255]), width: 1, height: 1 }, { srgb: false, repeat: false }) };
  }
  return placeholder.tex;
};

/**
 * The one render path for every screen (studio, showcase editor, storefront, layered hotspots).
 * Re-surfaces each layer's masked area with its material at true physical scale and in
 * perspective, lit by the light recovered from the photo. Pixels outside every mask — and
 * occluders in front of the surface — stay byte-identical to the original.
 * Resolves to an object URL of a lossless PNG.
 */
export const renderMaterial = async (
  roomImageUrl: string,
  layers: RenderLayerInput[],
  settings: RenderSettings = {}
): Promise<string> => {
  if (layers.length === 0) throw new NeedsSurfaceReviewError('Choose a surface to re-surface first.');
  const room = await loadImage(roomImageUrl);
  const w = room.naturalWidth;
  const h = room.naturalHeight;
  const [roomCanvas, roomCtx] = canvas2d(w, h);
  roomCtx.drawImage(room, 0, 0);
  const original = roomCtx.getImageData(0, 0, w, h);
  const out = new Uint8ClampedArray(original.data);
  const debug = settings.debug ?? 'none';

  // Union of every layer's area, for the optional Studio Lighting pass
  const unionMask = new Float32Array(w * h);

  const m = getMaterialGL();
  const roomTex = createTexture(m, roomCanvas, { srgb: true, repeat: false });
  try {
    for (const layer of layers) {
      const mask = await loadMask(layer.surface.mask, w, h);
      if (mask.covered < MIN_RENDER_PIXELS) throw new NeedsSurfaceReviewError('This surface has no area selected yet — review it before rendering.');
      const occluder = layer.surface.occluderMask ? (await loadMask(layer.surface.occluderMask, w, h)).values : null;
      for (let i = 0; i < unionMask.length; i++) {
        const v = mask.values[i] * (occluder ? 1 - occluder[i] : 1);
        if (v > unionMask[i]) unionMask[i] = v;
      }

      if (debug === 'mask') {
        // Amber = surface, cyan = occluders restored on top
        for (let i = 0; i < mask.values.length; i++) {
          const a = mask.values[i] * 0.5;
          const o = occluder ? occluder[i] * 0.6 : 0;
          const p = i * 4;
          out[p] = out[p] * (1 - a - o) + 251 * a + 34 * o;
          out[p + 1] = out[p + 1] * (1 - a - o) + 191 * a + 211 * o;
          out[p + 2] = out[p + 2] * (1 - a - o) + 36 * a + 238 * o;
        }
        continue;
      }

      let mapping = buildSurfaceMapping(layer.surface.plane, w, h, layer.surface.calibration);
      if (!mapping) {
        // No saved geometry: fit one from the mask (walls head-on, floors via the level-camera model)
        const fitted = autoFitPlane(mask.canvas, planeKindFor(layer.surface.kind ?? null));
        mapping = fitted ? buildSurfaceMapping({ homographyFallback: fitted }, w, h, layer.surface.calibration) : null;
      }
      if (!mapping) throw new NeedsSurfaceReviewError('The perspective of this surface could not be worked out — set its corners in the editor.');

      const lighting = recoverLighting(original.data, mask.values, occluder, w, h);
      const albedo = await prepareAlbedo(layer.material);
      const albedoTex = materialTexture(m, albedo.canvas, true);
      const normalTex = albedo.normal ? materialTexture(m, albedo.normal, false) : placeholderTexture(m);
      const roughnessTex = albedo.roughness ? materialTexture(m, albedo.roughness, false) : placeholderTexture(m);
      const lightTex = createTexture(m, { data: lighting.texture, width: w, height: h }, { srgb: false, repeat: false });
      const material = layer.material;
      const pixels = drawPass(
        m,
        w,
        h,
        { uAlbedo: albedoTex, uLight: lightTex, uRoom: roomTex, uNormalMap: normalTex, uRoughnessMap: roughnessTex },
        {
          uImageSize: { type: 'vec2', value: [w, h] },
          ...geometryUniforms(mapping, w, h),
          uTileMm: { type: 'vec2', value: [albedo.tileWidthMm, albedo.tileHeightMm] },
          uRepeat: { type: 'int', value: REPEAT_INDEX[material.repeatMode] ?? 0 },
          uJointMm: { type: 'float', value: material.jointWidthMm ?? 0 },
          uJointColor: { type: 'vec3', value: hexToLinear(material.jointColor ?? DEFAULT_JOINT_COLOR) },
          uToneVariation: { type: 'float', value: MODULE_TONE_VARIATION },
          uRoughness: { type: 'float', value: material.roughness },
          uMetallic: { type: 'float', value: material.metallic },
          uNormalStrength: { type: 'float', value: material.normalStrength },
          uLightDir: { type: 'vec3', value: lighting.lightDir },
          uDebug: { type: 'int', value: debug === 'uv' ? 1 : debug === 'lighting' ? 2 : 0 },
          uHasNormalMap: { type: 'int', value: albedo.normal ? 1 : 0 },
          uHasRoughnessMap: { type: 'int', value: albedo.roughness ? 1 : 0 },
          uOrientation: { type: 'float', value: (material.orientationDeg * Math.PI) / 180 },
        }
      );
      deleteTexture(m, lightTex);

      // Composite: surface alpha from the mask, occluders restored exactly on top
      for (let i = 0; i < mask.values.length; i++) {
        const a = mask.values[i] * (pixels[i * 4 + 3] / 255) * (occluder ? 1 - occluder[i] : 1);
        if (a <= 0) continue;
        const p = i * 4;
        out[p] = out[p] * (1 - a) + pixels[p] * a;
        out[p + 1] = out[p + 1] * (1 - a) + pixels[p + 1] * a;
        out[p + 2] = out[p + 2] * (1 - a) + pixels[p + 2] * a;
      }
    }
  } finally {
    deleteTexture(m, roomTex);
  }

  let result = new ImageData(out, w, h);
  if (settings.mode === 'studio' && debug === 'none') {
    const first = layers[0].material;
    result = (await harmonizeStudioLighting(original, result, unionMask, first.albedoUrl || first.thumbnail)) ?? result;
  }
  roomCtx.putImageData(result, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) =>
    roomCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the render'))), 'image/png')
  );
  const url = URL.createObjectURL(blob);
  liveResults.push(url);
  while (liveResults.length > MAX_LIVE_RESULTS) URL.revokeObjectURL(liveResults.shift()!);
  return url;
};
