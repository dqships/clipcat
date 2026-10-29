import type { MenuCommandValue } from "@clipcat/ipc";
import { useEffect, useRef } from "react";
import { bridge } from "./bridge";

/** Runs `handler` for each menu bar item chosen; the latest handler, so it sees current state. */
export function useMenuCommand(handler: (command: MenuCommandValue, projectId?: string) => void) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const api = bridge();
    if (!api) return;
    return api.on("menu", ({ command, projectId }) => latest.current(command, projectId));
  }, []);
}

/** Inputs that hold typing; a checkbox, slider or button doesn't. */
const TEXT_BOX =
  "input:not([type='checkbox'], [type='radio'], [type='range'], [type='button'], [type='submit'], [type='reset'], [type='color'], [type='file']), textarea, [contenteditable]:not([contenteditable='false'])";

/** Whether a text box has focus. Undo and Redo then undo the typing, not the project. */
export function typing(): boolean {
  return document.activeElement?.closest(TEXT_BOX) != null;
}
