import { Material } from '../types';

/**
 * TEMPORARY staff-only comparison against Gemini image generation, kept per the rendering
 * plan so the exact renderer can be benchmarked. Not a dependency: nothing in the product
 * path calls it, and it only appears (in the staff debug panel) when a key is configured.
 */
const apiKey = () => process.env.GEMINI_API_KEY || process.env.API_KEY || '';

export const isGeminiCompareAvailable = (): boolean => apiKey().trim().length > 0;

const toBase64 = async (url: string): Promise<{ data: string; mimeType: string }> => {
  const blob = await (await fetch(url)).blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return { data: dataUrl.split(',')[1], mimeType: blob.type || 'image/jpeg' };
};

/** Asks Gemini to re-surface the named areas; resolves to a data URL, or throws. */
export const compareWithGemini = async (roomImageUrl: string, material: Material, targets: string[]): Promise<string> => {
  if (!isGeminiCompareAvailable()) throw new Error('No Gemini key configured.');
  // Loaded only when a staff member actually runs a comparison
  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey: apiKey() });
  const image = await toBase64(roomImageUrl);
  const prompt = `Re-surface only these areas of the room photo: [${targets.join(', ')}] with the material "${material.name}" (${material.finishType}, ${material.colorTone}, ${material.description}). Keep every other pixel of the room unchanged. Output only the image.`;
  const response = await ai.models.generateContent({
    model: 'gemini-3.1-flash-image',
    contents: { parts: [{ text: prompt }, { inlineData: image }] },
  });
  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData?.data) return `data:image/png;base64,${part.inlineData.data}`;
  }
  throw new Error('Gemini returned no image.');
};
