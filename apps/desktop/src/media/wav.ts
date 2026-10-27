// Reads the 16 kHz mono PCM WAV the prep pass writes, as floats in -1..1.

import { readFile } from "node:fs/promises";

export type Pcm = { sampleRate: number; samples: Float32Array };

export function parseWav(buf: Buffer): Pcm {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("Not a WAV file");
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bits = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    let size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      if (buf.readUInt16LE(body) !== 1) throw new Error("Only PCM WAV is supported");
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    } else if (id === "data") {
      if (bits !== 16 || channels < 1) throw new Error(`Expected 16-bit PCM, got ${bits}-bit with ${channels} channels`);
      // ffmpeg writes 0xFFFFFFFF as the data size when it streams; trust the file length then.
      if (size === 0xffffffff || body + size > buf.length) size = buf.length - body;
      const frames = Math.floor(size / (2 * channels));
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) samples[i] = buf.readInt16LE(body + i * 2 * channels) / 32768;
      return { sampleRate, samples };
    }
    offset = body + size + (size % 2);
  }
  throw new Error("WAV file has no data chunk");
}

export async function readWav(path: string): Promise<Pcm> {
  return parseWav(await readFile(path));
}

/** A WAV file holding `samples` (tests and fixtures). */
export function encodeWav(samples: Float32Array, sampleRate: number): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s * 32767))), i * 2));
  const head = Buffer.alloc(44);
  head.write("RIFF", 0, "ascii");
  head.writeUInt32LE(36 + data.length, 4);
  head.write("WAVE", 8, "ascii");
  head.write("fmt ", 12, "ascii");
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(sampleRate, 24);
  head.writeUInt32LE(sampleRate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36, "ascii");
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}
