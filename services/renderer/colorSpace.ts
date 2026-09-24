// sRGB <-> linear-light conversion (IEC 61966-2-1). All lighting maths happens in linear light;
// sRGB is only the storage/display encoding.

export const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

export const linearToSrgb = (c: number): number => {
  const v = Math.min(1, Math.max(0, c));
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
};

// Byte -> linear lookup table (hot path for per-pixel work)
export const SRGB8_TO_LINEAR: Float32Array = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) t[i] = srgbToLinear(i / 255);
  return t;
})();

export const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** '#rrggbb' -> linear RGB triple */
export const hexToLinear = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return [0.05, 0.05, 0.05];
  return [1, 2, 3].map((i) => srgbToLinear(parseInt(m[i], 16) / 255)) as [number, number, number];
};
