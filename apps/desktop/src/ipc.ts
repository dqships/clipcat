// Registers one ipcMain handler per contract method. Each call is checked
// three ways before it runs: it came from our own page, the method exists,
// and the input matches its schema. Results are checked on the way out too.

import { BrowserWindow, type IpcMainInvokeEvent, ipcMain } from "electron";
import {
  type EventName,
  type EventPayload,
  type Input,
  type MethodName,
  type Output,
  channelFor,
  eventChannelFor,
  events,
  methods,
} from "@clipcat/ipc";

export type Handlers = { [M in MethodName]: (input: Input<M>, event: IpcMainInvokeEvent) => Promise<Output<M>> | Output<M> };

/** Whether a frame URL is our UI: the packaged app:// page, or the dev server in development. */
export function isTrustedSender(url: string | undefined, devUrl: string | null): boolean {
  if (!url) return false;
  if (url.startsWith("app://clipcat/")) return true;
  return devUrl !== null && url.startsWith(devUrl);
}

export function registerIpc(handlers: Handlers, devUrl: string | null): void {
  for (const method of Object.keys(methods) as MethodName[]) {
    const { input, output } = methods[method];
    ipcMain.handle(channelFor(method), async (event, raw: unknown) => {
      if (!isTrustedSender(event.senderFrame?.url, devUrl)) {
        throw new Error(`Refused ${method} from an untrusted sender`);
      }
      const parsed = input.parse(raw);
      const handler = handlers[method] as (i: unknown, e: IpcMainInvokeEvent) => unknown;
      return output.parse(await handler(parsed, event));
    });
  }
}

/** Pushes an event to every window, after checking it against the contract. */
export function broadcast<E extends EventName>(event: E, payload: EventPayload<E>): void {
  const checked = events[event].parse(payload);
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(eventChannelFor(event), checked);
  }
}

/** Pushes an event to one window, after checking it against the contract. */
export function send<E extends EventName>(win: BrowserWindow, event: E, payload: EventPayload<E>): void {
  const checked = events[event].parse(payload);
  if (!win.isDestroyed()) win.webContents.send(eventChannelFor(event), checked);
}
