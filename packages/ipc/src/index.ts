// The one contract between the main process and the UI. Every method the
// renderer can call is named here with a zod schema for its input and its
// result; main validates both, so a typo or a stale UI fails loudly instead
// of reaching the file system.

import { z } from "zod";
import { EditOp, Project } from "@clipcat/core";
import { CHANNEL_PREFIX, EVENT_PREFIX } from "./channels";

export const ToolInfo = z.object({
  available: z.boolean(),
  /** First line of `<tool> -version`, or null when the binary is missing or broken. */
  version: z.string().nullable(),
  path: z.string(),
});

export const AppInfo = z.object({
  name: z.string(),
  version: z.string(),
  platform: z.string(),
  arch: z.string(),
  ffmpeg: ToolInfo,
  whisper: ToolInfo,
  /** The Parakeet helper on Apple Silicon; null where ClipCat doesn't use it. */
  parakeet: ToolInfo.nullable(),
  /** The H.264 encoder exports use: a hardware one, or libx264. */
  encoder: z.string(),
});

export const AgentStatus = z.object({
  status: z.enum(["ready", "not-installed", "signed-out", "outdated"]),
  version: z.string().nullable(),
  /** What to do about it, when it isn't ready. */
  detail: z.string().nullable(),
});

/** The AI editors ClipCat can drive: Claude Code, Codex, or the Claude API with the user's key. */
export const AgentName = z.enum(["claude", "codex", "api"]);

/** Claude models for the API; Opus first. */
export const ApiModel = z.enum(["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);

/** The Claude API's state: whether a key is saved, and which model it uses. */
export const ApiStatus = z.object({ hasKey: z.boolean(), model: ApiModel });

/** Each agent's state, and which one finds cuts. */
export const AiStatus = z.object({ claude: AgentStatus, codex: AgentStatus, api: ApiStatus, agent: AgentName });

/** App-wide settings. */
const Term = z.string().trim().min(1).max(60);

export const Settings = z.object({
  /** Which of the user's agents finds cuts. */
  agent: AgentName.default("claude"),
  /** Names and terms the user says a lot, spelled right: a hint for transcription and corrections. */
  dictionary: z.array(Term).max(200).default([]),
  /** The model the Claude API runs; the key itself is kept apart, encrypted. */
  apiModel: ApiModel.default("claude-opus-5-5"),
});

export const ProjectSummary = z.object({
  id: z.string(),
  name: z.string(),
  updatedAt: z.string(),
  duration: z.number(),
  sources: z.number().int(),
  thumb: z.string().nullable(),
  /** For a short, the name of the project it was cut from. */
  origin: z.string().nullable(),
});

export const JobEvent = z.object({
  projectId: z.string(),
  jobId: z.string(),
  kind: z.string(),
  label: z.string(),
  state: z.enum(["queued", "running", "done", "failed", "cancelled"]),
  fraction: z.number().nullable(),
  error: z.string().optional(),
});

const ProjectRef = z.object({ id: z.string().regex(/^[a-zA-Z0-9-]+$/) });
/** Absolute paths, as the file picker or a drop gives them. */
const Files = z.array(z.string().min(1).max(4096)).min(1).max(200);

export const methods = {
  "app:info": { input: z.void(), output: AppInfo },
  /** The renderer reports it has drawn its first screen; used by the smoke test. */
  "app:ready": { input: z.object({ screen: z.string() }), output: z.void() },
  "library:list": { input: z.void(), output: z.array(ProjectSummary) },
  /** Opens the system file picker; resolves with the chosen files, or [] when cancelled. */
  "files:pick": { input: z.void(), output: z.array(z.string()) },
  /** Opens the system file picker for b-roll pictures and videos; [] when cancelled. */
  "media:pick": { input: z.void(), output: z.array(z.string()) },
  /** Adds pictures and videos to a project's b-roll media, then prepares and describes them. */
  "project:add-media": { input: ProjectRef.extend({ files: Files }), output: Project },
  /** Asks for a music file; resolves with its path, or null when cancelled. */
  "music:pick": { input: z.void(), output: z.string().nullable() },
  /** Puts the music file under the video (replacing any), and queues a copy for the preview. */
  "project:set-music": { input: ProjectRef.extend({ file: z.string().min(1).max(4096) }), output: Project },
  /** Adds files to a project (a new one when projectId is null) and starts processing them. */
  "project:import": { input: z.object({ projectId: z.string().regex(/^[a-zA-Z0-9-]+$/).nullable(), files: Files }), output: Project },
  "project:get": { input: ProjectRef, output: Project },
  "project:remove": { input: ProjectRef, output: z.void() },
  /** Whether the user's AI editor is installed and signed in. Probing runs the CLI, so it takes a moment. */
  "ai:status": { input: z.void(), output: AiStatus },
  /** Changes app-wide settings; resolves with all of them. */
  "settings:get": { input: z.void(), output: Settings },
  "settings:set": { input: z.object({ agent: AgentName, dictionary: z.array(Term).max(200), apiModel: ApiModel }).partial(), output: Settings },
  /** Checks and saves a Claude API key (encrypted), or removes it with null. */
  "settings:api-key": { input: z.object({ key: z.string().trim().min(10).max(500).nullable() }), output: ApiStatus },
  /** Saves the brief and queues an AI pass that proposes retake, cleanup and tighten cuts. */
  "project:analyze": { input: ProjectRef.extend({ brief: z.string().max(4000) }), output: z.void() },
  /** Queues cuts for one request ("cut the part about pricing"), added to the ones waiting. */
  "project:request": { input: ProjectRef.extend({ request: z.string().trim().min(1).max(1000) }), output: z.void() },
  /** Queues an AI pass that writes the chapters, the description and an article from the edited video. */
  "project:writeup": { input: ProjectRef, output: z.void() },
  /** Asks where to save the article, then writes it there as Markdown. Resolves with the path, or null when cancelled. */
  "project:save-article": { input: ProjectRef, output: z.object({ path: z.string().nullable() }) },
  /** Queues designing the project's slides that have no design yet (one that failed, say). */
  "project:design-slides": { input: ProjectRef, output: z.void() },
  /** Queues a pass that fixes misheard names and terms, using the dictionary. */
  "project:correct": { input: ProjectRef, output: z.void() },
  /** Queues an AI pass that picks up to `count` shorts of at most `seconds` each, each saved as its own vertical project. */
  "project:shorts": {
    input: ProjectRef.extend({ count: z.number().int().min(1).max(10), seconds: z.union([z.literal(30), z.literal(60), z.literal(90)]) }),
    output: z.void(),
  },
  /**
   * One transcript-editor change. `revision` is the project the UI is showing;
   * if anything saved since, the edit is refused and the UI reloads.
   */
  "project:edit": { input: ProjectRef.extend({ revision: z.number().int().nonnegative(), op: EditOp }), output: Project },
  /**
   * Asks where to save, then queues an export in that shape. Resolves with
   * the chosen path, or null when the save dialog was cancelled.
   */
  "project:export": { input: ProjectRef.extend({ format: z.enum(["16:9", "9:16"]) }), output: z.object({ path: z.string().nullable() }) },
  /** Shows the project's last export in Finder or Explorer. */
  "project:reveal-export": { input: ProjectRef, output: z.void() },
  /** Cancels the project's queued and running jobs. */
  "jobs:cancel": { input: ProjectRef, output: z.void() },
} as const;

/** Pushed from main to the UI. */
export const events = {
  job: JobEvent,
  "project:changed": z.object({ id: z.string(), revision: z.number().int() }),
} as const;

export type Events = typeof events;
export type EventName = keyof Events;
export type EventPayload<E extends EventName> = z.output<Events[E]>;
export const eventChannelFor = (event: EventName): string => `${EVENT_PREFIX}${event}`;

export type Methods = typeof methods;
export type MethodName = keyof Methods;
export type Input<M extends MethodName> = z.input<Methods[M]["input"]>;
export type Output<M extends MethodName> = z.output<Methods[M]["output"]>;

export { CHANNEL_PREFIX, EVENT_PREFIX };
export const channelFor = (method: MethodName): string => `${CHANNEL_PREFIX}${method}`;

export const isMethodName = (name: string): name is MethodName => Object.hasOwn(methods, name);

/** What the preload script puts on `window.clipcat`. */
export interface ClipcatBridge {
  invoke<M extends MethodName>(method: M, ...input: Input<M> extends void ? [] : [Input<M>]): Promise<Output<M>>;
  /** Subscribes to a pushed event; returns the unsubscribe function. */
  on<E extends EventName>(event: E, listener: (payload: EventPayload<E>) => void): () => void;
  /** The path of a file dropped onto the window (Electron hides it from the page). */
  pathForFile(file: File): string;
}

export type AppInfoValue = z.output<typeof AppInfo>;
export type ToolInfoValue = z.output<typeof ToolInfo>;
export type ProjectSummaryValue = z.output<typeof ProjectSummary>;
export type JobEventValue = z.output<typeof JobEvent>;
export type AgentStatusValue = z.output<typeof AgentStatus>;
export type AiStatusValue = z.output<typeof AiStatus>;
export type AgentNameValue = z.output<typeof AgentName>;
export type ApiModelValue = z.output<typeof ApiModel>;
export type ApiStatusValue = z.output<typeof ApiStatus>;
export type SettingsValue = z.output<typeof Settings>;
