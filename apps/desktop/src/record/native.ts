// The macOS screen recorder: runs `clipcat-recorder record` (native/recorder,
// ScreenCaptureKit) and stops it by writing "stop" to its stdin. It writes
// the movie itself, screen, microphone and, if asked, the computer's sound.

import { spawn } from "node:child_process";

export type NativeOptions = {
  /** The CGDirectDisplayID to record (Electron's desktopCapturer gives it as display_id). */
  displayId: string;
  out: string;
  mic: boolean;
  /** The microphone's name as the UI lists it; the system default when null. */
  micName: string | null;
  systemAudio: boolean;
  /** ClipCat's own process, so its windows stay out of the recording. */
  excludePid: number;
};

export type NativeRecording = {
  /** Resolves once frames are being written; rejects if the recorder couldn't start. */
  started: Promise<void>;
  /** Finishes the file and resolves when it's complete. */
  stop: () => Promise<void>;
  /** Stops without caring about the file. */
  kill: () => void;
};

export function nativeArgs(o: NativeOptions): string[] {
  return [
    "record",
    "--display",
    o.displayId,
    "--out",
    o.out,
    "--exclude-pid",
    String(o.excludePid),
    ...(o.mic ? ["--mic"] : []),
    ...(o.mic && o.micName ? ["--mic-name", o.micName] : []),
    ...(o.systemAudio ? ["--system-audio"] : []),
  ];
}

export function startNative(binary: string, o: NativeOptions): NativeRecording {
  const child = spawn(binary, nativeArgs(o), { stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (d: string) => (stderr = (stderr + d).slice(-2000)));
  const exited = new Promise<number | null>((resolve) => {
    child.on("close", (code) => resolve(code));
    child.on("error", (e) => {
      stderr ||= e.message;
      resolve(-1);
    });
  });
  const why = () => stderr.trim().split("\n").at(-1)?.replace(/^clipcat-recorder: /, "") || "the screen recorder stopped";
  const started = new Promise<void>((resolve, reject) => {
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => {
      out += d;
      if (/^started$/m.test(out)) resolve();
    });
    void exited.then(() => reject(new Error(why())));
  });
  started.catch(() => {});
  return {
    started,
    stop: async () => {
      child.stdin.end("stop\n");
      const code = await exited;
      if (code !== 0) throw new Error(why());
    },
    kill: () => {
      child.stdin.destroy();
      child.kill();
    },
  };
}
