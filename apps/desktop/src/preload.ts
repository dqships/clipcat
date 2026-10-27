// The only bridge between the sandboxed UI and the main process. It exposes
// `invoke(method, input)`, `on(event, listener)` and the path of a dropped
// file; main checks the method, the sender and the input, so nothing here
// needs to.

import { contextBridge, ipcRenderer, webUtils } from "electron";
import { CHANNEL_PREFIX, EVENT_PREFIX } from "@clipcat/ipc/channels";

contextBridge.exposeInMainWorld("clipcat", {
  invoke: (method: string, input?: unknown) => ipcRenderer.invoke(`${CHANNEL_PREFIX}${method}`, input),
  on: (event: string, listener: (payload: unknown) => void) => {
    const channel = `${EVENT_PREFIX}${event}`;
    const wrapped = (_: unknown, payload: unknown) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => void ipcRenderer.removeListener(channel, wrapped);
  },
  pathForFile: (file: File) => webUtils.getPathForFile(file),
});
