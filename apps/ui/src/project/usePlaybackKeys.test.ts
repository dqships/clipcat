import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PreviewHandle } from "./Preview";
import { usePlaybackKeys } from "./usePlaybackKeys";

const handle = () => ({ seek: vi.fn(), toggle: vi.fn(), pause: vi.fn(), shuttle: vi.fn(), step: vi.fn(), restart: vi.fn() }) satisfies PreviewHandle;

const press = (target: Element, key: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
};

const add = (html: string) => {
  const box = document.createElement("div");
  box.innerHTML = html;
  document.body.append(box);
  return box.firstElementChild!;
};

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("usePlaybackKeys", () => {
  it("plays and pauses on Space, even from a focused transcript word, and holds back its click", () => {
    const p = handle();
    renderHook(() => usePlaybackKeys({ current: p }, 30));
    const word = add(`<button class="word">hello</button>`);
    expect(press(word, " ").defaultPrevented).toBe(true);
    expect(p.toggle).toHaveBeenCalledOnce();
    const up = new KeyboardEvent("keyup", { key: " ", bubbles: true, cancelable: true });
    word.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(true);
  });

  it("plays from the beginning on Enter, and holds back the click on a transcript word", () => {
    const p = handle();
    renderHook(() => usePlaybackKeys({ current: p }, 30));
    expect(press(document.body, "Enter").defaultPrevented).toBe(true);
    expect(press(add(`<button class="word">hello</button>`), "Enter").defaultPrevented).toBe(true);
    expect(p.restart).toHaveBeenCalledTimes(2);
  });

  it("restarts once for a held Enter", () => {
    const p = handle();
    renderHook(() => usePlaybackKeys({ current: p }, 30));
    press(document.body, "Enter", { repeat: true });
    expect(p.restart).not.toHaveBeenCalled();
  });

  it("leaves Enter to every box, dialog and menu", () => {
    const p = handle();
    renderHook(() => usePlaybackKeys({ current: p }, 30));
    for (const html of [`<input />`, `<textarea></textarea>`, `<select></select>`, `<div contenteditable="true"></div>`, `<dialog open><button>OK</button></dialog>`, `<div role="menu"><button>Rename</button></div>`]) {
      const el = add(html);
      expect(press(el.firstElementChild ?? el, "Enter").defaultPrevented).toBe(false);
    }
    expect(p.restart).not.toHaveBeenCalled();
  });

  it("leaves Enter to a button the keyboard reached, but takes it from one that was clicked, until Tab moves on", () => {
    const p = handle();
    renderHook(() => usePlaybackKeys({ current: p }, 30));
    const button = add(`<button><span>Accept</span></button>`);
    expect(press(button, "Enter").defaultPrevented).toBe(false);
    expect(p.restart).not.toHaveBeenCalled();
    button.firstElementChild!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(press(button, "Enter").defaultPrevented).toBe(true);
    expect(p.restart).toHaveBeenCalledOnce();
    press(button, "Tab");
    expect(press(button, "Enter").defaultPrevented).toBe(false);
    expect(p.restart).toHaveBeenCalledOnce();
  });

  it("leaves keys alone while typing", () => {
    const p = handle();
    renderHook(() => usePlaybackKeys({ current: p }, 30));
    const field = add(`<input />`);
    press(field, " ");
    press(field, "l");
    press(field, "ArrowLeft");
    expect(p.toggle).not.toHaveBeenCalled();
    expect(p.shuttle).not.toHaveBeenCalled();
    expect(p.step).not.toHaveBeenCalled();
  });

  it("shuttles with J and L and pauses with K", () => {
    const p = handle();
    renderHook(() => usePlaybackKeys({ current: p }, 30));
    press(document.body, "l");
    press(document.body, "J");
    press(document.body, "k");
    expect(p.shuttle.mock.calls).toEqual([[1], [-1]]);
    expect(p.pause).toHaveBeenCalledOnce();
  });

  it("steps a frame with the arrows, a second with Shift, but not on controls that use arrows", () => {
    const p = handle();
    renderHook(() => usePlaybackKeys({ current: p }, 25));
    press(document.body, "ArrowRight");
    press(document.body, "ArrowLeft", { shiftKey: true });
    press(add(`<div role="slider" tabindex="0"></div>`), "ArrowRight");
    press(add(`<div role="separator" tabindex="0"></div>`), "ArrowLeft");
    expect(p.step.mock.calls).toEqual([[1], [-25]]);
  });

  it("leaves shortcuts with Cmd or Ctrl to the rest of the app", () => {
    const p = handle();
    renderHook(() => usePlaybackKeys({ current: p }, 30));
    press(document.body, "l", { metaKey: true });
    expect(p.shuttle).not.toHaveBeenCalled();
  });
});
