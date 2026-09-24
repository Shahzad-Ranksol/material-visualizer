import { pipeline, RawImage } from '@huggingface/transformers';
import { configureLocalModels } from './modelEnv';

// Coarse class proposals (wall / floor / ceiling / door / window / furniture …), ADE20K
export { SEMANTIC_MODEL } from './protocol';
import { SEMANTIC_MODEL } from './protocol';

let segmenter: Promise<any> | null = null;

export interface SemanticMap {
  labels: string[];
  // Per-pixel index into `labels` (255 = unlabelled), at the image's full resolution
  labelMap: Uint8Array;
}

export const segmentSemantics = async (image: RawImage): Promise<SemanticMap> => {
  configureLocalModels();
  if (!segmenter) {
    segmenter = pipeline('image-segmentation', SEMANTIC_MODEL, { dtype: 'q8' });
    segmenter.catch(() => (segmenter = null));
  }
  const results: Array<{ label: string; mask: RawImage }> = await (await segmenter)(image);
  const labelMap = new Uint8Array(image.width * image.height).fill(255);
  results.forEach((r, index) => {
    const { data, channels } = r.mask;
    for (let i = 0; i < labelMap.length; i++) if (data[i * channels]) labelMap[i] = index;
  });
  return { labels: results.map((r) => r.label), labelMap };
};
