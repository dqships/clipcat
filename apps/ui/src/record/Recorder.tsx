import type { RecordKindValue, RecordSetupValue } from "@clipcat/ipc";
import { ArrowLeft, Camera, Circle, Mic, Monitor, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { bridge } from "../bridge";
import { ICON_STROKE } from "../icons";
import { BITRATES, blobToBase64, clock, mixAudio, pickMimeType, watchLevel } from "./media";

type Props = {
  /** The project the take goes into; a new project when null. */
  projectId: string | null;
  projectName: string | null;
  onBack: () => void;
  onDone: (projectId: string) => void;
};

type Phase = { name: "ready" } | { name: "starting" } | { name: "recording"; since: number } | { name: "saving" };
type Blocked = "camera" | "microphone" | "screen";

/** A recording in progress: its token, the recorder writing it (none for the macOS screen recorder) and the chunks still being sent. */
type Running = { token: string; recorder: MediaRecorder | null; chain: Promise<void>; failed: unknown; cleanup: () => void };

const MODES = [
  { id: "camera", label: "Camera", icon: Camera },
  { id: "screen", label: "Screen", icon: Monitor },
  { id: "voice", label: "Voice", icon: Mic },
] as const;

const BLOCKED_TEXT: Record<Blocked, string> = {
  camera: "ClipCat isn't allowed to use the camera.",
  microphone: "ClipCat isn't allowed to use the microphone.",
  screen: "ClipCat isn't allowed to record the screen.",
};

const message = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e));

/** Devices the system lists, without the "default" and "communications" aliases Chromium adds. */
const realDevices = (devices: MediaDeviceInfo[], kind: MediaDeviceKind) =>
  devices.filter((d) => d.kind === kind && d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications");

/**
 * Recording straight into ClipCat: the camera, a screen or just the voice,
 * always with the microphone. A take is saved to the Movies folder when it's
 * stopped and imported, so it is transcribed and cut like any other video.
 */
export function Recorder({ projectId, projectName, onBack, onDone }: Props) {
  const [mode, setMode] = useState<RecordKindValue>("camera");
  const [cameraId, setCameraId] = useState("");
  const [micId, setMicId] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [setup, setSetup] = useState<RecordSetupValue | null>(null);
  const [screenId, setScreenId] = useState<string | null>(null);
  const [systemAudio, setSystemAudio] = useState(false);
  const [live, setLive] = useState<MediaStream | null>(null);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: "ready" });
  const [now, setNow] = useState(() => Date.now());
  const running = useRef<Running | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const meter = useRef<HTMLDivElement>(null);

  // The live preview: the camera and microphone, or the microphone alone. It is also what camera and voice takes record.
  useEffect(() => {
    const api = bridge();
    if (!api || !navigator.mediaDevices?.getUserMedia) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let stopLevel = () => {};
    const wantCamera = mode === "camera";
    void (async () => {
      setBlocked(null);
      if (!(await api.invoke("record:access", { kind: "microphone" }))) return !cancelled && setBlocked("microphone");
      if (wantCamera && !(await api.invoke("record:access", { kind: "camera" }))) return !cancelled && setBlocked("camera");
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: micId ? { deviceId: { exact: micId } } : true,
          video: wantCamera
            ? { ...(cameraId ? { deviceId: { exact: cameraId } } : {}), width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }
            : false,
        });
      } catch (e) {
        if (cancelled) return;
        if (e instanceof DOMException && e.name === "NotAllowedError") return setBlocked(wantCamera ? "camera" : "microphone");
        return setError(e instanceof DOMException && e.name === "NotFoundError" ? `No ${wantCamera ? "camera or " : ""}microphone found.` : message(e));
      }
      if (cancelled) return stream.getTracks().forEach((t) => t.stop());
      setLive(stream);
      stopLevel = watchLevel(stream, (level) => meter.current?.style.setProperty("--level", level.toFixed(3)));
      // Labels are only listed once access is granted, so this comes after the stream.
      const listed = await navigator.mediaDevices.enumerateDevices();
      if (!cancelled) setDevices(listed);
    })();
    return () => {
      cancelled = true;
      stopLevel();
      stream?.getTracks().forEach((t) => t.stop());
      setLive(null);
    };
  }, [mode, cameraId, micId]);

  useEffect(() => {
    if (video.current) video.current.srcObject = live && live.getVideoTracks().length > 0 ? live : null;
  }, [live]);

  // Listing screens can make macOS ask for screen recording access, so it waits until the screen is wanted.
  useEffect(() => {
    if (mode !== "screen" || setup) return;
    bridge()
      ?.invoke("record:setup")
      .then((s) => {
        setSetup(s);
        setScreenId((id) => id ?? s.screens[0]?.id ?? null);
      }, (e: unknown) => setError(message(e)));
  }, [mode, setup]);

  useEffect(() => {
    if (phase.name !== "recording") return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [phase.name]);

  // Leaving the screen mid-take throws the take away.
  useEffect(
    () => () => {
      const run = running.current;
      running.current = null;
      if (!run) return;
      if (run.recorder && run.recorder.state !== "inactive") run.recorder.stop();
      run.cleanup();
      void bridge()?.invoke("record:discard", { token: run.token });
    },
    [],
  );

  const screen = setup?.screens.find((s) => s.id === screenId) ?? null;
  const mics = realDevices(devices, "audioinput");
  const cameras = realDevices(devices, "videoinput");
  const micLabel = mics.find((d) => d.deviceId === micId)?.label ?? null;
  const screenBlocked = mode === "screen" && setup !== null && (setup.screenAccess === "denied" || setup.screens.length === 0);
  const shown: Blocked | null = blocked ?? (screenBlocked ? "screen" : null);
  const canRecord = phase.name === "ready" && live !== null && shown === null && (mode !== "screen" || screen !== null);
  const busy = phase.name !== "ready";

  const stop = async () => {
    const api = bridge();
    const run = running.current;
    if (!api || !run) return;
    running.current = null;
    setPhase({ name: "saving" });
    try {
      const recorder = run.recorder;
      if (recorder && recorder.state !== "inactive") {
        await new Promise<void>((resolve) => {
          recorder.onstop = () => resolve();
          recorder.stop();
        });
      }
      // The last chunk arrives before onstop, so it is already in the chain.
      await run.chain;
      run.cleanup();
      if (run.failed) throw run.failed;
      const project = await api.invoke("record:end", { token: run.token, projectId });
      onDone(project.id);
    } catch (e) {
      run.cleanup();
      void api.invoke("record:discard", { token: run.token }).catch(() => {});
      setError(message(e));
      setPhase({ name: "ready" });
    }
  };

  const start = async () => {
    const api = bridge();
    if (!api || !live) return;
    setError(null);
    setPhase({ name: "starting" });
    let cleanup = () => {};
    try {
      if (mode === "screen" && setup?.native && screen) {
        const { token } = await api.invoke("record:native", { displayId: screen.displayId, mic: true, micName: micLabel, systemAudio });
        running.current = { token, recorder: null, chain: Promise.resolve(), failed: null, cleanup };
      } else {
        let stream = live;
        if (mode === "screen" && screen) {
          await api.invoke("record:pick-screen", { screenId: screen.id, systemAudio });
          const display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: systemAudio });
          const mixed = mixAudio([live, display]);
          stream = new MediaStream([...display.getVideoTracks(), mixed.track]);
          cleanup = () => {
            display.getTracks().forEach((t) => t.stop());
            void mixed.context.close();
          };
          // The screen can go away (a display unplugged): keep what was recorded.
          display.getVideoTracks()[0]?.addEventListener("ended", () => void stop());
        }
        const mimeType = pickMimeType(mode, (type) => MediaRecorder.isTypeSupported(type));
        const { token } = await api.invoke("record:begin", { kind: mode, mimeType });
        const recorder = new MediaRecorder(stream, {
          ...(mimeType ? { mimeType } : {}),
          ...(BITRATES[mode].video ? { videoBitsPerSecond: BITRATES[mode].video } : {}),
          audioBitsPerSecond: BITRATES[mode].audio,
        });
        const run: Running = { token, recorder, chain: Promise.resolve(), failed: null, cleanup };
        recorder.ondataavailable = (event) => {
          if (event.data.size === 0) return;
          run.chain = run.chain.then(async () => {
            if (run.failed) return;
            try {
              await api.invoke("record:chunk", { token, data: await blobToBase64(event.data) });
            } catch (e) {
              run.failed = e;
              if (running.current === run) void stop();
            }
          });
        };
        running.current = run;
        recorder.start(1000);
      }
      setNow(Date.now());
      setPhase({ name: "recording", since: Date.now() });
    } catch (e) {
      cleanup();
      setError(message(e));
      setPhase({ name: "ready" });
    }
  };

  const cancel = async () => {
    const run = running.current;
    running.current = null;
    if (run) {
      if (run.recorder && run.recorder.state !== "inactive") run.recorder.stop();
      run.cleanup();
      await bridge()
        ?.invoke("record:discard", { token: run.token })
        .catch(() => {});
    }
    onBack();
  };

  return (
    <>
      <header className="titlebar">
        <button type="button" className="button button--icon" aria-label={projectId ? "Back to project" : "Back to library"} onClick={cancel}>
          <ArrowLeft className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
        </button>
        <h1 className="titlebar__title">{projectName ? `Record into ${projectName}` : "Record"}</h1>
      </header>
      <main className="recorder">
        <div className="recorder__modes" role="tablist" aria-label="What to record">
          {MODES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={mode === id}
              className={mode === id ? "recorder__mode recorder__mode--on" : "recorder__mode"}
              disabled={busy}
              onClick={() => setMode(id)}
            >
              <Icon className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
              {label}
            </button>
          ))}
        </div>

        <div className="recorder__stage">
          {mode === "camera" && <video ref={video} className="recorder__video" autoPlay muted playsInline aria-label="Camera preview" />}
          {mode === "voice" && (
            <div className="recorder__voice">
              <Mic className="recorder__voice-icon" strokeWidth={ICON_STROKE} aria-hidden />
            </div>
          )}
          {mode === "screen" && (
            <div className="recorder__screens" role="radiogroup" aria-label="Screen">
              {(setup?.screens ?? []).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={s.id === screenId}
                  className={s.id === screenId ? "recorder__screen recorder__screen--on" : "recorder__screen"}
                  disabled={busy}
                  onClick={() => setScreenId(s.id)}
                >
                  <img src={s.thumbnail} alt="" />
                  <span>{s.name}</span>
                </button>
              ))}
            </div>
          )}
          {phase.name === "recording" && (
            <span className="recorder__live" role="timer" aria-label="Recording time">
              <span className="recorder__dot" aria-hidden />
              {clock((now - phase.since) / 1000)}
            </span>
          )}
        </div>

        <div className="recorder__level" aria-hidden>
          <div ref={meter} className="recorder__level-bar" />
        </div>

        {shown && (
          <div className="notice notice--danger recorder__blocked" role="alert">
            <span>
              {BLOCKED_TEXT[shown]} Allow it in your system's privacy settings{shown === "screen" ? ", then reopen ClipCat" : ""}.
            </span>
            <button type="button" className="button" onClick={() => void bridge()?.invoke("record:privacy", { kind: shown })}>
              Open privacy settings
            </button>
          </div>
        )}
        {error && (
          <p className="notice notice--danger" role="alert">
            {error}
          </p>
        )}

        <div className="fields recorder__fields">
          {mode === "camera" && (
            <label className="field">
              <span className="field__label">Camera</span>
              <select className="field__control" value={cameraId} disabled={busy} onChange={(e) => setCameraId(e.target.value)}>
                <option value="">Default camera</option>
                {cameras.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || "Camera"}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            <span className="field__label">Microphone</span>
            <select className="field__control" value={micId} disabled={busy} onChange={(e) => setMicId(e.target.value)}>
              <option value="">Default microphone</option>
              {mics.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || "Microphone"}
                </option>
              ))}
            </select>
          </label>
          {mode === "screen" && setup?.systemAudio && (
            <label className="field field--inline">
              <input type="checkbox" checked={systemAudio} disabled={busy} onChange={(e) => setSystemAudio(e.target.checked)} />
              Also record the computer's sound
            </label>
          )}
        </div>

        <div className="recorder__actions">
          {phase.name === "recording" ? (
            <button type="button" className="button button--accent" onClick={() => void stop()}>
              <Square className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
              Stop
            </button>
          ) : (
            <button type="button" className="button button--accent" disabled={!canRecord} onClick={() => void start()}>
              <Circle className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
              {phase.name === "saving" ? "Saving…" : phase.name === "starting" ? "Starting…" : "Record"}
            </button>
          )}
          <button type="button" className="button" disabled={phase.name === "saving"} onClick={() => void cancel()}>
            <X className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
            Cancel
          </button>
        </div>
        <p className="recorder__note">
          {mode === "screen" ? "ClipCat's own window stays out of the recording. " : ""}
          Takes are kept in the ClipCat folder in your Movies (Videos on Windows) and open in {projectName ?? "a new project"} when you stop.
        </p>
      </main>
    </>
  );
}
