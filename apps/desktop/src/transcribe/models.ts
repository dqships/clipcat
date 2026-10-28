// Whisper models, downloaded once into the app's data folder on first use.
// Hugging Face serves them over HTTPS; we check the size the server announced
// and the ggml magic number before a download replaces anything.

import { createWriteStream } from "node:fs";
import { mkdir, open, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export type ModelId = "large-v3-turbo-q5_0" | "base";

export const MODELS: Record<ModelId, { file: string; label: string; approxMB: number }> = {
  "large-v3-turbo-q5_0": { file: "ggml-large-v3-turbo-q5_0.bin", label: "Large v3 Turbo (best, 550 MB)", approxMB: 550 },
  base: { file: "ggml-base.bin", label: "Base (fast, 150 MB)", approxMB: 150 },
};

const BASE_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";
const GGML_MAGICS = new Set([0x67676d6c, 0x6c6d6767]); // "ggml" either byte order

export const modelPath = (dir: string, id: ModelId): string => join(dir, MODELS[id].file);

export async function hasModel(dir: string, id: ModelId): Promise<boolean> {
  try {
    return (await stat(modelPath(dir, id))).size > 1_000_000;
  } catch {
    return false;
  }
}

async function looksLikeGgml(path: string): Promise<boolean> {
  const fh = await open(path, "r");
  try {
    const buf = Buffer.alloc(4);
    await fh.read(buf, 0, 4, 0);
    return GGML_MAGICS.has(buf.readUInt32LE(0));
  } finally {
    await fh.close();
  }
}

export async function downloadModel(
  dir: string,
  id: ModelId,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const target = modelPath(dir, id);
  const part = `${target}.part`;
  const response = await fetch(`${BASE_URL}/${MODELS[id].file}`, { signal });
  if (!response.ok || !response.body) throw new Error(`Couldn't download the speech model (HTTP ${response.status}). Check your internet connection and try again.`);
  const total = Number(response.headers.get("content-length") ?? 0);
  let received = 0;
  const body = Readable.fromWeb(response.body as never);
  body.on("data", (chunk: Buffer) => {
    received += chunk.length;
    if (total) onProgress(received / total);
  });
  try {
    await pipeline(body, createWriteStream(part), { signal });
    if (total && received !== total) throw new Error(`The speech model download stopped partway (${received} of ${total} bytes). Try again.`);
    if (!(await looksLikeGgml(part))) throw new Error("The downloaded speech model is damaged. Try again.");
    await rename(part, target);
    return target;
  } catch (e) {
    await unlink(part).catch(() => {});
    throw e;
  }
}
