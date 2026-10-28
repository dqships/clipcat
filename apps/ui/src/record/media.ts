// The browser side of recording: which format MediaRecorder writes, how the
// microphone and the computer's sound become one track (Chromium records only
// the first audio track it's given), and how chunks travel to the main process.

import type { RecordKindValue } from "@clipcat/ipc";

/**
 * The best format this Chromium records: H.264 and AAC in MP4 where it can
 * (hardware encoded on a Mac, and what editors expect), WebM otherwise.
 */
export function pickMimeType(kind: RecordKindValue, supported: (type: string) => boolean): string {
  const video = ["video/mp4;codecs=avc1,mp4a.40.2", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  const audio = ["audio/mp4;codecs=mp4a.40.2", "audio/webm;codecs=opus", "audio/webm"];
  return (kind === "voice" ? audio : video).find(supported) ?? "";
}

/** Bit rates high enough that a recording is a good source, not just a preview. */
export const BITRATES: Record<RecordKindValue, { video: number; audio: number }> = {
  camera: { video: 8_000_000, audio: 192_000 },
  screen: { video: 12_000_000, audio: 192_000 },
  voice: { video: 0, audio: 192_000 },
};

/** A chunk as base64, the way IPC carries it. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read the recording"));
    reader.readAsDataURL(blob);
  });
}

/** Mixes several streams' sound into one track. Close the returned context when done. */
export function mixAudio(streams: MediaStream[]): { track: MediaStreamTrack; context: AudioContext } {
  const context = new AudioContext();
  const out = context.createMediaStreamDestination();
  for (const stream of streams) {
    if (stream.getAudioTracks().length > 0) context.createMediaStreamSource(stream).connect(out);
  }
  return { track: out.stream.getAudioTracks()[0]!, context };
}

/** Calls `onLevel` about every frame with how loud the stream is, 0 to 1. Returns a stop function. */
export function watchLevel(stream: MediaStream, onLevel: (level: number) => void): () => void {
  if (stream.getAudioTracks().length === 0 || typeof AudioContext === "undefined") return () => {};
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  context.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  let frame = 0;
  const tick = () => {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const s of samples) sum += s * s;
    // RMS on a rough dB scale: -60 dB is silent, 0 dB is full.
    const db = 20 * Math.log10(Math.sqrt(sum / samples.length) || 1e-6);
    onLevel(Math.min(1, Math.max(0, (db + 60) / 60)));
    frame = requestAnimationFrame(tick);
  };
  tick();
  return () => {
    cancelAnimationFrame(frame);
    void context.close();
  };
}

/** "1:05" from seconds; hours when it gets there. */
export function clock(seconds: number): string {
  const s = Math.floor(seconds);
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}
