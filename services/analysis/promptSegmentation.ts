import { AutoProcessor, RawImage, Sam2Model, Tensor } from '@huggingface/transformers';
import { configureLocalModels } from './modelEnv';

// Promptable, edge-accurate masks: SAM 2.1 Hiera Tiny (Apache-2.0)
export { PROMPT_MODEL } from './protocol';
import { PROMPT_MODEL } from './protocol';

let loaded: Promise<{ model: any; processor: any }> | null = null;
const load = () => {
  configureLocalModels();
  if (!loaded) {
    loaded = Promise.all([Sam2Model.from_pretrained(PROMPT_MODEL, { dtype: 'q8' }), AutoProcessor.from_pretrained(PROMPT_MODEL)]).then(
      ([model, processor]) => ({ model, processor })
    );
    loaded.catch(() => (loaded = null));
  }
  return loaded;
};

export interface PromptEncoding {
  imageInputs: any;
  embeddings: Record<string, Tensor>;
}

/** The slow step (image encoder) — done once per photo, then any number of prompts are cheap. */
export const encodeForPrompts = async (image: RawImage): Promise<PromptEncoding> => {
  const { model, processor } = await load();
  const imageInputs = await processor(image);
  const embeddings = await model.get_image_embeddings(imageInputs);
  return { imageInputs, embeddings };
};

export interface PromptPoint {
  x: number; // image pixels
  y: number;
  positive: boolean;
}

/**
 * Candidate masks (binary, full image resolution) for point prompts plus an optional box
 * (image pixels). SAM returns several candidates with its own predicted IoU each.
 */
export const segmentWithPrompts = async (
  enc: PromptEncoding,
  points: PromptPoint[],
  box: { x0: number; y0: number; x1: number; y1: number } | null,
  width: number,
  height: number
): Promise<{ masks: Uint8Array[]; scores: number[] }> => {
  const { model, processor } = await load();
  const [rh, rw] = enc.imageInputs.reshaped_input_sizes[0];
  const sx = rw / width;
  const sy = rh / height;
  const inputs: Record<string, Tensor> = {
    input_points: new Tensor('float32', points.flatMap((p) => [p.x * sx, p.y * sy]), [1, 1, points.length, 2]),
    input_labels: new Tensor('int64', points.map((p) => BigInt(p.positive ? 1 : 0)), [1, 1, points.length]),
  };
  if (box) inputs.input_boxes = new Tensor('float32', [box.x0 * sx, box.y0 * sy, box.x1 * sx, box.y1 * sy], [1, 1, 4]);
  const outputs = await model({ ...enc.embeddings, ...inputs });
  const [masks] = await processor.post_process_masks(outputs.pred_masks, enc.imageInputs.original_sizes, enc.imageInputs.reshaped_input_sizes);
  const [, count, h, w] = masks.dims as number[];
  const data = masks.data as Uint8Array;
  return {
    masks: Array.from({ length: count }, (_, k) => data.slice(k * w * h, (k + 1) * w * h)),
    scores: Array.from(outputs.iou_scores.data as Float32Array),
  };
};
