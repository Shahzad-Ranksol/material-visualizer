import { env } from '@huggingface/transformers';

// All models are served from the app's own origin (`npm run assets:fetch`) — no Hugging Face
// request at runtime. ONNX Runtime's .wasm files ship with the app bundle (see vite.config.ts),
// so no CDN is involved either.
const origin = typeof self !== 'undefined' && self.location ? self.location.origin : '';

let configured = false;
export const configureLocalModels = () => {
  if (configured) return;
  configured = true;
  // The app's own /models/ folder stands in for the model hub. (Not `localModelPath`: in
  // transformers.js 4.3 an http(s) local path fails its file-existence check, so pipelines load
  // without their preprocessor — "this.processor is not a function" in any uncached browser.)
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.remoteHost = `${origin}/models/`;
  env.remotePathTemplate = '{model}/';
};
