import { CameraIntrinsics } from '../../types';

/**
 * Per-photo analysis cache in IndexedDB (usable from the worker). Keyed by a hash of the
 * normalized image pixels plus the analysis version, so re-opening or re-uploading the same
 * room skips the slow models, and a model/algorithm upgrade invalidates old entries.
 */
export interface CachedAnalysis {
  labels: string[];
  labelMap: Uint8Array;
  geometry: null | {
    width: number;
    height: number;
    points: Float32Array;
    valid: Uint8Array;
    normals?: Float32Array;
    intrinsics: CameraIntrinsics;
    reprojectionErrorPx: number;
  };
}

const DB_NAME = 'material-visualizer-analysis';
const STORE = 'rooms';

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const run = async <T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};

export const readCachedAnalysis = async (key: string): Promise<CachedAnalysis | null> => {
  try {
    return ((await run('readonly', (s) => s.get(key))) as CachedAnalysis | undefined) ?? null;
  } catch {
    return null; // private mode / storage blocked: just recompute
  }
};

export const writeCachedAnalysis = async (key: string, value: CachedAnalysis) => {
  try {
    await run('readwrite', (s) => s.put(value, key));
  } catch {
    // Quota or blocked storage — caching is an optimisation only
  }
};

/** SHA-256 over the image's size and a normalized 64x64 RGB thumbnail of its pixels. */
export const imageKey = async (rgb: Uint8ClampedArray | Uint8Array, width: number, height: number, channels: number, version: string) => {
  const N = 64;
  const thumb = new Uint8Array(N * N * 3 + 8);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const sx = Math.min(width - 1, Math.floor(((x + 0.5) * width) / N));
      const sy = Math.min(height - 1, Math.floor(((y + 0.5) * height) / N));
      const o = (sy * width + sx) * channels;
      thumb.set([rgb[o], rgb[o + 1], rgb[o + 2]], (y * N + x) * 3);
    }
  }
  new DataView(thumb.buffer).setUint32(N * N * 3, width);
  new DataView(thumb.buffer).setUint32(N * N * 3 + 4, height);
  const digest = await crypto.subtle.digest('SHA-256', thumb);
  return `${version}:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')}`;
};
