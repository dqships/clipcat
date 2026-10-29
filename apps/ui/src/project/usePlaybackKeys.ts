import { type RefObject, useEffect } from "react";
import type { PreviewHandle } from "./Preview";

/** Where keys belong to what has focus: typing, and controls that pick from a list. */
const TYPING = "input, textarea, select, [contenteditable]:not([contenteditable='false']), dialog, [role='dialog'], [role='menu'], [role='listbox']";
/** Controls that use the arrow keys themselves. */
const ARROWS = `${TYPING}, [role='slider'], [role='separator'], [role='tab'], [role='tablist'], [role='radiogroup']`;

const within = (target: EventTarget | null, selector: string) => target instanceof Element && target.closest(selector) !== null;

/**
 * The editor's playback keys, anywhere in the window except while typing:
 * Space plays or pauses, J/K/L shuttle back, pause and shuttle forward
 * (faster with each press), and Left/Right move a frame (Shift: a second).
 * Space never activates the focused button, so a selected transcript word
 * doesn't jump the playhead back to it.
 */
export function usePlaybackKeys(preview: RefObject<PreviewHandle | null>, fps: number) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const p = preview.current;
      if (!p) return;
      if (e.key === " ") {
        if (within(e.target, TYPING)) return;
        e.preventDefault();
        if (!e.repeat) p.toggle();
        return;
      }
      const key = e.key.toLowerCase();
      if (key === "j" || key === "k" || key === "l") {
        if (within(e.target, TYPING) || e.repeat) return;
        e.preventDefault();
        if (key === "k") p.pause();
        else p.shuttle(key === "l" ? 1 : -1);
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (e.defaultPrevented || within(e.target, ARROWS)) return;
        e.preventDefault();
        const frames = e.shiftKey ? Math.max(1, Math.round(fps)) : 1;
        p.step(e.key === "ArrowLeft" ? -frames : frames);
      }
    };
    // A button clicks on Space's keyup, so that is held back too.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " " && !e.metaKey && !e.ctrlKey && !e.altKey && !within(e.target, TYPING)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [preview, fps]);
}
