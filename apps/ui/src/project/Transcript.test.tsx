import { Project } from "@clipcat/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Transcript } from "./Transcript";

globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const project = Project.parse({
  version: 1,
  id: "p1",
  name: "talk",
  revision: 0,
  sources: [
    {
      id: "s1",
      name: "talk.mp4",
      path: "/v/talk.mp4",
      order: 0,
      media: { duration: 5, width: 1920, height: 1080, fps: 30, vfr: false, videoCodec: "h264", audioCodec: "aac" },
      frameX: 0.5,
      silenceRanges: [],
    },
  ],
  transcript: [
    { id: "w0", sourceId: "s1", text: "welcome", start: 0, end: 0.5 },
    { id: "w1", sourceId: "s1", text: "to", start: 0.6, end: 0.8 },
    { id: "w2", sourceId: "s1", text: "clipcap", start: 0.9, end: 1.4 },
  ],
  segments: [{ id: "g1", sourceId: "s1", sourceStart: 0, sourceEnd: 5, included: true }],
  proposals: [],
  captions: {},
  createdAt: "",
  updatedAt: "",
});

function setup() {
  const onEdit = vi.fn();
  const onSeek = vi.fn();
  render(<Transcript project={project} playhead={null} onSeek={onSeek} onEdit={onEdit} />);
  return { onEdit, onSeek };
}

afterEach(cleanup);

describe("Transcript", () => {
  it("retypes a word on double-click, and Enter saves it", () => {
    const { onEdit } = setup();
    fireEvent.doubleClick(screen.getByRole("button", { name: "clipcap" }));
    const input = screen.getByRole("textbox", { name: "Fix “clipcap”" });
    fireEvent.change(input, { target: { value: "ClipCat" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onEdit).toHaveBeenCalledWith({ type: "fix-word", wordId: "w2", text: "ClipCat" });
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("keeps typing keys away from the transcript, and Esc leaves the word as it was", () => {
    const { onEdit } = setup();
    fireEvent.click(screen.getByRole("button", { name: "to" }));
    fireEvent.click(screen.getByRole("button", { name: "Fix word" }));
    const input = screen.getByRole("textbox", { name: "Fix “to”" });
    fireEvent.keyDown(input, { key: "Backspace" });
    fireEvent.change(input, { target: { value: "too" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("shows a chevron at each end with more actions that way", () => {
    setup();
    const row = document.querySelector<HTMLElement>(".editor__actions")!;
    Object.defineProperty(row, "clientWidth", { value: 200 });
    Object.defineProperty(row, "scrollWidth", { value: 600 });
    row.scrollBy = vi.fn();
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
    fireEvent.scroll(row);
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(row.scrollBy).toHaveBeenCalledWith({ left: 150 });
    expect(screen.queryByRole("button", { name: "Earlier actions" })).toBeNull();

    row.scrollLeft = 400;
    fireEvent.scroll(row);
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
    expect(screen.getByRole("button", { name: "Earlier actions" })).toBeTruthy();
  });

  it("won't save more than one word", () => {
    const { onEdit } = setup();
    fireEvent.doubleClick(screen.getByRole("button", { name: "clipcap" }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "clip cat" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText(/One word only/)).toBeTruthy();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    fireEvent.blur(input);
    expect(onEdit).not.toHaveBeenCalled();
  });
});
