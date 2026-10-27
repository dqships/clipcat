// The face detector page, loaded by the app in a hidden window (see
// apps/desktop/src/faceDetector.ts): MediaPipe's BlazeFace short-range model,
// made for faces within a couple of metres of the camera, which is a talking
// head. The model and the WebAssembly runtime ship with the app, so it runs
// offline and the same on every system.

import { FaceDetector, type FaceDetectorResult } from "@mediapipe/tasks-vision";
import model from "./blaze_face_short_range.tflite?url";
import wasmBinaryPath from "@mediapipe/tasks-vision/vision_wasm_internal.wasm?url";
import wasmLoaderPath from "@mediapipe/tasks-vision/vision_wasm_internal.js?url";

/** A face, as fractions of the frame. */
export type FaceBox = { x: number; y: number; width: number; height: number };

export function toBoxes(result: FaceDetectorResult, width: number, height: number): FaceBox[] {
  return result.detections.flatMap(({ boundingBox: b }) =>
    b ? [{ x: b.originX / width, y: b.originY / height, width: b.width / width, height: b.height / height }] : [],
  );
}

const detector = FaceDetector.createFromOptions(
  { wasmLoaderPath, wasmBinaryPath },
  { baseOptions: { modelAssetPath: model, delegate: "CPU" }, runningMode: "IMAGE", minDetectionConfidence: 0.5 },
);

/** Faces in each base64 JPEG, as fractions of its frame. */
async function detect(jpegs: string[]): Promise<FaceBox[][]> {
  const faces = await detector;
  const out: FaceBox[][] = [];
  for (const b64 of jpegs) {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
    out.push(toBoxes(faces.detect(image), image.width, image.height));
    image.close();
  }
  return out;
}

declare global {
  interface Window {
    clipcatFaces: { ready: Promise<void>; detect: typeof detect };
  }
}

window.clipcatFaces = { ready: detector.then(() => undefined), detect };
