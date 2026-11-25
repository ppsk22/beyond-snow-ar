// Person segmentation worker (MediaPipe Image Segmenter). Runs off the main thread so the AR loop
// never blocks on inference. Receives RGBA frames, returns a person mask (0..255, same size).

import { FilesetResolver, ImageSegmenter } from './vendor/mediapipe/vision_bundle.mjs';

const WASM = new URL('./vendor/mediapipe/wasm', import.meta.url).href;

// Local copies first (drop .tflite files into assets/models/ to avoid the download), then Google's.
const MODELS = {
  deeplab: ['../assets/models/deeplab_v3.tflite',
    'https://storage.googleapis.com/mediapipe-models/image_segmenter/deeplab_v3/float32/1/deeplab_v3.tflite',
    'https://storage.googleapis.com/mediapipe-assets/deeplabv3.tflite'],
  selfie: ['../assets/models/selfie_segmenter.tflite',
    'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite'],
  multiclass: ['../assets/models/selfie_multiclass_256x256.tflite',
    'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite'],
};

let seg = null;
let personIndex = 0;
let invertBackground = false;
let lastT = 0;

async function create(vision, url, delegate) {
  // In a module worker MediaPipe's loader import does not set the global factory it expects,
  // and it clears it after every use. Set it ourselves before each attempt.
  const mod = await import(WASM + '/vision_wasm_module_internal.js');
  self.ModuleFactory = mod.default;
  return ImageSegmenter.createFromOptions(vision, {
    baseOptions: { modelAssetPath: url, delegate },
    runningMode: 'VIDEO',
    outputConfidenceMasks: true,
    outputCategoryMask: false,
  });
}

async function init(model) {
  const vision = await FilesetResolver.forVisionTasks(WASM, true);
  const urls = MODELS[model] || MODELS.deeplab;
  let lastErr = null;
  for (const url of urls) {
    const full = new URL(url, import.meta.url).href;
    for (const delegate of ['GPU', 'CPU']) {
      try {
        seg = await create(vision, full, delegate);
        const labels = (seg.getLabels && seg.getLabels()) || [];
        const pi = labels.findIndex((l) => /person/i.test(l));
        if (pi >= 0) { personIndex = pi; invertBackground = false; }
        else if (model === 'multiclass') { personIndex = 0; invertBackground = true; }
        else { personIndex = 0; invertBackground = false; }
        return { url: full, delegate, labels };
      } catch (e) { lastErr = e; }
    }
  }
  throw lastErr || new Error('no model could be loaded');
}

self.onmessage = async (ev) => {
  const m = ev.data;
  if (m.type === 'init') {
    try {
      const info = await init(m.model);
      self.postMessage({ type: 'ready', info: { url: info.url, delegate: info.delegate, labels: info.labels.slice(0, 30) } });
    } catch (e) {
      self.postMessage({ type: 'error', message: String(e && e.message || e) });
    }
    return;
  }
  if (m.type === 'frame' && seg) {
    try {
      const img = new ImageData(new Uint8ClampedArray(m.data), m.w, m.h);
      // Timestamps must increase strictly in VIDEO mode.
      const t = Math.max(lastT + 1, Math.round(m.t));
      lastT = t;
      const t0 = performance.now();
      const res = seg.segmentForVideo(img, t);
      const masks = res.confidenceMasks || [];
      const mk = masks[Math.min(personIndex, masks.length - 1)];
      const out = new Uint8Array(m.w * m.h);
      if (mk) {
        const f = mk.getAsFloat32Array();
        const n = Math.min(out.length, f.length);
        for (let i = 0; i < n; i++) {
          const v = invertBackground ? 1 - f[i] : f[i];
          out[i] = v <= 0 ? 0 : v >= 1 ? 255 : (v * 255) | 0;
        }
      }
      for (const x of masks) x.close && x.close();
      if (res.close) res.close();
      self.postMessage({ type: 'mask', w: m.w, h: m.h, data: out.buffer, ms: performance.now() - t0, id: m.id }, [out.buffer]);
    } catch (e) {
      self.postMessage({ type: 'mask-error', message: String(e && e.message || e), id: m.id });
    }
  }
};
