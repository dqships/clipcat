import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

afterEach(() => {
  cleanup();
  delete window.clipcat;
});

const tool = (path: string, version: string | null = "ffmpeg version 6.1.1") => ({ available: version !== null, version, path });
const info = (over: object = {}) => ({
  name: "ClipCat",
  version: "0.1.0",
  platform: "darwin",
  arch: "arm64",
  ffmpeg: tool("/x/ffmpeg"),
  whisper: tool("/x/whisper-cli", "whisper"),
  ...over,
});

const project = {
  version: 1,
  id: "p1",
  name: "talk",
  language: "en",
  aspectRatio: "16:9",
  speed: 1,
  revision: 3,
  brief: "",
  suggestedTitle: "",
  sources: [
    {
      id: "s1",
      name: "talk.mp4",
      path: "/v/talk.mp4",
      order: 0,
      media: { duration: 75, width: 1920, height: 1080, fps: 30, vfr: false, videoCodec: "h264", audioCodec: "aac" },
      frameX: 0.5,
      prep: { proxy: "media/s1/proxy.mp4", wav: "media/s1/audio.wav", waveform: "media/s1/waveform.png", thumbs: "media/s1/thumb-%04d.jpg" },
      transcription: { backend: "whisper.cpp", model: "base" },
      silenceRanges: [],
    },
  ],
  transcript: [
    { id: "s1-0", sourceId: "s1", text: "Hello", start: 0.5, end: 0.9 },
    { id: "s1-1", sourceId: "s1", text: "again.", start: 3, end: 3.5 },
  ],
  segments: [],
  proposals: [
    { id: "x1", type: "silence", sourceId: "s1", cuts: [[1, 2.5]], wordIds: [], keepWordIds: [], reason: "", confidence: 1, status: "pending" },
  ],
  captions: {},
  createdAt: "",
  updatedAt: "",
};

/** A stand-in for the preload bridge: canned answers per method, and a way to push events. */
function fakeBridge(answers: Record<string, unknown>) {
  const listeners = new Map<string, Set<(p: unknown) => void>>();
  const invoke = vi.fn(async (method: string, _input?: unknown) => {
    const answer = answers[method];
    return typeof answer === "function" ? (answer as (i: unknown) => unknown)(_input) : answer;
  });
  window.clipcat = {
    invoke,
    on: (event: string, listener: (p: unknown) => void) => {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
      return () => set.delete(listener);
    },
    pathForFile: (f: File) => `/dropped/${f.name}`,
  } as never;
  const emit = (event: string, payload: unknown) => act(() => listeners.get(event)?.forEach((l) => l(payload)));
  return { invoke, emit };
}

const summary = { id: "p1", name: "talk", updatedAt: "", duration: 75, sources: 1, thumb: "media/s1/thumb-0001.jpg" };

describe("App", () => {
  it("shows the empty library with one h1", () => {
    render(<App />);
    expect(screen.getByRole("heading", { level: 2, name: "No videos yet" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("shows the ffmpeg version from the main process", async () => {
    const { invoke } = fakeBridge({ "app:info": info(), "library:list": [] });
    render(<App />);
    expect(await screen.findByText("ffmpeg version 6.1.1")).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("app:ready", { screen: "library" });
  });

  it("says which tool is missing and where it was expected", async () => {
    fakeBridge({ "app:info": info({ whisper: tool("C:\\ClipCat\\whisper-cli.exe", null) }), "library:list": [] });
    render(<App />);
    expect(await screen.findByText(/whisper-cli not found at C:\\ClipCat\\whisper-cli.exe/)).toBeTruthy();
  });

  it("imports picked files and lists the new project", async () => {
    let list: unknown[] = [];
    const { invoke } = fakeBridge({
      "app:info": info(),
      "library:list": () => list,
      "files:pick": ["/v/talk.mp4"],
      "project:import": () => {
        list = [summary];
        return project;
      },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Add videos" }));
    expect(await screen.findByRole("button", { name: "talk" })).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("project:import", { projectId: null, files: ["/v/talk.mp4"] });
    expect(screen.getByText("1:15 · 1 video")).toBeTruthy();
  });

  it("imports dropped files", async () => {
    const { invoke } = fakeBridge({ "app:info": info(), "library:list": [], "project:import": project });
    render(<App />);
    const main = await screen.findByRole("main");
    fireEvent.drop(main, { dataTransfer: { files: [new File(["x"], "a.mov")] } });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("project:import", { projectId: null, files: ["/dropped/a.mov"] }));
  });

  it("shows job progress and failures on the card", async () => {
    const { emit } = fakeBridge({ "app:info": info(), "library:list": [summary] });
    render(<App />);
    await screen.findByRole("button", { name: "talk" });
    const job = { projectId: "p1", jobId: "j1", kind: "transcribe", label: "Transcribing talk.mp4", state: "running", fraction: 0.4 };
    emit("job", job);
    expect(screen.getByRole("progressbar", { name: "Transcribing talk.mp4" }).getAttribute("value")).toBe("40");
    emit("job", { ...job, state: "failed", fraction: null, error: "whisper-cli exited with 1" });
    expect(screen.getByText(/Transcribing talk.mp4 failed: whisper-cli exited with 1/)).toBeTruthy();
  });

  it("opens a project with its transcript and pauses", async () => {
    fakeBridge({ "app:info": info(), "library:list": [summary], "project:get": project, "ai:status": { claude: { status: "ready", version: null, detail: null } } });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "talk" }));
    expect(await screen.findByRole("heading", { level: 1, name: "talk" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "again." })).toBeTruthy();
    expect(screen.getByText("1 pause found, 0:02 to cut.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to library" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Library" })).toBeTruthy();
  });

  it("asks Claude for cuts with the brief and lists what came back", async () => {
    const ready = { claude: { status: "ready", version: "2.1.0", detail: null } };
    const { invoke } = fakeBridge({ "app:info": info(), "library:list": [summary], "project:get": project, "ai:status": ready, "project:analyze": undefined });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "talk" }));
    const find = await screen.findByRole("button", { name: "Find cuts" });
    await vi.waitFor(() => expect((find as HTMLButtonElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("Brief (optional)"), { target: { value: "Keep it short" } });
    fireEvent.click(find);
    expect(invoke).toHaveBeenCalledWith("project:analyze", { id: "p1", brief: "Keep it short" });
  });

  it("shows proposed cuts struck through in the transcript", async () => {
    const cut = { id: "a1", type: "cleanup", sourceId: "s1", cuts: [[0.5, 0.9]], wordIds: ["s1-0"], keepWordIds: [], reason: "Filler", confidence: 0.8, status: "pending" };
    const ready = { claude: { status: "ready", version: "2.1.0", detail: null } };
    fakeBridge({
      "app:info": info(),
      "library:list": [summary],
      "project:get": { ...project, proposals: [...project.proposals, cut], suggestedTitle: "Hello again" },
      "ai:status": ready,
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "talk" }));
    expect(await screen.findByText("Filler")).toBeTruthy();
    expect(screen.getByText("1 cut proposed, 0:00 in all.")).toBeTruthy();
    expect(screen.getByText("Suggested title: Hello again")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hello" }).className).toContain("word--proposed");
    expect(screen.getByRole("button", { name: "Find cuts again" })).toBeTruthy();
  });

  it("says when Claude Code isn't installed", async () => {
    const missing = { claude: { status: "not-installed", version: null, detail: "Install Claude Code, then reopen ClipCat." } };
    fakeBridge({ "app:info": info(), "library:list": [summary], "project:get": project, "ai:status": missing });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "talk" }));
    expect(await screen.findByText(/Install Claude Code, then reopen ClipCat/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Find cuts" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("asks before deleting a project", async () => {
    const { invoke } = fakeBridge({ "app:info": info(), "library:list": [summary], "project:remove": undefined });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete talk" }));
    expect(invoke).not.toHaveBeenCalledWith("project:remove", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("project:remove", { id: "p1" }));
  });
});
