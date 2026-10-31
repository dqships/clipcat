import { type RefObject, useEffect } from "react";
import type { PreviewHandle } from "./Preview";

/** Where keys belong to what has focus: typing, and controls that pick from a list. */
const TYPING = "input, textarea, select, [contenteditable]:not([contenteditable='false']), dialog, [role='dialog'], [role='menu'], [role='listbox']";
/** Controls that use the arrow keys themselves. */
const ARROWS = `${TYPING}, [role='slider'], [role='separator'], [role='tab'], [role='tablist'], [role='radiogroup']`;

/** Controls Enter presses. */
const PRESSABLE = "button, a[href], summary, [role='button'], [role='link'], [role='tab'], [role='menuitem'], [role='switch'], [role='checkbox'], [role='radio']";

const within = (target: EventTarget | null, selector: string) => target instanceof Element && target.closest(selector) !== null;
const pressable = (target: EventTarget | null) => (target instanceof Element ? target.closest(PRESSABLE) : null);

/**
 * The editor's playback keys, anywhere in the window except while typing:
 * Space plays or pauses, Enter plays from the beginning, J/K/L shuttle back,
 * pause and shuttle forward (faster with each press), and Left/Right move a
 * frame (Shift: a second). Space never activates the focused button, so a
 * selected transcript word doesn't jump the playhead back to it. Enter leaves
 * a control the keyboard reached, but a clicked one keeps focus and pressing
 * it again would repeat the click, so Enter is the shortcut there.
 */
export function usePlaybackKeys(preview: RefObject<PreviewHandle | null>, fps: number) {
  useEffect(() => {
    /** The control last clicked, until Tab moves on. */
    let clicked: Element | null = null;
    /** Whether Enter belongs to what has focus. A transcript word stands in for the playhead, so it never keeps Enter, as it never keeps Space. */
    const holdsEnter = (target: EventTarget | null) => {
      if (within(target, TYPING)) return true;
      const control = pressable(target);
      return control !== null && control !== clicked && !within(target, ".word");
    };
    const onPointerDown = (e: PointerEvent) => {
      clicked = pressable(e.target);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab") clicked = null;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const p = preview.current;
      if (!p) return;
      if (e.key === " ") {
        if (within(e.target, TYPING)) return;
        e.preventDefault();
        if (!e.repeat) p.toggle();
        return;
      }
      if (e.key === "Enter") {
        if (e.isComposing || holdsEnter(e.target)) return;
        e.preventDefault();
        if (!e.repeat) p.restart();
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
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [preview, fps]);
}
