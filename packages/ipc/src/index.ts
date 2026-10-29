// The one contract between the main process and the UI. Every method the
// renderer can call is named here with a zod schema for its input and its
// result; main validates both, so a typo or a stale UI fails loudly instead
// of reaching the file system.

import { z } from "zod";
import { EditOp, Project, isSpeechLanguage } from "@clipcat/core";
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

/** A model picked for Claude Code or Codex; null runs the CLI's own default. */
export const AgentModel = z.string().trim().min(1).max(100).regex(/^[\w.:/[\]-]+$/).nullable();

/** A model the user can pick for an agent CLI. */
export const ModelChoice = z.object({ id: z.string(), label: z.string() });

/** The models an agent CLI offers, the one it runs when none is picked (null when it doesn't say), and the pick. */
export const AgentModels = z.object({ choices: z.array(ModelChoice), fallback: z.string().nullable(), selected: AgentModel });

/** Each agent's state, its models, and which one finds cuts. */
export const AiStatus = z.object({
  claude: AgentStatus,
  codex: AgentStatus,
  api: ApiStatus,
  agent: AgentName,
  models: z.object({ claude: AgentModels, codex: AgentModels }),
});

/** A speech language code ClipCat knows, or "auto". */
export const SpeechLanguageCode = z.string().refine(isSpeechLanguage, "Pick a language from the list.");

/** "auto" uses Parakeet for the languages it knows on Apple Silicon and whisper for the rest; "whisper" always uses whisper. */
export const SpeechEngine = z.enum(["auto", "whisper"]);

/** The whisper models ClipCat offers. */
export const WhisperModel = z.enum(["large-v3-turbo-q5_0", "base"]);

/** Every speech model ClipCat can download: Parakeet and the whisper models. */
export const SpeechModelId = z.enum(["parakeet", "large-v3-turbo-q5_0", "base"]);

/** One speech model and whether it's on this computer. */
export const SpeechModel = z.object({
  id: SpeechModelId,
  label: z.string(),
  /** Roughly how big the download is. */
  approxMB: z.number(),
  /** Bytes on disk; 0 when it isn't downloaded. */
  bytes: z.number().nonnegative(),
  downloaded: z.boolean(),
});

/** The speech models this computer can use (Parakeet only on Apple Silicon). */
export const SpeechModels = z.array(SpeechModel);

/** App-wide settings. */
const Term = z.string().trim().min(1).max(60);

export const Settings = z.object({
  /** Which of the user's agents finds cuts. */
  agent: AgentName.default("claude"),
  /** Names and terms the user says a lot, spelled right: a hint for transcription and corrections. */
  dictionary: z.array(Term).max(200).default([]),
  /** The model the Claude API runs; the key itself is kept apart, encrypted. */
  apiModel: ApiModel.default("claude-opus-5-5"),
  /** The model Claude Code runs; null is Claude Code's own default. */
  claudeModel: AgentModel.default(null),
  /** The model Codex runs; null is the default in the user's ~/.codex/config.toml. */
  codexModel: AgentModel.default(null),
  /** The language new projects are transcribed in. */
  speechLanguage: SpeechLanguageCode.default("en"),
  speechEngine: SpeechEngine.default("auto"),
  /** The whisper model, for the languages Parakeet doesn't know and for Intel Macs and Windows. */
  whisperModel: WhisperModel.default("large-v3-turbo-q5_0"),
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

/** The agent command-line tools ClipCat can install and update. */
export const CliId = z.enum(["claude", "codex"]);

/** One CLI, as Settings shows it: the user's copy, the newest release, and what its button does. */
export const CliStatus = z.object({
  id: CliId,
  label: z.string(),
  /** The `claude` or `codex` the user's terminal runs; null when there is none. */
  path: z.string().nullable(),
  version: z.string().nullable(),
  source: z.enum(["native", "npm", "bun", "brew", "winget", "app", "unknown"]).nullable(),
  /** The newest release on the copy's channel; null when it couldn't be checked. */
  latest: z.string().nullable(),
  action: z.enum(["install", "update"]).nullable(),
  /** The command the button runs, as it would be typed in a terminal. */
  command: z.string().nullable(),
  /** Why ClipCat can't update this copy itself, and what to do instead. */
  manual: z.string().nullable(),
  /** A problem beyond being old, such as an older Codex than the app sharing its config. */
  warning: z.string().nullable(),
});

/** The coding agents ClipCat can register its MCP server with. */
export const McpAgentId = z.enum(["claude-code", "claude-desktop", "codex"]);

/** One agent, as the settings screen shows it: is it on this computer, and does its config have ClipCat in it. */
export const McpAgent = z.object({
  id: McpAgentId,
  label: z.string(),
  detected: z.boolean(),
  connected: z.boolean(),
  /** The config file ClipCat writes to. */
  config: z.string(),
  /** Why it can't be connected from this build, or null when it can. */
  unavailable: z.string().nullable(),
  /** What Connect writes into that file, as the file spells it, for the confirm step. */
  entry: z.string(),
  /** Whether the agent has an MCP session open with ClipCat now, and when one last started. */
  session: z.object({
    live: z.boolean(),
    /** ISO time of the last session that started, or null when the agent has never reached this copy. */
    lastAt: z.string().nullable(),
    /** The client's own name and version from that session's handshake, e.g. "claude-code 2.1.312". */
    client: z.string().nullable(),
  }),
});

/** One step of checking an agent's connection: is the entry saved, does it reach ClipCat, does the agent itself see it. Whether the agent has used it is `McpAgent.session`. */
export const McpCheckStep = z.object({
  id: z.enum(["saved", "reaches", "agent"]),
  /** ok: proved; failed: proved broken; waiting: needs the person (restart the agent); skipped: can't be checked from here. */
  state: z.enum(["ok", "failed", "waiting", "skipped"]),
  text: z.string(),
});

/** Where updating stands: off (a dev copy, or no feed), checking, downloading, ready to restart, or a newer version to download by hand. */
/** What a menu bar item asks the window to do. */
export const MenuCommand = z.enum([
  "settings",
  "new-recording",
  "import",
  "open-project",
  "add-videos",
  "export",
  "tab-edit",
  "tab-look",
  "tab-publish",
  "tab-export",
  "hide-cuts",
  "undo",
  "redo",
  "play-pause",
  "play-backwards",
  "pause",
  "play-forwards",
  "back-frame",
  "forward-frame",
  "back-second",
  "forward-second",
]);

/** What the window shows, so the menu bar can match it: the open project, or null on any other screen. */
export const MenuState = z.object({
  project: z
    .object({ id: z.string().regex(/^[a-zA-Z0-9-]+$/), canUndo: z.boolean(), canRedo: z.boolean(), hideCuts: z.boolean() })
    .nullable(),
});

export const UpdateStatus = z.object({
  state: z.enum(["off", "idle", "checking", "downloading", "ready", "available", "error"]),
  /** The newer version, once known. */
  version: z.string().nullable(),
  detail: z.string().nullable(),
  /** The release page, for downloading by hand. */
  page: z.string().nullable(),
  checkedAt: z.string().nullable(),
});

/** A screen ClipCat can record, as the picker shows it. */
export const RecordScreen = z.object({
  /** desktopCapturer's source id, for recording through Chromium. */
  id: z.string(),
  /** The system's display id, for the macOS recorder. */
  displayId: z.string(),
  name: z.string(),
  /** A small picture of what's on it, as a data URL. */
  thumbnail: z.string(),
});

/** What recording can do on this computer. */
export const RecordSetup = z.object({
  screens: z.array(RecordScreen),
  /** Whether the screen is recorded by the macOS recorder (macOS 15) rather than through Chromium. */
  native: z.boolean(),
  /** Whether the computer's own sound can be recorded with the screen. */
  systemAudio: z.boolean(),
  /** macOS's answer for screen recording; "granted" elsewhere. */
  screenAccess: z.enum(["granted", "denied", "not-determined", "restricted", "unknown"]),
});

export const RecordKind = z.enum(["camera", "screen", "voice"]);

const Token = z.string().uuid();

const ProjectRef = z.object({ id: z.string().regex(/^[a-zA-Z0-9-]+$/) });
/** A picture the editor drew, as base64 PNG. */
const Png = z.string().min(1).max(30_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/);
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
  /** Renames a project; a short's entry in its long video, and a long video's name on its shorts, follow. */
  "project:rename": { input: ProjectRef.extend({ name: z.string().trim().min(1).max(200) }), output: Project },
  /** Shows the project's folder in Finder or Explorer. */
  "project:reveal": { input: ProjectRef, output: z.void() },
  /** Whether the user's AI editor is installed and signed in. Probing runs the CLI, so it takes a moment. */
  "ai:status": { input: z.void(), output: AiStatus },
  /** Changes app-wide settings; resolves with all of them. */
  "settings:get": { input: z.void(), output: Settings },
  "settings:set": {
    input: z
      .object({
        agent: AgentName,
        dictionary: z.array(Term).max(200),
        apiModel: ApiModel,
        claudeModel: AgentModel,
        codexModel: AgentModel,
        speechLanguage: SpeechLanguageCode,
        speechEngine: SpeechEngine,
        whisperModel: WhisperModel,
      })
      .partial(),
    output: Settings,
  },
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
  /** Queues grabbing this moment of a recording for the thumbnail and cutting its subject out. */
  "project:thumbnail-frame": { input: ProjectRef.extend({ sourceId: z.string().min(1).max(200), time: z.number().nonnegative() }), output: z.void() },
  /** Asks where to save the thumbnail the editor drew (a base64 PNG), then writes it. Resolves with the path, or null when cancelled. */
  "project:save-thumbnail": {
    input: ProjectRef.extend({ png: Png }),
    output: z.object({ path: z.string().nullable() }),
  },
  /** Queues designing the project's slides that have no design yet (one that failed, say). */
  "project:design-slides": { input: ProjectRef, output: z.void() },
  /** Sets the project's speech language and transcribes every recording in it again. */
  "project:language": { input: ProjectRef.extend({ language: SpeechLanguageCode }), output: Project },
  /** The speech models this computer can use, and which are downloaded. */
  "speech:models": { input: z.void(), output: SpeechModels },
  /** Downloads a speech model now rather than on first use; progress comes as speech:progress events. */
  "speech:download": { input: z.object({ id: SpeechModelId }), output: SpeechModels },
  /** Deletes a downloaded speech model to free the space; it downloads again when it's next needed. */
  "speech:remove": { input: z.object({ id: SpeechModelId }), output: SpeechModels },
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
   * Asks where to save, then queues an export in that shape. `cover`, the
   * thumbnail the editor drew for that shape, becomes the file's cover art.
   * Resolves with the chosen path, or null when the save dialog was cancelled.
   */
  "project:export": {
    input: ProjectRef.extend({ format: z.enum(["16:9", "9:16"]), cover: Png.nullable().optional() }),
    output: z.object({ path: z.string().nullable() }),
  },
  /**
   * Asks where to save, then writes the edit as a timeline another editor opens:
   * FCPXML (Final Cut Pro, Resolve), Final Cut 7 XML (Premiere Pro) or an EDL.
   * Resolves with the path, or null when cancelled.
   */
  "project:export-timeline": { input: ProjectRef.extend({ format: z.enum(["fcpxml", "premiere", "edl"]) }), output: z.object({ path: z.string().nullable() }) },
  /** Shows the project's last export in Finder or Explorer. */
  "project:reveal-export": { input: ProjectRef, output: z.void() },
  /** Cancels the project's queued and running jobs. */
  "jobs:cancel": { input: ProjectRef, output: z.void() },
  /** Screens to record, and what recording can do here. Listing screens may make macOS ask for screen recording access. */
  "record:setup": { input: z.void(), output: RecordSetup },
  /** Asks the system for camera or microphone access (macOS asks once); resolves with whether it's granted. */
  "record:access": { input: z.object({ kind: z.enum(["camera", "microphone"]) }), output: z.boolean() },
  /** Opens the system's privacy settings at camera, microphone or screen recording. */
  "record:privacy": { input: z.object({ kind: z.enum(["camera", "microphone", "screen"]) }), output: z.void() },
  /** Picks the screen (and whether to take the computer's sound) that the UI's next getDisplayMedia call gets. */
  "record:pick-screen": { input: z.object({ screenId: z.string().min(1).max(200), systemAudio: z.boolean() }), output: z.void() },
  /** Starts a recording the UI streams chunks into, in this MediaRecorder MIME type. */
  "record:begin": { input: z.object({ kind: RecordKind, mimeType: z.string().max(200) }), output: z.object({ token: Token }) },
  /** Starts recording a screen with the macOS recorder. Resolves once it's recording. */
  "record:native": {
    input: z.object({ displayId: z.string().regex(/^\d+$/), mic: z.boolean(), micName: z.string().max(300).nullable(), systemAudio: z.boolean() }),
    output: z.object({ token: Token }),
  },
  /** One chunk of a recording, base64. */
  "record:chunk": { input: z.object({ token: Token, data: z.string().max(40_000_000).regex(/^[A-Za-z0-9+/]*={0,2}$/) }), output: z.void() },
  /** Stops and keeps the recording, then imports it into the project (a new one when projectId is null). */
  "record:end": { input: z.object({ token: Token, projectId: z.string().regex(/^[a-zA-Z0-9-]+$/).nullable() }), output: Project },
  /** Stops and throws the recording away. */
  "record:discard": { input: z.object({ token: Token }), output: z.void() },
  "update:status": { input: z.void(), output: UpdateStatus },
  /** Looks for a newer version now. */
  "update:check": { input: z.void(), output: UpdateStatus },
  /** Restarts into the downloaded update. */
  "update:install": { input: z.void(), output: z.void() },
  /** Opens the release page in the browser. */
  "update:open": { input: z.void(), output: z.void() },
  /** Saves a zip of logs, versions and project shapes (no transcripts or media) where the user picks; null when cancelled. */
  "app:diagnostics": { input: z.void(), output: z.object({ path: z.string().nullable() }) },
  /** Shows the log folder. */
  "app:reveal-logs": { input: z.void(), output: z.void() },
  /** Tells the menu bar what the window shows, so project items turn on and off and Open Recent stays current. */
  "menu:state": { input: MenuState, output: z.void() },
  /** Opens the Help window at one page of the help (docs/<page>.md; "" for the overview). */
  "help:open": { input: z.object({ page: z.string().regex(/^[a-z0-9-]*$/).max(60) }), output: z.void() },
  /** Where an agent CLI stands: installed version, newest release, and what Install or Update would run. */
  "cli:status": { input: z.object({ id: CliId }), output: CliStatus },
  /** Installs or updates an agent CLI with its official method; progress comes as cli:progress events. */
  "cli:run": { input: z.object({ id: CliId }), output: CliStatus },
  /** The coding agents ClipCat's MCP server can be added to, and which have it. */
  "mcp:status": { input: z.void(), output: z.array(McpAgent) },
  /** Adds ClipCat's MCP server to an agent's config (connect: true) or takes it out; resolves with every agent's state. */
  "mcp:connect": { input: z.object({ agent: McpAgentId, connect: z.boolean() }), output: z.array(McpAgent) },
  /** Checks one agent's connection for real: reads its config back, runs that entry through to ClipCat, and asks the agent's CLI. */
  "mcp:check": { input: z.object({ agent: McpAgentId }), output: z.array(McpCheckStep) },
} as const;

/** Pushed from main to the UI. */
export const events = {
  job: JobEvent,
  "project:changed": z.object({ id: z.string(), revision: z.number().int() }),
  update: UpdateStatus,
  /** The latest line from a running CLI install or update. */
  "cli:progress": z.object({ id: CliId, line: z.string() }),
  /** How far a speech model download has got, 0 to 1 (null while Parakeet compiles). */
  "speech:progress": z.object({ id: SpeechModelId, fraction: z.number().nullable() }),
  /** An agent opened or closed an MCP session: every agent's state. */
  "mcp:agents": z.array(McpAgent),
  /** A menu bar item was chosen; projectId is the project for Open Recent. */
  menu: z.object({ command: MenuCommand, projectId: z.string().optional() }),
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
export type MenuCommandValue = z.output<typeof MenuCommand>;
export type MenuStateValue = z.output<typeof MenuState>;
export type ToolInfoValue = z.output<typeof ToolInfo>;
export type ProjectSummaryValue = z.output<typeof ProjectSummary>;
export type JobEventValue = z.output<typeof JobEvent>;
export type SpeechModelValue = z.output<typeof SpeechModel>;
export type SpeechModelIdValue = z.output<typeof SpeechModelId>;
export type AgentStatusValue = z.output<typeof AgentStatus>;
export type AiStatusValue = z.output<typeof AiStatus>;
export type AgentNameValue = z.output<typeof AgentName>;
export type ApiModelValue = z.output<typeof ApiModel>;
export type ApiStatusValue = z.output<typeof ApiStatus>;
export type AgentModelsValue = z.output<typeof AgentModels>;
export type CliIdValue = z.output<typeof CliId>;
export type CliStatusValue = z.output<typeof CliStatus>;
export type SettingsValue = z.output<typeof Settings>;
export type UpdateStatusValue = z.output<typeof UpdateStatus>;
export type RecordSetupValue = z.output<typeof RecordSetup>;
export type RecordScreenValue = z.output<typeof RecordScreen>;
export type RecordKindValue = z.output<typeof RecordKind>;
export type McpAgentIdValue = z.output<typeof McpAgentId>;
export type McpAgentValue = z.output<typeof McpAgent>;
export type McpCheckStepValue = z.output<typeof McpCheckStep>;
