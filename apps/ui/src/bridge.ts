import type { ClipcatBridge } from "@clipcat/ipc";

declare global {
  interface Window {
    clipcat?: ClipcatBridge;
  }
}

/** The preload bridge, or null when the UI runs in a plain browser (vite dev, tests). */
export const bridge = (): ClipcatBridge | null => window.clipcat ?? null;
