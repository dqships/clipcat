import type { EditOp, Project } from "@clipcat/core";
import { useCallback, useEffect, useRef } from "react";
import { bridge } from "../bridge";

/**
 * Sends edits to main one at a time, each based on the revision the last one
 * returned, so quick edits never trip the store's stale-save check. A failed
 * edit reloads the project and reports why. Cmd/Ctrl+Z undoes and
 * Shift+Cmd/Ctrl+Z redoes, except while typing in a field.
 */
export function useEditor(
  project: Project | null,
  setProject: (p: Project) => void,
  reload: () => void,
  onError: (message: string | null) => void,
): (op: EditOp) => void {
  const latest = useRef(project);
  latest.current = project;
  const queue = useRef<Promise<void>>(Promise.resolve());

  const edit = useCallback(
    (op: EditOp) => {
      queue.current = queue.current.then(async () => {
        const p = latest.current;
        const api = bridge();
        if (!p || !api) return;
        try {
          const next = await api.invoke("project:edit", { id: p.id, revision: p.revision, op });
          latest.current = next;
          setProject(next);
          onError(null);
        } catch (e) {
          onError(e instanceof Error ? e.message : String(e));
          reload();
        }
      });
    },
    [setProject, reload, onError],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      if (e.target instanceof Element && e.target.closest("input, textarea, [contenteditable]")) return;
      e.preventDefault();
      edit({ type: e.shiftKey ? "redo" : "undo" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [edit]);

  return edit;
}
