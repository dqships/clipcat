// The one contract between the main process and the UI. Every method the
// renderer can call is named here with a zod schema for its input and its
// result; main validates both, so a typo or a stale UI fails loudly instead
// of reaching the file system.

import { z } from "zod";
import { CHANNEL_PREFIX } from "./channels";

export const FfmpegInfo = z.object({
  available: z.boolean(),
  /** First line of `ffmpeg -version`, or null when the binary is missing or broken. */
  version: z.string().nullable(),
  path: z.string(),
});

export const AppInfo = z.object({
  name: z.string(),
  version: z.string(),
  platform: z.string(),
  arch: z.string(),
  ffmpeg: FfmpegInfo,
});

export const methods = {
  "app:info": { input: z.void(), output: AppInfo },
  /** The renderer reports it has drawn its first screen; used by the smoke test. */
  "app:ready": { input: z.object({ screen: z.string() }), output: z.void() },
} as const;

export type Methods = typeof methods;
export type MethodName = keyof Methods;
export type Input<M extends MethodName> = z.input<Methods[M]["input"]>;
export type Output<M extends MethodName> = z.output<Methods[M]["output"]>;

export { CHANNEL_PREFIX };
export const channelFor = (method: MethodName): string => `${CHANNEL_PREFIX}${method}`;

export const isMethodName = (name: string): name is MethodName => Object.hasOwn(methods, name);

/** What the preload script puts on `window.clipcat`. */
export interface ClipcatBridge {
  invoke<M extends MethodName>(method: M, ...input: Input<M> extends void ? [] : [Input<M>]): Promise<Output<M>>;
}

export type AppInfoValue = z.output<typeof AppInfo>;
