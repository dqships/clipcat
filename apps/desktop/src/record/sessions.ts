// Recordings in progress and how they become sources. The UI records the
// camera, the microphone or (outside macOS 15) the screen with MediaRecorder
// and streams its chunks here; on macOS 15 the screen is recorded by the
// native helper instead. Either way the raw file lands in a temp folder and,
// when the user stops, is remuxed into the Movies folder (video copied, the
// sound mixed into one track if it came as several, so transcription hears
// the voice and the computer together) and that file is imported.

import { randomUUID } from "node:crypto";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { NativeRecording } from "./native";

export type RecordKind = "camera" | "screen" | "voice";

/** The raw file's extension from MediaRecorder's MIME type: MP4 or WebM, with or without video. */
export function rawExtension(mimeType: string): string {
  return /mp4/i.test(mimeType) ? ".mp4" : ".webm";
}

/** Where a raw recording ends up: an extension that holds what it holds. */
export function finalExtension(raw: string, hasVideo: boolean): string {
  if (raw.endsWith(".mov")) return ".mov";
  if (raw.endsWith(".mp4")) return hasVideo ? ".mp4" : ".m4a";
  return hasVideo ? ".mkv" : ".mka";
}

/** A name that sorts by time and says what it is. */
export function recordingName(kind: RecordKind, at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const what = kind === "voice" ? "Voice take" : kind === "screen" ? "Screen recording" : "Camera recording";
  return `${what} ${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} at ${pad(at.getHours())}.${pad(at.getMinutes())}.${pad(at.getSeconds())}`;
}

/** ffmpeg arguments that turn the raw file into the kept one: video copied, sound copied or mixed down. */
export function finishArgs(input: string, audioStreams: number, out: string): string[] {
  const args = ["-hide_banner", "-y", "-i", input, "-map", "0:v?"];
  if (audioStreams > 1) {
    const inputs = Array.from({ length: audioStreams }, (_, i) => `[0:a:${i}]`).join("");
    args.push("-filter_complex", `${inputs}amix=inputs=${audioStreams}:duration=longest:normalize=0[a]`, "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k");
  } else {
    args.push("-map", "0:a?", "-c", "copy");
  }
  if (/\.(mp4|m4a|mov)$/.test(out)) args.push("-movflags", "+faststart");
  args.push(out);
  return args;
}

export type SessionDeps = {
  /** Raw recordings while they're being made. */
  tempDir: string;
  /** Where finished recordings are kept: they are the project's sources, so they must last. */
  outDir: string;
  /** How many audio streams and whether there's video in a file. */
  inspect: (file: string) => Promise<{ audio: number; video: boolean }>;
  ffmpeg: (args: string[]) => Promise<void>;
  now: () => Date;
};

type Session = {
  kind: RecordKind;
  raw: string;
  stream: WriteStream | null;
  native: NativeRecording | null;
};

export class RecordingSessions {
  private sessions = new Map<string, Session>();

  constructor(private readonly deps: SessionDeps) {}

  /** Starts a recording the UI will stream chunks into; the token names it from now on. */
  async begin(kind: RecordKind, mimeType: string): Promise<string> {
    await mkdir(this.deps.tempDir, { recursive: true });
    const token = randomUUID();
    const raw = join(this.deps.tempDir, `${token}${rawExtension(mimeType)}`);
    const stream = createWriteStream(raw);
    await new Promise<void>((resolve, reject) => {
      stream.once("open", () => resolve());
      stream.once("error", reject);
    });
    this.sessions.set(token, { kind, raw, stream, native: null });
    return token;
  }

  /** Starts a native screen recording: `start` gets the raw path to write and returns the running recorder. */
  async beginNative(start: (raw: string) => NativeRecording): Promise<string> {
    await mkdir(this.deps.tempDir, { recursive: true });
    const token = randomUUID();
    const raw = join(this.deps.tempDir, `${token}.mov`);
    const native = start(raw);
    this.sessions.set(token, { kind: "screen", raw, stream: null, native });
    try {
      await native.started;
    } catch (e) {
      this.sessions.delete(token);
      await rm(raw, { force: true });
      throw e;
    }
    return token;
  }

  /** Appends one chunk; chunks are written in the order they arrive. */
  async append(token: string, data: Buffer): Promise<void> {
    const stream = this.get(token).stream;
    if (!stream) throw new Error("This recording takes no chunks");
    if (!stream.write(data)) await new Promise<void>((resolve) => stream.once("drain", () => resolve()));
  }

  /** Stops the recording and keeps it: the path of the finished file. */
  async end(token: string): Promise<string> {
    const session = this.get(token);
    this.sessions.delete(token);
    try {
      if (session.native) await session.native.stop();
      if (session.stream) await new Promise<void>((resolve, reject) => session.stream!.end((e?: Error | null) => (e ? reject(e) : resolve())));
      const { audio, video } = await this.deps.inspect(session.raw);
      if (audio === 0) throw new Error("The recording has no sound, so there's nothing to transcribe. Check the microphone.");
      await mkdir(this.deps.outDir, { recursive: true });
      const out = join(this.deps.outDir, `${recordingName(session.kind, this.deps.now())}${finalExtension(session.raw, video)}`);
      await this.deps.ffmpeg(finishArgs(session.raw, audio, out));
      return out;
    } finally {
      await rm(session.raw, { force: true });
    }
  }

  /** Throws the recording away. */
  async discard(token: string): Promise<void> {
    const session = this.sessions.get(token);
    if (!session) return;
    this.sessions.delete(token);
    session.native?.kill();
    session.stream?.destroy();
    await rm(session.raw, { force: true });
  }

  /** Throws away everything in progress (the app is quitting). */
  async discardAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((t) => this.discard(t)));
  }

  private get(token: string): Session {
    const session = this.sessions.get(token);
    if (!session) throw new Error("That recording isn't running any more");
    return session;
  }
}
