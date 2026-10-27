// The only bridge between the sandboxed UI and the main process. It exposes a
// single `invoke(method, input)`; main checks the method, the sender and the
// input, so nothing here needs to.

import { contextBridge, ipcRenderer } from "electron";
import { CHANNEL_PREFIX } from "@clipcat/ipc/channels";

contextBridge.exposeInMainWorld("clipcat", {
  invoke: (method: string, input?: unknown) => ipcRenderer.invoke(`${CHANNEL_PREFIX}${method}`, input),
});
