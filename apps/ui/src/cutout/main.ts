// The subject cutout page, loaded by the app in a hidden window (see
// apps/desktop/src/cutout.ts): ISNet, a salient-object model, on ONNX
// Runtime's WebAssembly backend. The runtime ships with the app and main
// serves the model from its resources, so it runs offline and the same on
// every system.

import * as ort from "onnxruntime-web/wasm";
import wasm from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import mjs from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";

/** Where main serves the model. */
const MODEL = "model://cutout/isnet-small.onnx";
/** The model's input and output: a square this many pixels across. */
const SIZE = 1024;

// The runtime's own script, as a file of its own, so its threads can start it in workers.
ort.env.wasm.wasmPaths = { wasm, mjs };
// Threads need a cross-origin isolated page; without one it runs on one.
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

const session = ort.InferenceSession.create(MODEL, { executionProviders: ["wasm"] });

/** The picture as the model takes it: squeezed to SIZE×SIZE, channels first, centred on 0. */
export function toInput(rgba: Uint8ClampedArray): Float32Array {
  const plane = SIZE * SIZE;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) input[c * plane + i] = (rgba[i * 4 + c]! - 128) / 256;
  }
  return input;
}

/** The model's answer (0 background to 1 subject) as an alpha-only picture. */
export function toMask(scores: Float32Array): ImageData {
  const mask = new ImageData(SIZE, SIZE);
  for (let i = 0; i < scores.length; i++) mask.data[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, scores[i]!)) * 255);
  return mask;
}

const b64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/**
 * The subject of a base64 PNG or JPEG, cut out: the picture at its own size
 * with everything else transparent, as a base64 PNG, and the share of the
 * frame the subject covers (near 0 when nothing stood out).
 */
async function cut(picture: string): Promise<{ png: string; coverage: number }> {
  const model = await session;
  const bytes = Uint8Array.from(atob(picture), (c) => c.charCodeAt(0));
  const image = await createImageBitmap(new Blob([bytes]));
  const { width, height } = image;

  const square = new OffscreenCanvas(SIZE, SIZE).getContext("2d", { willReadFrequently: true })!;
  square.drawImage(image, 0, 0, SIZE, SIZE);
  const input = new ort.Tensor("float32", toInput(square.getImageData(0, 0, SIZE, SIZE).data), [1, 3, SIZE, SIZE]);
  const output = (await model.run({ [model.inputNames[0]!]: input }))[model.outputNames[0]!]!;
  const scores = output.data as Float32Array;
  const coverage = scores.reduce((n, s) => n + (s > 0.5 ? 1 : 0), 0) / scores.length;

  const mask = new OffscreenCanvas(SIZE, SIZE);
  mask.getContext("2d")!.putImageData(toMask(scores), 0, 0);
  const out = new OffscreenCanvas(width, height);
  const g = out.getContext("2d")!;
  g.drawImage(image, 0, 0);
  // Keeps the picture only where the mask, stretched back to its size, is.
  g.globalCompositeOperation = "destination-in";
  g.imageSmoothingQuality = "high";
  g.drawImage(mask, 0, 0, width, height);
  image.close();
  const png = new Uint8Array(await (await out.convertToBlob({ type: "image/png" })).arrayBuffer());
  return { png: b64(png), coverage };
}

declare global {
  interface Window {
    clipcatCutout: { ready: Promise<void>; cut: typeof cut };
  }
}

window.clipcatCutout = { ready: session.then(() => undefined), cut };
