import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

afterEach(() => {
  cleanup();
  delete window.clipcat;
  localStorage.clear();
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
  assets: [],
  transcript: [
    { id: "s1-0", sourceId: "s1", text: "Hello", start: 0.5, end: 0.9 },
    { id: "s1-1", sourceId: "s1", text: "again.", start: 3, end: 3.5 },
  ],
  segments: [{ id: "g1", sourceId: "s1", sourceStart: 0, sourceEnd: 75, included: true }],
  history: { past: [], future: [] },
  lastExport: null,
  origin: null,
  shorts: [],
  proposals: [
    { id: "x1", type: "silence", sourceId: "s1", cuts: [[1, 2.5]], wordIds: [], keepWordIds: [], reason: "", confidence: 1, status: "pending" },
  ],
  captions: { enabled: true, mode: "sentence", font: "Jost", size: 54, color: "#FFFFFF", effect: "shadow", case: "regular", background: "none", boxColor: "#000000", position: 0.82 },
  createdAt: "",
  updatedAt: "",
};

/** A stand-in for the preload bridge: canned answers per method, and a way to push events. */
/** The model lists an `ai:status` carries: Claude Code's aliases, and what Codex offers. */
const models = {
  claude: { choices: [{ id: "opus", label: "Opus (newest)" }], fallback: null, selected: null },
  codex: { choices: [{ id: "gpt-6.1-sol", label: "GPT-6.1-Sol" }], fallback: "gpt-6.1-sol", selected: null },
};

function fakeBridge(given: Record<string, unknown>) {
  const answers: Record<string, unknown> = { "settings:get": { agent: "claude", dictionary: ["ClipCat"] }, ...given };
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

/** Shows a tab of the tools panel. */
const openTab = async (name: string) => fireEvent.click(await screen.findByRole("tab", { name: new RegExp(`^${name}`) }));

const summary = { id: "p1", name: "talk", updatedAt: "", duration: 75, sources: 1, thumb: "media/s1/thumb-0001.jpg" };

describe("App", () => {
  it("shows the empty library with one h1", () => {
    render(<App />);
    expect(screen.getByRole("heading", { level: 2, name: "No projects yet" })).toBeTruthy();
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
    fakeBridge({ "app:info": info(), "library:list": [summary], "project:get": project, "ai:status": { claude: { status: "ready", version: null, detail: null }, codex: { status: "not-installed", version: null, detail: "Install the Codex CLI, then reopen ClipCat." }, api: { hasKey: false, model: "claude-opus-5-5" }, agent: "claude", models } });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "talk" }));
    expect(await screen.findByRole("heading", { level: 1, name: "talk" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "again." })).toBeTruthy();
    expect(screen.getByText("1 cut to review, 0:02 in all.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to library" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Library" })).toBeTruthy();
  });

  it("docks the transcript and the tools anywhere, splits a shared dock and remembers it", async () => {
    fakeBridge({ "app:info": info(), "library:list": [summary], "project:get": project, "ai:status": { claude: { status: "ready", version: null, detail: null }, codex: { status: "not-installed", version: null, detail: null }, api: { hasKey: false, model: "claude-opus-5-5" }, agent: "claude", models } });
    const view = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "talk" }));
    await screen.findByRole("button", { name: "again." });
    const dockOf = (title: string) => screen.getByRole("region", { name: title }).parentElement?.className;
    expect(dockOf("Transcript")).toBe("dock dock--right");
    expect(dockOf("Tools")).toBe("dock dock--bottom");
    expect(screen.getByRole("button", { name: "Transcript on the right" }).getAttribute("aria-pressed")).toBe("true");

    // Both on the left: one dock, transcript on top, a hairline to split it.
    fireEvent.click(screen.getByRole("button", { name: "Transcript on the left" }));
    fireEvent.click(screen.getByRole("button", { name: "Tools on the left" }));
    expect(dockOf("Transcript")).toBe("dock dock--left");
    expect(dockOf("Tools")).toBe("dock dock--left");
    const split = screen.getByRole("separator", { name: "Resize the left split" });
    expect(split.getAttribute("aria-orientation")).toBe("horizontal");
    fireEvent.keyDown(split, { key: "ArrowDown" });
    expect(split.getAttribute("aria-valuenow")).toBe("52");
    expect(screen.queryByRole("separator", { name: "Resize the right panel" })).toBeNull();
    const width = screen.getByRole("separator", { name: "Resize the left panel" });
    fireEvent.keyDown(width, { key: "End" });
    expect(width.getAttribute("aria-valuenow")).toBe("65");

    // The preview is still the one it was, and the layout comes back next time.
    expect(screen.getByRole("region", { name: "Preview" })).toBeTruthy();
    view.unmount();
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "talk" }));
    await screen.findByRole("button", { name: "again." });
    expect(dockOf("Transcript")).toBe("dock dock--left");
    expect(dockOf("Tools")).toBe("dock dock--left");
    expect(screen.getByRole("separator", { name: "Resize the left split" }).getAttribute("aria-valuenow")).toBe("52");
    expect(screen.getByRole("separator", { name: "Resize the left panel" }).getAttribute("aria-valuenow")).toBe("65");
  });

  it("asks Claude for cuts with the brief and lists what came back", async () => {
    const ready = { claude: { status: "ready", version: "2.1.0", detail: null }, codex: { status: "ready", version: "0.165.0", detail: null }, api: { hasKey: false, model: "claude-opus-5-5" }, agent: "claude", models };
    const { invoke } = fakeBridge({ "app:info": info(), "library:list": [summary], "project:get": project, "ai:status": ready, "project:analyze": undefined });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "talk" }));
    const find = await screen.findByRole("button", { name: "Suggest an edit" });
    await vi.waitFor(() => expect((find as HTMLButtonElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("What should the edit do? (optional)"), { target: { value: "Keep it short" } });
    fireEvent.click(find);
    expect(invoke).toHaveBeenCalledWith("project:analyze", { id: "p1", brief: "Keep it short" });
  });

  it("shows proposed cuts struck through in the transcript", async () => {
    const cut = { id: "a1", type: "cleanup", sourceId: "s1", cuts: [[0.5, 0.9]], wordIds: ["s1-0"], keepWordIds: [], reason: "Filler", confidence: 0.8, status: "pending" };
    const ready = { claude: { status: "ready", version: "2.1.0", detail: null }, codex: { status: "ready", version: "0.165.0", detail: null }, api: { hasKey: false, model: "claude-opus-5-5" }, agent: "claude", models };
    fakeBridge({
      "app:info": info(),
      "library:list": [summary],
      "project:get": { ...project, proposals: [...project.proposals, cut], suggestedTitle: "Hello again" },
      "ai:status": ready,
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "talk" }));
    expect(await screen.findByText("Filler")).toBeTruthy();
    expect(screen.getByText("2 cuts to review, 0:02 in all.")).toBeTruthy();
    expect(screen.getByText("Suggested title: Hello again")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hello" }).className).toContain("word--proposed");
    expect(screen.getByRole("button", { name: "Suggest again" })).toBeTruthy();
  });

  it("cuts the selected words and restores them", async () => {
    const ready = { claude: { status: "ready", version: "2.1.0", detail: null }, codex: { status: "ready", version: "0.165.0", detail: null }, api: { hasKey: false, model: "claude-opus-5-5" }, agent: "claude", models };
    const cut = { ...project, revision: 4, segments: [{ ...project.segments[0], sourceEnd: 1.95 }, { id: "g2", sourceId: "s1", sourceStart: 1.95, sourceEnd: 75, included: false }] };
    const { invoke } = fakeBridge({ "app:info": info(), "library:list": [summary], "project:get": project, "ai:status": ready, "project:edit": cut });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "talk" }));
    fireEvent.click(await screen.findByRole("button", { name: "Hello" }));
    fireEvent.click(screen.getByRole("button", { name: "again." }), { shiftKey: true });
    expect(screen.getByText("2 words selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "again." }));
    fireEvent.keyDown(screen.getByRole("button", { name: "again." }), { key: "Delete" });
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("project:edit", { id: "p1", revision: 3, op: { type: "words", wordIds: ["s1-1"], included: false } }),
    );
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "again." }).className).toContain("word--cut"));
    expect(screen.getByRole("button", { name: "Restore" })).toBeTruthy();
  });

  it("hides cut words and shows them again, and remembers the choice", async () => {
    const ready = { claude: { status: "ready", version: "2.1.0", detail: null }, codex: { status: "ready", version: "0.165.0", detail: null }, api: { hasKey: false, model: "claude-opus-5-5" }, agent: "claude", models };
    const cut = { ...project, segments: [{ ...project.segments[0], sourceEnd: 1.95 }, { id: "g2", sourceId: "s1", sourceStart: 1.95, sourceEnd: 75, included: false }] };
    fakeBridge({ "app:info": info(), "library:list": [summary], "project:get": cut, "ai:status": ready });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "talk" }));
    expect((await screen.findByRole("button", { name: "again." })).className).toContain("word--cut");
    const toggle = screen.getByRole("button", { name: "Hide cuts" });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("button", { name: "again." })).toBeNull();
    expect(screen.getByRole("button", { name: "Hello" })).toBeTruthy();
    expect(localStorage.getItem("clipcat.hideCuts")).toBe("1");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "again." }).className).toContain("word--cut");
  });

  it("accepts a suggested cut and undoes with the keyboard", async () => {
    const ready = { claude: { status: "ready", version: "2.1.0", detail: null }, codex: { status: "ready", version: "0.165.0", detail: null }, api: { hasKey: false, model: "claude-opus-5-5" }, agent: "claude", models };
    const { invoke } = fakeBridge({
      "app:info": info(),
      "library:list": [summary],
      "project:get": project,
      "ai:status": ready,
      "project:edit": (input: { op: { type: string } }) => ({ ...project, revision: 4, history: { past: input.op.type === "undo" ? [] : [{ segments: [], statuses: {} }], future: [] } }),
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "talk" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Accept silence/ }));
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("project:edit", { id: "p1", revision: 3, op: { type: "decide", ids: ["x1"], status: "accepted" } }),
    );
    await vi.waitFor(() => expect((screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("project:edit", { id: "p1", revision: 4, op: { type: "undo" } }));
  });

  it("follows the menu bar: open recent, tabs, hide cuts, undo, add videos, settings", async () => {
    const ready = { claude: { status: "ready", version: "2.1.0", detail: null }, codex: { status: "ready", version: "0.165.0", detail: null }, api: { hasKey: false, model: "claude-opus-5-5" }, agent: "claude", models };
    const done = { ...project, revision: 4, history: { past: [{ segments: [], statuses: {} }], future: [] } };
    const { invoke, emit } = fakeBridge({
      "app:info": info(),
      "library:list": [summary],
      "project:get": done,
      "ai:status": ready,
      "files:pick": ["/v/take-2.mp4"],
      "project:import": done,
      "project:edit": { ...done, revision: 5, history: { past: [], future: [] } },
      "update:status": { state: "idle", version: null, detail: null, page: null },
    });
    render(<App />);
    await screen.findByRole("button", { name: "talk" });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("menu:state", { project: null }));

    emit("menu", { command: "open-project", projectId: "p1" });
    expect(await screen.findByRole("heading", { level: 1, name: "talk" })).toBeTruthy();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("menu:state", { project: { id: "p1", hideCuts: false } }));

    emit("menu", { command: "export" });
    expect(screen.getByRole("tab", { name: "Export" }).getAttribute("aria-selected")).toBe("true");
    emit("menu", { command: "tab-look" });
    expect(screen.getByRole("tab", { name: "Look" }).getAttribute("aria-selected")).toBe("true");

    emit("menu", { command: "hide-cuts" });
    expect(screen.getByRole("button", { name: "Hide cuts" }).getAttribute("aria-pressed")).toBe("true");
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("menu:state", { project: { id: "p1", hideCuts: true } }));

    emit("menu", { command: "undo" });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("project:edit", { id: "p1", revision: 4, op: { type: "undo" } }));

    emit("menu", { command: "add-videos" });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("project:import", { projectId: "p1", files: ["/v/take-2.mp4"] }));

    emit("menu", { command: "settings" });
    expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeTruthy();
    await vi.waitFor(() => expect(invoke).toHaveBeenLastCalledWith("menu:state", { project: null }));
  });

  it("leaves Undo to a text box that has focus", async () => {
    const { invoke, emit } = fakeBridge({ "app:info": info(), "library:list": [summary], "project:get": { ...project, history: { past: [{ segments: [], statuses: {} }], future: [] } }, "ai:status": { claude: { status: "ready", version: null, detail: null }, codex: { status: "ready", version: null, detail: null }, api: { hasKey: false, model: "claude-opus-5-5" }, agent: "claude", models } });
    const execCommand = vi.fn(() => true);
    document.execCommand = execCommand;
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "talk" }));
    await screen.findByRole("heading", { level: 1, name: "talk" });
    await vi.waitFor(() => expect((screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement).disabled).toBe(false));
    const box = document.createElement("input");
    document.body.append(box);
    box.focus();
    emit("menu", { command: "undo" });
    expect(execCommand).toHaveBeenCalledWith("undo");
    expect(invoke).not.toHaveBeenCalledWith("project:edit", expect.anything());
    box.remove();
  });

  it("imports videos into a new project from the File menu and opens it", async () => {
    const { invoke, emit } = fakeBridge({ "app:info": info(), "library:list": [], "files:pick": ["/v/a.mov"], "project:import": project, "project:get": project, "ai:status": { claude: { status: "ready", version: null, detail: null }, codex: { status: "ready", version: null, detail: null }, api: { hasKey: false, model: "claude-opus-5-5" }, agent: "claude", models } });
    render(<App />);
    await screen.findByRole("heading", { level: 2, name: "No projects yet" });
    emit("menu", { command: "import" });
    expect(await screen.findByRole("heading", { level: 1, name: "talk" })).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("project:import", { projectId: null, files: ["/v/a.mov"] });
  });

  it("keeps a history of decided suggestions, where a decision can be changed", async () => {
    const decided = {
      ...project,
      proposals: [
        ...project.proposals,
        { id: "x2", type: "retake", sourceId: "s1", cuts: [[0.4, 1]], wordIds: ["s1-0"], keepWordIds: [], reason: "Said twice", confidence: 0.9, status: "rejected" },
        { id: "x3", type: "silence", sourceId: "s1", cuts: [[2.5, 2.9]], wordIds: [], keepWordIds: [], reason: "", confidence: 1, status: "accepted" },
        // Added by hand, not suggested: not in the history.
        { id: "x4", type: "punch-in", sourceId: "s1", cuts: [], wordIds: ["s1-1"], keepWordIds: [], reason: "", confidence: 1, status: "accepted", punch: { range: [3, 3.5], style: "cut", scale: 1.25 } },
      ],
    };
    const { invoke } = fakeBridge({ "app:info": info(), "library:list": [summary], "project:get": decided, "project:edit": { ...decided, revision: 4 } });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "talk" }));
    const history = (await screen.findByText("History: 1 accepted, 1 rejected")).closest("details")!;
    expect(within(history).getAllByRole("listitem")).toHaveLength(2);
    expect(history.textContent).toContain("Rejected: Retake");
    fireEvent.click(within(history).getByRole("button", { name: "Accept retake: Said twice instead" }));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("project:edit", { id: "p1", revision: 3, op: { type: "decide", ids: ["x2"], status: "accepted" } }));
  });

  it("styles captions, shows them over the preview and exports", async () => {
    const ready = { claude: { status: "ready", version: "2.1.0", detail: null }, codex: { status: "ready", version: "0.165.0", detail: null }, api: { hasKey: false, model: "claude-opus-5-5" }, agent: "claude", models };
    const exported = { ...project, lastExport: { path: "/Movies/talk.mp4", format: "16:9", at: "" } };
    const { invoke } = fakeBridge({
      "app:info": info(),
      "library:list": [summary],
      "project:get": exported,
      "ai:status": ready,
      "project:edit": { ...exported, revision: 4 },
      "project:export": { path: "/Movies/talk (vertical).mp4" },
      "project:reveal-export": undefined,
      "project:export-timeline": { path: "/Documents/talk.fcpxml" },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "talk" }));
    fireEvent.click(await screen.findByRole("button", { name: "again." }));
    expect(document.querySelector(".captions")?.textContent).toContain("again.");

    fireEvent.change(screen.getByLabelText("Capitals"), { target: { value: "upper" } });
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("project:edit", { id: "p1", revision: 3, op: { type: "captions", captions: { case: "upper" } } }),
    );
    await openTab("Look");
    const textColour = screen.getByRole("group", { name: "Text colour" });
    expect(within(textColour).getByRole("button", { name: "White" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(textColour).getByRole("button", { name: "Splice tape" }));
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("project:edit", { id: "p1", revision: 4, op: { type: "captions", captions: { color: "#F2B705" } } }),
    );
    fireEvent.change(within(textColour).getByLabelText("Another text colour"), { target: { value: "#3366cc" } });
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("project:edit", { id: "p1", revision: 4, op: { type: "captions", captions: { color: "#3366CC" } } }),
    );
    // The box colour waits until there's a box.
    expect((screen.getByRole("group", { name: "Box colour" }) as HTMLFieldSetElement).disabled).toBe(true);

    await openTab("Export");
    fireEvent.click(screen.getByRole("button", { name: /Export 9:16/ }));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("project:export", { id: "p1", format: "9:16", cover: null }));
    expect(screen.getByText("Last export: talk.mp4 (16:9)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show file" }));
    expect(invoke).toHaveBeenCalledWith("project:reveal-export", { id: "p1" });

    fireEvent.click(screen.getByRole("button", { name: /Final Cut Pro/ }));
    expect(invoke).toHaveBeenCalledWith("project:export-timeline", { id: "p1", format: "fcpxml" });
    expect(await screen.findByText("Saved talk.fcpxml.")).toBeTruthy();
  });

  it("switches to the vertical shape, crops the preview around the face and takes a hand-set position", async () => {
    const ready = { claude: { status: "ready", version: "2.1.0", detail: null }, codex: { status: "ready", version: "0.165.0", detail: null }, api: { hasKey: false, model: "claude-opus-5-5" }, agent: "claude", models };
    const withFaces = { ...project, sources: [{ ...project.sources[0]!, framing: "auto", faces: [{ t: 2, x: 0.8 }] }] };
    const tall = { ...withFaces, aspectRatio: "9:16", revision: 4 };
    const { invoke } = fakeBridge({
      "app:info": info(),
      "library:list": [summary],
      "project:get": withFaces,
      "ai:status": ready,
      "project:edit": (input: { op: { type: string } }) => (input.op.type === "aspect" ? tall : { ...tall, revision: 5 }),
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "talk" }));
    fireEvent.change(await screen.findByLabelText("Shape"), { target: { value: "9:16" } });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("project:edit", { id: "p1", revision: 3, op: { type: "aspect", aspectRatio: "9:16" } }));
    const video = await vi.waitFor(() => {
      const v = document.querySelector<HTMLVideoElement>(".project__video--tall");
      expect(v).toBeTruthy();
      return v!;
    });
    // A face at 0.8 across: the crop's left edge sits at 0.64, 94% of the way it can move.
    expect(video.style.objectPosition).toMatch(/^93\.88\d*% 50%$/);
    expect(screen.getByText(/finds the face in each kept stretch/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Crop position"), { target: { value: "0.3" } });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("project:edit", { id: "p1", revision: 4, op: { type: "frame", sourceId: "s1", x: 0.3 } }));
  });

  it("punches in on selected words, then lists the punch-in to restyle or remove", async () => {
    const ready = { claude: { status: "ready", version: "2.1.0", detail: null }, codex: { status: "ready", version: "0.165.0", detail: null }, api: { hasKey: false, model: "claude-opus-5-5" }, agent: "claude", models };
    const punch = {
      id: "k1", type: "punch-in", sourceId: "s1", cuts: [], wordIds: ["s1-0"], keepWordIds: [], reason: "", confidence: 1, status: "accepted",
      punch: { range: [0.5, 0.9], style: "zoom-in", scale: 1.2 },
    };
    const punched = { ...project, revision: 4, proposals: [...project.proposals, punch] };
    const { invoke } = fakeBridge({ "app:info": info(), "library:list": [summary], "project:get": project, "ai:status": ready, "project:edit": punched });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "talk" }));
    fireEvent.click(await screen.findByRole("button", { name: "Hello" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("project:edit", { id: "p1", revision: 3, op: { type: "punch", wordIds: ["s1-0"], style: "zoom-in" } }));
    expect(await screen.findByText("“Hello”")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hello" }).className).toContain("word--punched");

    fireEvent.change(screen.getByLabelText("How the zoom at 0:01 moves"), { target: { value: "cut" } });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("project:edit", { id: "p1", revision: 4, op: { type: "punch-style", id: "k1", style: "cut" } }));
    fireEvent.click(screen.getByRole("button", { name: "Remove the zoom at 0:01" }));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("project:edit", { id: "p1", revision: 4, op: { type: "decide", ids: ["k1"], status: "rejected" } }));
  });

  it("adds b-roll media, shows it over selected words and restyles it", async () => {
    const ready = { claude: { status: "ready", version: "2.1.0", detail: null }, codex: { status: "ready", version: "0.165.0", detail: null }, api: { hasKey: false, model: "claude-opus-5-5" }, agent: "claude", models };
    const drone = {
      id: "m1", name: "drone.mp4", path: "/v/drone.mp4", kind: "video", media: { duration: 12, width: 1920, height: 1080 },
      prep: { preview: "media/assets/m1/preview.mp4", frames: ["media/assets/m1/frame-1.jpg"] }, description: "A city from above",
    };
    const withMedia = { ...project, revision: 4, assets: [drone] };
    const broll = {
      id: "o1", type: "visual", sourceId: "s1", cuts: [], wordIds: ["s1-0"], keepWordIds: [], reason: "", confidence: 1, status: "accepted", punch: null,
      overlay: { range: [0.5, 0.9], assetId: "m1", placement: "full", shape: "rectangle", corner: "top-right", size: 0.35, offset: 0 },
    };
    const placed = { ...withMedia, revision: 5, proposals: [...project.proposals, broll] };
    const { invoke, emit } = fakeBridge({
      "app:info": info(),
      "library:list": [summary],
      "project:get": project,
      "ai:status": ready,
      "media:pick": ["/v/drone.mp4"],
      "project:add-media": withMedia,
      "project:edit": placed,
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "talk" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add pictures or clips" }));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("project:add-media", { id: "p1", files: ["/v/drone.mp4"] }));
    // The project reloads when main says it changed.
    invoke.mockImplementation(async (method: string) => (method === "project:get" ? withMedia : method === "project:edit" ? placed : undefined));
    emit("project:changed", { id: "p1", revision: 4 });
    expect(((await screen.findByLabelText("What drone.mp4 shows")) as HTMLTextAreaElement).value).toBe("A city from above");

    fireEvent.click(screen.getByRole("button", { name: "Hello" }));
    fireEvent.change(screen.getByLabelText("Show b-roll over the selection"), { target: { value: "m1" } });
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("project:edit", { id: "p1", revision: 4, op: { type: "overlay", wordIds: ["s1-0"], assetId: "m1", placement: "full" } }),
    );
    fireEvent.change(await screen.findByLabelText("Placement of the b-roll at 0:01"), { target: { value: "pip" } });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("project:edit", { id: "p1", revision: 5, op: { type: "overlay-style", id: "o1", placement: "pip" } }));
    expect(screen.getByRole("button", { name: "Hello" }).className).toContain("word--broll");
    fireEvent.click(screen.getByRole("button", { name: "Remove drone.mp4" }));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("project:edit", { id: "p1", revision: 5, op: { type: "remove-asset", assetId: "m1" } }));
  });

  it("asks for a slide over selected words, and offers to design one that has no design yet", async () => {
    const ready = { claude: { status: "ready", version: "2.1.0", detail: null }, codex: { status: "ready", version: "0.165.0", detail: null }, api: { hasKey: false, model: "claude-opus-5-5" }, agent: "claude", models };
    const card = {
      id: "g1", name: "Three steps", path: "", kind: "slide", media: { duration: 2, width: 0, height: 0 }, prep: null, description: "Three steps",
      slide: { brief: "Three steps", look: "ink", html: "" },
    };
    const proposal = {
      id: "o2", type: "visual", sourceId: "s1", cuts: [], wordIds: ["s1-0"], keepWordIds: [], reason: "Lists them", confidence: 0.7, status: "pending", punch: null,
      overlay: { range: [0.5, 0.9], assetId: "g1", placement: "full", shape: "rectangle", corner: "top-right", size: 0.35, offset: 0 },
    };
    const withSlide = { ...project, revision: 4, assets: [card], proposals: [...project.proposals, proposal] };
    const { invoke } = fakeBridge({
      "app:info": info(),
      "library:list": [summary],
      "project:get": project,
      "ai:status": ready,
      "project:edit": withSlide,
      "project:design-slides": undefined,
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "talk" }));
    fireEvent.click(await screen.findByRole("button", { name: "Hello" }));
    fireEvent.click(screen.getByRole("button", { name: "Slide" }));
    expect((screen.getByRole("button", { name: "Add slide" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("What the slide says"), { target: { value: "Three steps" } });
    fireEvent.change(screen.getByLabelText("Slide look"), { target: { value: "ink" } });
    fireEvent.click(screen.getByRole("button", { name: "Add slide" }));
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("project:edit", { id: "p1", revision: 3, op: { type: "slide", wordIds: ["s1-0"], brief: "Three steps", look: "ink" } }),
    );

    expect(await screen.findByText("Slide, ink, being designed: Three steps")).toBeTruthy();
    expect(((await screen.findByLabelText("What Three steps says")) as HTMLTextAreaElement).value).toBe("Three steps");
    fireEvent.click(screen.getByRole("button", { name: "Design now" }));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("project:design-slides", { id: "p1" }));
  });

  it("lands a sound effect on a word, labels a suggested one, and adds and tunes music", async () => {
    const ready = { claude: { status: "ready", version: "2.1.0", detail: null }, codex: { status: "ready", version: "0.165.0", detail: null }, api: { hasKey: false, model: "claude-opus-5-5" }, agent: "claude", models };
    const sound = (id: string, status: string, effect: string) => ({
      id, type: "sound", sourceId: "s1", cuts: [], wordIds: ["s1-1"], keepWordIds: [], reason: "New topic", confidence: 0.8, status, punch: null, overlay: null,
      sound: { at: 3, effect, volume: 0.7 },
    });
    const withSounds = { ...project, revision: 4, proposals: [...project.proposals, sound("f1", "accepted", "ding"), sound("f2", "pending", "whoosh")] };
    const withMusic = { ...withSounds, revision: 5, music: { path: "/m/song.mp3", name: "song.mp3", duration: 120, volume: 0.15, duck: true, prep: null } };
    // Main announces the music once it is on, and the editor loads it again.
    let current: object = project;
    const { invoke, emit } = fakeBridge({
      "app:info": info(),
      "library:list": [summary],
      "project:get": () => current,
      "ai:status": ready,
      "project:edit": withSounds,
      "music:pick": "/m/song.mp3",
      "project:set-music": () => {
        current = withMusic;
        return withMusic;
      },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "talk" }));
    expect(await screen.findByRole("button", { name: "Play Whoosh" })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "again." }));
    fireEvent.change(screen.getByLabelText("Add a sound effect on the selection's first word"), { target: { value: "ding" } });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("project:edit", { id: "p1", revision: 3, op: { type: "sound", wordId: "s1-1", effect: "ding" } }));

    expect(await screen.findByText("Sound, whoosh")).toBeTruthy();
    const volume = await screen.findByLabelText("Volume of the Ding at 0:03");
    fireEvent.change(volume, { target: { value: "1" } });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("project:edit", { id: "p1", revision: 4, op: { type: "sound-volume", id: "f1", volume: 1 } }));

    fireEvent.click(screen.getByRole("button", { name: "Add music" }));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("project:set-music", { id: "p1", file: "/m/song.mp3" }));
    emit("project:changed", { id: "p1", revision: 5 });
    expect(await screen.findByText("Preparing…")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Lower the music while you talk"));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("project:edit", expect.objectContaining({ op: { type: "music", duck: false } })));
  });

  it("writes up the video, edits its chapters and copies them for YouTube", async () => {
    const ready = { claude: { status: "ready", version: "2.1.0", detail: null }, codex: { status: "ready", version: "0.165.0", detail: null }, api: { hasKey: false, model: "claude-opus-5-5" }, agent: "claude", models };
    const writeup = {
      chapters: [{ wordId: "s1-0", title: "Hello" }, { wordId: "s1-1", title: "Again" }],
      description: "Two words.",
      article: { title: "Saying hello", markdown: "Hello again." },
    };
    const written = { ...project, revision: 4, writeup };
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { invoke } = fakeBridge({
      "app:info": info(),
      "library:list": [summary],
      "project:get": written,
      "ai:status": ready,
      "project:edit": written,
      "project:writeup": undefined,
      "project:save-article": { path: "/d/Saying hello.md" },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "talk" }));
    await openTab("Publish");
    fireEvent.click(await screen.findByRole("button", { name: "Rewrite chapters and article" }));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("project:writeup", { id: "p1" }));

    // The pause from 1 s to 2.5 s isn't cut, so "again." is at 0:03; the first chapter always starts the video.
    const title = screen.getByLabelText("Title of the chapter at 0:03");
    expect((screen.getByLabelText("Title of the chapter at 0:00") as HTMLInputElement).value).toBe("Hello");
    fireEvent.change(title, { target: { value: "Once more" } });
    fireEvent.blur(title);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("project:edit", { id: "p1", revision: 4, op: { type: "chapter", wordId: "s1-1", title: "Once more" } }));
    expect(screen.getByText("YouTube shows chapters once there are at least 3.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Copy description and chapters" }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("Two words."));
    fireEvent.click(screen.getByRole("button", { name: "Save article as Markdown…" }));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("project:save-article", { id: "p1" }));

    fireEvent.click(screen.getByRole("button", { name: "Remove the chapter at 0:03" }));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("project:edit", expect.objectContaining({ op: { type: "remove-chapter", wordId: "s1-1" } })));
  });

  it("makes a thumbnail from the frame at the playhead, then changes its text and colours", async () => {
    const thumbnail = { sourceId: "s1", time: 0, frame: "media/thumbnail/frame-a.jpg", subject: "media/thumbnail/subject-a.png", text: "", textColor: "paper", background: "frame", textSide: "left", textBox: null, behind: true };
    const { invoke } = fakeBridge({
      "app:info": info(),
      "library:list": [summary],
      "project:get": { ...project, thumbnail },
      "ai:status": { claude: { status: "missing", version: null, detail: null }, codex: { status: "missing", version: null, detail: null }, api: { hasKey: false, model: "claude-opus-5-5" }, agent: "claude", models },
      "project:thumbnail-frame": undefined,
      "project:edit": { ...project, thumbnail },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "talk" }));
    await openTab("Publish");
    fireEvent.click(await screen.findByRole("button", { name: "Make a thumbnail from 0:00" }));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("project:thumbnail-frame", { id: "p1", sourceId: "s1", time: 0 }));
    expect(screen.getByText(/The text sits behind you/)).toBeTruthy();

    const text = screen.getByLabelText("Text") as HTMLInputElement;
    fireEvent.change(text, { target: { value: "Say it once" } });
    fireEvent.blur(text);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("project:edit", expect.objectContaining({ op: { type: "thumbnail", text: "Say it once" } })));
    fireEvent.change(screen.getByLabelText("Behind the text"), { target: { value: "blur" } });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("project:edit", expect.objectContaining({ op: { type: "thumbnail", background: "blur" } })));
    const colours = screen.getByRole("group", { name: "Thumbnail text colour" });
    expect(within(colours).getAllByRole("button")).toHaveLength(11);
    expect(within(colours).getByRole("button", { name: "Paper" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(colours).getByRole("button", { name: "Pink" }));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("project:edit", expect.objectContaining({ op: { type: "thumbnail", textColor: "pink" } })));
    // The pictures haven't loaded, so there's nothing to save yet.
    expect((screen.getByRole("button", { name: "Save thumbnail as PNG…" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("changes the speed and cancels a running export", async () => {
    const ready = { claude: { status: "ready", version: "2.1.0", detail: null }, codex: { status: "ready", version: "0.165.0", detail: null }, api: { hasKey: false, model: "claude-opus-5-5" }, agent: "claude", models };
    const { invoke, emit } = fakeBridge({
      "app:info": info(),
      "library:list": [summary],
      "project:get": project,
      "ai:status": ready,
      "project:edit": { ...project, speed: 1.25, revision: 4 },
      "jobs:cancel": undefined,
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "talk" }));
    fireEvent.change(await screen.findByLabelText("Playback speed"), { target: { value: "1.25" } });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("project:edit", { id: "p1", revision: 3, op: { type: "speed", speed: 1.25 } }));
    // 75 s with the speed at 1.25× runs a minute.
    expect(await screen.findByText("The edit runs 1:00.")).toBeTruthy();

    emit("job", { projectId: "p1", jobId: "j9", kind: "export", label: "Exporting 9:16", state: "running", fraction: 0.3 });
    fireEvent.click(screen.getByRole("button", { name: "Cancel Exporting 9:16" }));
    expect(invoke).toHaveBeenCalledWith("jobs:cancel", { id: "p1" });
  });

  it("says when Claude Code isn't installed", async () => {
    const missing = { claude: { status: "not-installed", version: null, detail: "Install Claude Code, then reopen ClipCat." }, codex: { status: "signed-out", version: "0.165.0", detail: "Run `codex login` in a terminal, then try again." }, api: { hasKey: false, model: "claude-opus-5-5" }, agent: "claude", models };
    fakeBridge({ "app:info": info(), "library:list": [summary], "project:get": project, "ai:status": missing });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "talk" }));
    expect(await screen.findByText(/Install Claude Code, then reopen ClipCat/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Suggest an edit" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("switches the AI to Codex", async () => {
    const ready = { claude: { status: "ready", version: "2.1.0", detail: null }, codex: { status: "ready", version: "0.165.0", detail: null }, api: { hasKey: false, model: "claude-opus-5-5" }, agent: "claude", models };
    const { invoke } = fakeBridge({
      "app:info": info(),
      "library:list": [summary],
      "project:get": project,
      "ai:status": ready,
      "settings:set": { agent: "codex" },
      "project:analyze": undefined,
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "talk" }));
    const pick = await screen.findByLabelText("Use");
    await vi.waitFor(() => expect((pick as HTMLSelectElement).disabled).toBe(false));
    fireEvent.change(pick, { target: { value: "codex" } });
    expect(invoke).toHaveBeenCalledWith("settings:set", { agent: "codex" });
    expect((screen.getByRole("button", { name: "Suggest an edit" }) as HTMLButtonElement).disabled).toBe(false);
    const model = screen.getByLabelText("Model") as HTMLSelectElement;
    expect([...model.options].map((o) => o.text)).toEqual(["Codex default (gpt-6.1-sol)", "GPT-6.1-Sol"]);
    fireEvent.change(model, { target: { value: "gpt-6.1-sol" } });
    expect(invoke).toHaveBeenCalledWith("settings:set", { codexModel: "gpt-6.1-sol" });
    fireEvent.change(model, { target: { value: "" } });
    expect(invoke).toHaveBeenCalledWith("settings:set", { codexModel: null });
  });

  it("runs the AI with the user's own Claude API key", async () => {
    const ready = { claude: { status: "not-installed", version: null, detail: "Install Claude Code, then reopen ClipCat." }, codex: { status: "ready", version: "0.165.0", detail: null }, api: { hasKey: false, model: "claude-opus-5-5" }, agent: "api", models };
    const { invoke } = fakeBridge({
      "app:info": info(),
      "library:list": [summary],
      "project:get": project,
      "ai:status": ready,
      "settings:set": { agent: "api" },
      "settings:api-key": { hasKey: true, model: "claude-opus-5-5" },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "talk" }));
    const keyField = await screen.findByLabelText("Claude API key");
    expect((screen.getByRole("button", { name: "Suggest an edit" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(keyField, { target: { value: " sk-ant-test-key " } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    expect(invoke).toHaveBeenCalledWith("settings:api-key", { key: "sk-ant-test-key" });
    expect(await screen.findByText(/Your API key is saved, encrypted/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Suggest an edit" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "claude-sonnet-5-5" } });
    expect(invoke).toHaveBeenCalledWith("settings:set", { apiModel: "claude-sonnet-5-5" });
  });

  it("asks for one change and fixes the transcript with the user's terms", async () => {
    const ready = { claude: { status: "ready", version: "2.1.0", detail: null }, codex: { status: "ready", version: "0.165.0", detail: null }, api: { hasKey: false, model: "claude-opus-5-5" }, agent: "claude", models };
    const { invoke } = fakeBridge({
      "app:info": info(),
      "library:list": [summary],
      "project:get": project,
      "ai:status": ready,
      "project:request": undefined,
      "project:correct": undefined,
      "settings:set": { agent: "claude", dictionary: ["ClipCat", "DaQuan"] },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "talk" }));
    const ask = await screen.findByRole("button", { name: "Send" });
    await vi.waitFor(() => expect((screen.getByLabelText("Use") as HTMLSelectElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("Ask for a change"), { target: { value: "Cut the part about pricing" } });
    fireEvent.click(ask);
    expect(invoke).toHaveBeenCalledWith("project:request", { id: "p1", request: "Cut the part about pricing" });

    const terms = screen.getByLabelText(/Names and words/) as HTMLInputElement;
    await vi.waitFor(() => expect(terms.value).toBe("ClipCat"));
    fireEvent.change(terms, { target: { value: "ClipCat, DaQuan,, ClipCat" } });
    fireEvent.click(screen.getByRole("button", { name: "Fix spelling" }));
    expect(invoke).toHaveBeenCalledWith("settings:set", { dictionary: ["ClipCat", "DaQuan"] });
    expect(invoke).toHaveBeenCalledWith("project:correct", { id: "p1" });
  });

  it("transcribes a project again in another language", async () => {
    const { invoke } = fakeBridge({ "app:info": info(), "library:list": [summary], "project:get": project, "project:language": project });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "talk" }));
    expect(await screen.findByText("Language: English")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Language of the speech"), { target: { value: "es" } });
    fireEvent.click(screen.getByRole("button", { name: "Transcribe again" }));
    expect(invoke).toHaveBeenCalledWith("project:language", { id: "p1", language: "es" });
  });

  it("makes shorts and opens one, which links back to the long video", async () => {
    const ready = { claude: { status: "ready", version: "2.1.0", detail: null }, codex: { status: "ready", version: null, detail: null }, api: { hasKey: false, model: "claude-opus-5-5" }, agent: "claude", models };
    const withShort = { ...project, revision: 4, shorts: [{ id: "sh1", title: "The hook", seconds: 42 }] };
    const short = { ...project, id: "sh1", name: "The hook", aspectRatio: "9:16", origin: { projectId: "p1", name: "talk", reason: "Bold claim up front." } };
    const { invoke, emit } = fakeBridge({
      "app:info": info(),
      "library:list": [summary],
      "project:get": ({ id }: { id: string }) => (id === "sh1" ? short : withShort),
      "ai:status": ready,
      "project:shorts": undefined,
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "talk" }));
    fireEvent.change(await screen.findByLabelText("How many"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Length"), { target: { value: "30" } });
    await openTab("Publish");
    fireEvent.click(screen.getByRole("button", { name: "Make shorts" }));
    expect(invoke).toHaveBeenCalledWith("project:shorts", { id: "p1", count: 5, seconds: 30 });
    emit("job", { projectId: "p1", jobId: "j5", kind: "shorts", label: "Finding shorts", state: "running", fraction: null });
    expect(screen.getByRole("button", { name: "Finding shorts…" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open The hook" }));
    expect(await screen.findByRole("heading", { level: 1, name: "The hook" })).toBeTruthy();
    expect(screen.getByText(/Cut from talk\. Bold claim up front\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open the long video" }));
    expect(await screen.findByRole("heading", { level: 1, name: "talk" })).toBeTruthy();
  });

  it("renames a project and shows its folder from the right-click menu", async () => {
    let name = "talk";
    const { invoke } = fakeBridge({
      "app:info": info(),
      "library:list": () => [{ ...summary, name }],
      "project:rename": (input: { name: string }) => {
        name = input.name;
        return { ...project, name };
      },
      "project:reveal": undefined,
    });
    render(<App />);
    const card = (await screen.findByRole("button", { name: "talk" })).closest("article")!;
    fireEvent.contextMenu(card, { clientX: 40, clientY: 60 });
    const menu = screen.getByRole("menu", { name: "Options for talk" });
    expect(within(menu).getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Open", "Rename", "Show in Finder", "Delete"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Rename" }));
    expect(screen.queryByRole("menu")).toBeNull();
    const field = screen.getByLabelText("Project name");
    fireEvent.change(field, { target: { value: "  Launch talk " } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(invoke).toHaveBeenCalledWith("project:rename", { id: "p1", name: "Launch talk" });
    expect(await screen.findByRole("button", { name: "Launch talk" })).toBeTruthy();

    fireEvent.contextMenu(screen.getByRole("button", { name: "Launch talk" }).closest("article")!);
    fireEvent.click(screen.getByRole("menuitem", { name: "Show in Finder" }));
    expect(invoke).toHaveBeenCalledWith("project:reveal", { id: "p1" });

    // Escape leaves the name as it was.
    fireEvent.click(screen.getByRole("button", { name: "Options for Launch talk" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    fireEvent.keyDown(screen.getByLabelText("Project name"), { key: "Escape" });
    expect(invoke.mock.calls.filter(([m]) => m === "project:rename")).toHaveLength(1);
  });

  it("renames the open project from its title", async () => {
    const { invoke } = fakeBridge({
      "app:info": info(),
      "library:list": [summary],
      "project:get": project,
      "project:rename": { ...project, name: "Launch talk", revision: 4 },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "talk" }));
    fireEvent.click(await screen.findByRole("button", { name: "talk" }));
    const field = screen.getByLabelText("Project name");
    fireEvent.change(field, { target: { value: "Launch talk" } });
    fireEvent.blur(field);
    expect(invoke).toHaveBeenCalledWith("project:rename", { id: "p1", name: "Launch talk" });
    expect(await screen.findByRole("heading", { level: 1, name: "Launch talk" })).toBeTruthy();
  });

  it("asks before deleting a project", async () => {
    const { invoke } = fakeBridge({ "app:info": info(), "library:list": [summary], "project:remove": undefined });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Options for talk" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(invoke).not.toHaveBeenCalledWith("project:remove", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("project:remove", { id: "p1" }));
  });
  it("connects a coding agent from settings only after showing what it writes, then checks it for real", async () => {
    const never = { live: false, lastAt: null, client: null };
    const agent = (id: string, label: string, over: object = {}) => ({
      id,
      label,
      detected: true,
      connected: false,
      config: `/Users/me/${id}.json`,
      unavailable: null,
      entry: `{ "mcpServers": { "clipcat": { "command": "/Applications/ClipCat.app" } } }`,
      session: never,
      ...over,
    });
    const before = [agent("claude-code", "Claude Code"), agent("codex", "Codex", { detected: false }), agent("claude-desktop", "Claude desktop app")];
    const after = before.map((a) => (a.id === "claude-code" ? { ...a, connected: true } : a));
    let added = false;
    const { invoke, emit } = fakeBridge({
      "app:info": info(),
      "library:list": [],
      "mcp:status": () => (added ? after : before),
      "mcp:connect": () => {
        added = true;
        return after;
      },
      "mcp:check": [
        { id: "saved", state: "ok", text: "Saved in ~/.claude.json." },
        { id: "reaches", state: "ok", text: "ClipCat 0.1.0 answered with 15 tools." },
        { id: "agent", state: "failed", text: 'Claude Code says "Failed to connect": ENOENT' },
      ],
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Connect Codex" })).toBeTruthy();
    expect(screen.getByText("Not found on this computer. You can still connect it for later.")).toBeTruthy();

    // Connect asks first, showing the file and the entry; cancelling writes nothing.
    fireEvent.click(screen.getByRole("button", { name: "Connect Claude Code" }));
    expect(screen.getByText("Add ClipCat to Claude Code?")).toBeTruthy();
    expect(screen.getAllByText("~/claude-code.json").length).toBeGreaterThan(0);
    expect(screen.getByText(/"clipcat"/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(invoke).not.toHaveBeenCalledWith("mcp:connect", expect.anything());

    fireEvent.click(screen.getByRole("button", { name: "Connect Claude Code" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to Claude Code" }));
    expect(await screen.findByRole("button", { name: "Disconnect Claude Code" })).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("mcp:connect", { agent: "claude-code", connect: true });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("mcp:check", { agent: "claude-code" }));
    expect(await screen.findByText("ClipCat 0.1.0 answered with 15 tools.")).toBeTruthy();
    expect(screen.getByText(/Failed to connect/)).toBeTruthy();
    expect(screen.getByText("Added, but it hasn't connected yet.")).toBeTruthy();
    expect(screen.getByText(/Waiting for Claude Code/)).toBeTruthy();

    // A real session arriving on the socket is what turns it on.
    emit("mcp:agents", after.map((a) => (a.id === "claude-code" ? { ...a, session: { live: true, lastAt: new Date().toISOString(), client: "claude-code 2.1.312" } } : a)));
    expect(await screen.findByText("Connected now (claude-code 2.1.312).")).toBeTruthy();
    expect(screen.getByText("Claude Code is connected now (claude-code 2.1.312).")).toBeTruthy();

    // The walkthrough opens on the agent just connected, and switches per agent.
    expect(screen.getByRole("tab", { name: "Claude Code, connected" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").textContent).toContain("Type /mcp.");
    fireEvent.click(screen.getByRole("tab", { name: "Claude desktop app" }));
    expect(screen.getByRole("tabpanel").textContent).toContain("Settings > Developer");
    fireEvent.click(screen.getByRole("button", { name: "Back to library" }));
    expect(await screen.findByRole("heading", { level: 2, name: "No projects yet" })).toBeTruthy();
  });

  it("copies an example prompt from the agent walkthrough", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    fakeBridge({ "app:info": info(), "library:list": [], "mcp:status": [] });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    const prompts = within(await screen.findByRole("list", { name: "Example prompts" })).getAllByRole("listitem");
    fireEvent.click(within(prompts[0]!).getByRole("button", { name: "Copy prompt" }));
    expect(writeText).toHaveBeenCalledWith(prompts[0]!.textContent);
    expect(await within(prompts[0]!).findByRole("button", { name: "Copied" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /full guide/ }).getAttribute("href")).toMatch(/^https:\/\/.+\/agents$/);
  });

  it("sets the transcription language and model, and downloads or deletes speech models", async () => {
    const speech = { agent: "claude", dictionary: [], speechLanguage: "en", speechEngine: "auto", whisperModel: "large-v3-turbo-q5_0" };
    const parakeet = { id: "parakeet", label: "Parakeet v3", approxMB: 480, bytes: 0, downloaded: false };
    const base = { id: "base", label: "Whisper Base", approxMB: 150, bytes: 148_000_000, downloaded: true };
    const { invoke, emit } = fakeBridge({
      "app:info": info(),
      "library:list": [],
      "mcp:status": [],
      "settings:get": speech,
      "settings:set": (patch: object) => ({ ...speech, ...patch }),
      "speech:models": [parakeet, base],
      "speech:download": () => new Promise(() => {}),
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    const language = (await screen.findByLabelText("Language for new projects")) as HTMLSelectElement;
    await vi.waitFor(() => expect(language.disabled).toBe(false));
    fireEvent.change(language, { target: { value: "ja" } });
    expect(invoke).toHaveBeenCalledWith("settings:set", { speechLanguage: "ja" });
    fireEvent.change(screen.getByLabelText("Engine"), { target: { value: "whisper" } });
    expect(invoke).toHaveBeenCalledWith("settings:set", { speechEngine: "whisper" });

    expect(await screen.findByText("Downloaded, 148 MB")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Download Parakeet v3" }));
    expect(invoke).toHaveBeenCalledWith("speech:download", { id: "parakeet" });
    emit("speech:progress", { id: "parakeet", fraction: 0.4 });
    expect(screen.getByText("Downloading… 40%")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Delete Whisper Base" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers a downloaded update, checks for one from settings and saves diagnostics", async () => {
    const status = (over: object) => ({ state: "idle", version: null, detail: null, page: "https://github.com/o/r/releases/latest", checkedAt: null, ...over });
    const { invoke, emit } = fakeBridge({
      "app:info": info(),
      "library:list": [],
      "mcp:status": [],
      "update:status": status({}),
      "update:check": () => status({ state: "checking" }),
      "app:diagnostics": { path: "/Users/me/Desktop/ClipCat diagnostics 2026-10-28.zip" },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    expect(await screen.findByText("You have the newest version.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    expect(invoke).toHaveBeenCalledWith("update:check");

    fireEvent.click(screen.getByRole("button", { name: "Save diagnostics" }));
    expect(await screen.findByText("Saved ClipCat diagnostics 2026-10-28.zip.")).toBeTruthy();

    emit("update", status({ state: "ready", version: "0.2.0" }));
    expect(screen.getByText("ClipCat 0.2.0 is downloaded. Restart to use it.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restart to update to 0.2.0" }));
    expect(invoke).toHaveBeenCalledWith("update:install");

    emit("update", status({ state: "available", version: "0.2.0" }));
    fireEvent.click(screen.getByRole("button", { name: "ClipCat 0.2.0 is out: download it" }));
    expect(invoke).toHaveBeenCalledWith("update:open");
  });

  describe("recording", () => {
    /** Stand-ins for the camera, the microphone and MediaRecorder, which jsdom doesn't have. */
    function fakeMedia() {
      const track = (kind: string) => ({ kind, stop: vi.fn(), addEventListener: vi.fn() });
      const stream = (kinds: string[]) => {
        const tracks = kinds.map(track);
        return { getTracks: () => tracks, getVideoTracks: () => tracks.filter((t) => t.kind === "video"), getAudioTracks: () => tracks.filter((t) => t.kind === "audio") };
      };
      const getUserMedia = vi.fn(async (c: { video: unknown }) => stream(c.video ? ["video", "audio"] : ["audio"]));
      const devices = [
        { kind: "audioinput", deviceId: "default", label: "Default" },
        { kind: "audioinput", deviceId: "m1", label: "MacBook Air Microphone (Built-in)" },
        { kind: "videoinput", deviceId: "c1", label: "FaceTime HD Camera" },
      ];
      vi.stubGlobal("navigator", { ...navigator, mediaDevices: { getUserMedia, enumerateDevices: async () => devices } });
      const recorders: { options: unknown; timeslice: number }[] = [];
      class FakeRecorder {
        static isTypeSupported = (t: string) => t.startsWith("video/webm") || t.startsWith("audio/webm");
        state = "inactive";
        ondataavailable: ((e: { data: Blob }) => void) | null = null;
        onstop: (() => void) | null = null;
        constructor(_stream: unknown, options: unknown) {
          recorders.push({ options, timeslice: 0 });
        }
        start(timeslice: number) {
          this.state = "recording";
          recorders.at(-1)!.timeslice = timeslice;
        }
        stop() {
          this.state = "inactive";
          this.ondataavailable?.({ data: new Blob(["take"]) });
          this.onstop?.();
        }
      }
      vi.stubGlobal("MediaRecorder", FakeRecorder);
      return { getUserMedia, recorders };
    }

    afterEach(() => vi.unstubAllGlobals());

    it("records a camera take from the library and opens it as a new project", async () => {
      const { getUserMedia, recorders } = fakeMedia();
      const token = "00000000-0000-4000-8000-000000000001";
      const { invoke } = fakeBridge({
        "app:info": info(),
        "library:list": [],
        "project:get": project,
        "record:access": true,
        "record:begin": { token },
        "record:end": project,
      });
      render(<App />);
      fireEvent.click(await screen.findByRole("button", { name: "Record" }));
      expect(await screen.findByRole("heading", { level: 1, name: "Record" })).toBeTruthy();
      expect(screen.getByRole("tab", { name: "Camera", selected: true })).toBeTruthy();
      expect(await screen.findByRole("option", { name: "FaceTime HD Camera" })).toBeTruthy();
      expect(screen.queryByRole("option", { name: "Default" })).toBeNull();
      expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: true }));

      const record = screen.getByRole("button", { name: "Record" });
      fireEvent.click(record);
      expect(await screen.findByRole("timer", { name: "Recording time" })).toBeTruthy();
      expect(invoke).toHaveBeenCalledWith("record:begin", { kind: "camera", mimeType: "video/webm;codecs=vp9,opus" });
      expect(recorders[0]).toEqual({ options: { mimeType: "video/webm;codecs=vp9,opus", videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 192_000 }, timeslice: 1000 });

      fireEvent.click(screen.getByRole("button", { name: "Stop" }));
      expect(await screen.findByRole("heading", { level: 1, name: "talk" })).toBeTruthy();
      expect(invoke).toHaveBeenCalledWith("record:chunk", { token, data: btoa("take") });
      expect(invoke).toHaveBeenCalledWith("record:end", { token, projectId: null });
    });

    it("records a voice take into the open project, and says when the microphone is blocked", async () => {
      fakeMedia();
      let allowed = false;
      const token = "00000000-0000-4000-8000-000000000002";
      const { invoke } = fakeBridge({
        "app:info": info(),
        "library:list": [summary],
        "project:get": project,
        "record:access": () => allowed,
        "record:begin": { token },
        "record:end": project,
      });
      render(<App />);
      fireEvent.click(await screen.findByRole("button", { name: "talk" }));
      fireEvent.click(await screen.findByRole("button", { name: "Record another take" }));
      expect(await screen.findByRole("heading", { level: 1, name: "Record into talk" })).toBeTruthy();
      expect(await screen.findByText(/isn't allowed to use the microphone/)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Open privacy settings" }));
      expect(invoke).toHaveBeenCalledWith("record:privacy", { kind: "microphone" });

      allowed = true;
      fireEvent.click(screen.getByRole("tab", { name: "Voice" }));
      const record = await screen.findByRole("button", { name: "Record" });
      await vi.waitFor(() => expect((record as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(record);
      fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
      expect(await screen.findByRole("heading", { level: 1, name: "talk" })).toBeTruthy();
      expect(invoke).toHaveBeenCalledWith("record:begin", { kind: "voice", mimeType: "audio/webm;codecs=opus" });
      expect(invoke).toHaveBeenCalledWith("record:end", { token, projectId: "p1" });
    });

    it("records a screen with the macOS recorder and the chosen microphone", async () => {
      fakeMedia();
      const token = "00000000-0000-4000-8000-000000000003";
      const screens = [
        { id: "screen:1:0", displayId: "1", name: "Screen 1", thumbnail: "data:image/png;base64,AA==" },
        { id: "screen:2:0", displayId: "2", name: "Screen 2", thumbnail: "data:image/png;base64,AA==" },
      ];
      const { invoke } = fakeBridge({
        "app:info": info(),
        "library:list": [],
        "project:get": project,
        "record:access": true,
        "record:setup": { screens, native: true, systemAudio: true, screenAccess: "granted" },
        "record:native": { token },
        "record:end": project,
      });
      render(<App />);
      fireEvent.click(await screen.findByRole("button", { name: "Record" }));
      fireEvent.click(await screen.findByRole("tab", { name: "Screen" }));
      fireEvent.click(await screen.findByRole("radio", { name: "Screen 2" }));
      fireEvent.change(await screen.findByRole("combobox", { name: "Microphone" }), { target: { value: "m1" } });
      fireEvent.click(screen.getByRole("checkbox", { name: "Also record the computer's sound" }));
      const record = screen.getByRole("button", { name: "Record" });
      await vi.waitFor(() => expect((record as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(record);
      fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
      expect(await screen.findByRole("heading", { level: 1, name: "talk" })).toBeTruthy();
      expect(invoke).toHaveBeenCalledWith("record:native", { displayId: "2", mic: true, micName: "MacBook Air Microphone (Built-in)", systemAudio: true });
      expect(invoke).not.toHaveBeenCalledWith("record:begin", expect.anything());
    });
  });
});
