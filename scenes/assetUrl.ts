// Production builds fingerprint every file under public/scenes/ (vite.config.ts: a short hash of
// its contents), and the scene data hands out `/scenes/…png?v=<hash>`: a re-baked mask gets a new
// URL, so a browser holding the old file never shows it again. Dev and tests: plain URLs.
declare const __SCENE_ASSETS__: Record<string, string> | undefined;
const HASHES: Record<string, string> = typeof __SCENE_ASSETS__ !== 'undefined' ? __SCENE_ASSETS__ : {};

export const assetUrl = (url: string): string => (!url.includes('?') && HASHES[url] ? `${url}?v=${HASHES[url]}` : url);

/** The same data with every `/scenes/…` string in it fingerprinted. */
export const withAssetUrls = <T>(data: T): T => {
  if (!Object.keys(HASHES).length) return data;
  const walk = (v: unknown): unknown =>
    typeof v === 'string'
      ? v.startsWith('/scenes/')
        ? assetUrl(v)
        : v
      : Array.isArray(v)
        ? v.map(walk)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
          : v;
  return walk(data) as T;
};
