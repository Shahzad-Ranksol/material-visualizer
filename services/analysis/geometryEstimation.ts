import * as ort from 'onnxruntime-web/webgpu';
import { RawImage } from '@huggingface/transformers';
import { CameraIntrinsics } from '../../types';
import { configureLocalModels } from './modelEnv';
import { recoverFocalShift, intrinsicsFromFocal } from '../geometryRecovery';
import { PointMap } from '../surfacePlaneFit';

// Monocular geometry: point map, normals, validity mask and metric scale (MIT licence)
export { GEOMETRY_MODEL } from './protocol';
import { GEOMETRY_MODEL } from './protocol';
// Input width for the geometry pass (multiple of the ViT patch size 14) and token budget
const INPUT_WIDTH = 518;
const NUM_TOKENS = 1200n;

let session: Promise<ort.InferenceSession> | null = null;

export interface SceneGeometry {
  pointMap: PointMap; // metric, camera space, at the geometry resolution
  intrinsics: CameraIntrinsics;
  reprojectionErrorPx: number;
}

export const estimateGeometry = async (image: RawImage): Promise<SceneGeometry> => {
  configureLocalModels();
  if (!session) {
    session = ort.InferenceSession.create(`${self.location.origin}/models/${GEOMETRY_MODEL}/model.onnx`, { executionProviders: ['wasm'] });
    session.catch(() => (session = null));
  }
  const s = await session;
  const W = INPUT_WIDTH;
  const H = Math.max(14, Math.round((W * image.height) / image.width / 14) * 14);
  const small = await image.rgb().resize(W, H);
  const chw = new Float32Array(3 * W * H);
  for (let i = 0; i < W * H; i++) for (let c = 0; c < 3; c++) chw[c * W * H + i] = small.data[i * 3 + c] / 255;
  const out = await s.run({
    image: new ort.Tensor('float32', chw, [1, 3, H, W]),
    num_tokens: new ort.Tensor('int64', BigInt64Array.from([NUM_TOKENS]), []),
  });
  const [, oh, ow] = out.points.dims as number[];
  const raw = out.points.data as Float32Array;
  const maskData = out.mask.data as Float32Array;
  const valid = new Uint8Array(ow * oh);
  for (let i = 0; i < valid.length; i++) valid[i] = maskData[i] > 0.5 ? 1 : 0;
  const { shift, focalPx, error } = recoverFocalShift(raw, valid, ow, oh);
  const scale = (out.scale.data as Float32Array)[0];
  const points = new Float32Array(raw.length);
  for (let i = 0; i < ow * oh; i++) {
    points[i * 3] = raw[i * 3] * scale;
    points[i * 3 + 1] = raw[i * 3 + 1] * scale;
    points[i * 3 + 2] = (raw[i * 3 + 2] + shift) * scale;
  }
  return {
    pointMap: { width: ow, height: oh, points, valid, normals: out.normal.data as Float32Array },
    intrinsics: intrinsicsFromFocal(focalPx, ow, oh),
    reprojectionErrorPx: error,
  };
};
