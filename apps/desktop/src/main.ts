// ClipCat's main process: one window, the UI on app://clipcat, prepared media
// on media://, sound effects on sound://, the cutout model on model://, the
// IPC handlers, the MCP socket outside agents drive it through, and the
// recordings in progress. All media work lives here, never in the renderer.

import { BrowserWindow, Menu, app, autoUpdater, crashReporter, desktopCapturer, dialog, nativeTheme, net, safeStorage, session, shell, systemPreferences } from "electron";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { type Article, type EditOp, TIMELINE_FORMATS, type TimelineFormat, applyEdit } from "@clipcat/core";
import tokens from "../../../design/tokens.json";
import { homedir, release, totalmem } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import type { AppInfoValue, KeyedProviderValue, MenuCommandValue, MenuStateValue, SettingsValue } from "@clipcat/ipc";
import { AnalysisRunner } from "./ai/analyze";
import { apiAgent, verifyKey } from "./ai/api";
import { CLAUDE_MODELS, claudeAgent, probeClaude } from "./ai/claude";
import { type CliDeps, cliStatus, runCli } from "./ai/cli";
import { codexAgent, codexModels, probeCodex, resolveCodex } from "./ai/codex";
import { type ModelChoice, listModels, providerAgent, verifyProviderKey } from "./ai/openai";
import { hydrateEnv } from "./ai/env";
import { type Binary, binaryPath, probeVersion } from "./tools";
import { broadcast, registerIpc, send } from "./ipc";
import { JobLog } from "./jobs/log";
import { JobQueue } from "./jobs/queue";
import { BACKGROUND_ARG } from "./mcp/config";
import { type InstallEnv, connectAgent, healRegistrations, mcpSetup, mcpStatus, serverSpec } from "./mcp/install";
import { checkAgent } from "./mcp/check";
import { createMcpServer } from "./mcp/server";
import { SessionLog } from "./mcp/sessions";
import { listen, socketPath } from "./mcp/socket";
import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from "./media/assets";
import { MUSIC_EXTENSIONS } from "./media/music";
import { encoderTestArgs, lazyEncoder, pickEncoder } from "./media/encoders";
import { runFfmpeg } from "./media/run";
import { inspectStreams } from "./media/probe";
import { startNative } from "./record/native";
import { RecordingSessions } from "./record/sessions";
import { closeCutout, cutout, cutoutProblem, setCutoutPage } from "./cutout";
import { closeFaceDetector, faceDetector, faceDetectorProblem, setFacePage } from "./faceDetector";
import { AssetPipeline } from "./pipeline/assets";
import { realAssetDeps, realDeps, realMusicDeps, realThumbnailDeps } from "./pipeline/deps";
import { ExportRunner } from "./pipeline/export";
import { ImportPipeline } from "./pipeline/import";
import { MusicPipeline } from "./pipeline/music";
import { ThumbnailPipeline } from "./pipeline/thumbnail";
import { APP_ORIGIN, registerSchemes, serveMedia, serveModels, serveSlides, serveSounds, serveUi } from "./protocol";
import { SLIDE_COLORS, SLIDE_CSP, SLIDE_FONTS, fontFaces, slidePage } from "./slides/page";
import { renderStills, renderVideo } from "./slides/render";
import { diagnosticsZip } from "./diagnostics/bundle";
import { MainLog } from "./diagnostics/log";
import { RELEASES_URL, issueUrl, openHelp } from "./help";
import { menuTemplate } from "./menu";
import { handleSquirrelEvent } from "./squirrel";
import { Updater } from "./update";
import { ProjectStore } from "./store/projects";
import { KeyStore } from "./store/keys";
import { RecentProjects } from "./store/recent";
import { SettingsStore } from "./store/settings";
import { SpeechLibrary } from "./transcribe/library";
import type { ModelId } from "./transcribe/models";
import { startSmokeTimer, finishSmoke, isSmokeRun, recordSmokeJob, smokeImport, smokeMcp } from "./smoke";

const squirrelLaunch = handleSquirrelEvent();

// Warnings, errors and crashes go to a log file from the first moment, and crash
// dumps stay on this computer; both end up in the diagnostics bundle.
const mainLog = new MainLog(join(app.getPath("userData"), "logs", "main.log"));
if (!squirrelLaunch) {
  mainLog.capture();
  crashReporter.start({ uploadToServer: false });
  app.on("render-process-gone", (_event, contents, details) => mainLog.write("error", `renderer gone (${contents.getURL()}):`, details));
  app.on("child-process-gone", (_event, details) => mainLog.write("error", "child process gone:", details));
}

/** The release feed this copy updates from (apps/desktop/package.json `clipcat.updateFeed`), or null for none. */
function updateFeed(): string | null {
  if (process.env.CLIPCAT_UPDATE_FEED) return process.env.CLIPCAT_UPDATE_FEED;
  try {
    const pkg = JSON.parse(readFileSync(join(app.getAppPath(), "package.json"), "utf8")) as { clipcat?: { updateFeed?: unknown } };
    return typeof pkg.clipcat?.updateFeed === "string" ? pkg.clipcat.updateFeed : null;
  } catch {
    return null;
  }
}

const DEV_URL = process.env.CLIPCAT_DEV_URL ?? null;
const UI_ROOT = join(__dirname, "..", "ui");
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

app.setName("ClipCat");
registerSchemes();

const tool = (name: Binary) =>
  binaryPath(name, {
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    repoRoot: REPO_ROOT,
    platform: process.platform,
    arch: process.arch,
  });

async function toolInfo(name: Binary) {
  const path = tool(name);
  const version = await probeVersion(path);
  return { available: version !== null, version, path };
}

/** The hardware H.264 encoder this machine has, found on first use by encoding a test clip with each candidate. */
const encoder = lazyEncoder(() =>
  pickEncoder(process.platform, (e) =>
    runFfmpeg(tool("ffmpeg"), encoderTestArgs(e), { duration: 0, signal: AbortSignal.timeout(20_000) }).then(
      () => true,
      () => false,
    ),
  ),
);

/** Parakeet is built for Apple Silicon only (it runs on the Neural Engine); Intel Macs and CLIPCAT_TRANSCRIBER=whisper use whisper.cpp. */
const PARAKEET = process.platform === "darwin" && process.arch === "arm64" && process.env.CLIPCAT_TRANSCRIBER !== "whisper";

async function appInfo(): Promise<AppInfoValue> {
  const [ffmpeg, whisper, parakeet] = await Promise.all([
    toolInfo("ffmpeg"),
    toolInfo("whisper-cli"),
    PARAKEET ? toolInfo("clipcat-parakeet") : null,
  ]);
  return { name: "ClipCat", version: app.getVersion(), platform: process.platform, arch: process.arch, ffmpeg, whisper, parakeet, encoder: await encoder() };
}

/** The macOS recorder needs ScreenCaptureKit's recording output, new in macOS 15 (Darwin 24). */
const NATIVE_SCREEN = process.platform === "darwin" && Number(release().split(".")[0]) >= 24;

/** The system settings page that grants camera, microphone or screen recording. */
function privacyPane(kind: "camera" | "microphone" | "screen"): string {
  if (process.platform === "win32") return kind === "camera" ? "ms-settings:privacy-webcam" : "ms-settings:privacy-microphone";
  const pane = { camera: "Privacy_Camera", microphone: "Privacy_Microphone", screen: "Privacy_ScreenCapture" }[kind];
  return `x-apple.systempreferences:com.apple.preference.security?${pane}`;
}

/** CI forces the small whisper model; everyone else gets the one picked in Settings. */
const FORCED_MODEL: ModelId | null = process.env.CLIPCAT_MODEL === "base" ? "base" : null;

/** The user's PATH from their login shell, read once; the agent CLIs are found on it. */
const hostEnv = hydrateEnv();

const FONTS_DIR = app.isPackaged ? join(process.resourcesPath, "fonts") : join(REPO_ROOT, "apps", "desktop", "resources", "fonts");
const SFX_DIR = app.isPackaged ? join(process.resourcesPath, "sfx") : join(REPO_ROOT, "apps", "desktop", "resources", "sfx");
/** The cutout model; in development, where npm run fetch:cutout puts it. */
const MODELS_DIR = app.isPackaged ? join(process.resourcesPath, "models") : join(REPO_ROOT, "vendor", "models");

/** Slides being designed, served on slide://draft/<token> while their stills render. */
const drafts = new Map<string, string>();
let slideFonts: string | null = null;
const slideHtml = (body: string, look: Parameters<typeof slidePage>[1]) => {
  slideFonts ??= fontFaces(SLIDE_FONTS.map((font) => ({ font, data: readFileSync(join(FONTS_DIR, font.file)) })));
  return slidePage(body, look, slideFonts);
};

function startPipeline() {
  const data = app.getPath("userData");
  const store = new ProjectStore(join(data, "projects"));
  const settings = new SettingsStore(join(data, "settings.json"));
  const cipher = {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain: string) => safeStorage.encryptString(plain),
    decrypt: (data: Buffer) => safeStorage.decryptString(data),
  };
  const keys = new KeyStore(join(data, "claude-api-key"), cipher);
  // One encrypted file per provider, beside the Claude key.
  const providerKeys: Record<KeyedProviderValue, KeyStore> = {
    openai: new KeyStore(join(data, "openai-api-key"), cipher),
    openrouter: new KeyStore(join(data, "openrouter-api-key"), cipher),
  };
  const jobs = new JobLog();
  const queue = new JobQueue((event) => {
    if (isSmokeRun()) recordSmokeJob(event);
    if (event.state === "failed") mainLog.write("warn", `job ${event.kind} failed for ${event.projectId}:`, event.error ?? "");
    jobs.record(event);
    broadcast("job", event);
  });
  const changed = (p: { id: string; revision: number }) => broadcast("project:changed", { id: p.id, revision: p.revision });
  const analysis = new AnalysisRunner({
    store,
    queue,
    agent: async () => {
      const host = await hostEnv;
      const { agent, claudeModel, codexModel } = await settings.get();
      if (agent === "api") return apiAgent({ key: () => keys.get(), model: async () => (await settings.get()).apiModel });
      if (agent === "openai" || agent === "openrouter") {
        const model = async () => {
          const current = await settings.get();
          return agent === "openai" ? current.openaiModel : current.openrouterModel;
        };
        return providerAgent(agent, { key: () => providerKeys[agent].get(), model });
      }
      if (agent === "codex") {
        const status = await probeCodex(host);
        if (status.status !== "ready") throw new Error(status.detail ?? "Codex isn't ready");
        return codexAgent(host, codexModel);
      }
      const status = await probeClaude(host);
      if (status.status !== "ready") throw new Error(status.detail ?? "Claude Code isn't ready");
      return claudeAgent(host, app.getVersion(), claudeModel);
    },
    dictionary: async () => (await settings.get()).dictionary,
    changed,
    slides: {
      stills: async (draft, frame, times, files) => {
        const token = randomUUID();
        drafts.set(token, slideHtml(draft.html, draft.look));
        try {
          // An overlay slide is checked over a mid tone, standing in for the video behind it.
          return await renderStills(`slide://draft/${token}`, frame, times, files, 1280, draft.look === "overlay" ? SLIDE_COLORS.muted : undefined);
        } finally {
          drafts.delete(token);
        }
      },
    },
    forget: (projectId, assetId) => void media.forget(projectId, assetId),
  });
  // CI points this at a cached folder so each run doesn't download the model again.
  const modelsDir = process.env.CLIPCAT_MODELS_DIR ?? join(data, "models");
  const parakeetBin = PARAKEET && existsSync(tool("clipcat-parakeet")) ? tool("clipcat-parakeet") : null;
  const speech = new SpeechLibrary({ modelsDir, parakeet: parakeetBin, onProgress: (id, fraction) => broadcast("speech:progress", { id, fraction }) });
  const pipeline = new ImportPipeline({
    ...realDeps({
      ffmpeg: tool("ffmpeg"),
      ffprobe: tool("ffprobe"),
      whisper: tool("whisper-cli"),
      parakeet: parakeetBin,
      modelsDir,
      model: async () => FORCED_MODEL ?? (await settings.get()).whisperModel,
      engine: async () => (await settings.get()).speechEngine,
      encoder,
      dictionary: async () => (await settings.get()).dictionary,
      faceDetector,
    }),
    language: async () => (await settings.get()).speechLanguage,
    store,
    queue,
    changed,
  });
  const media = new AssetPipeline({
    ...realAssetDeps({ ffmpeg: tool("ffmpeg"), ffprobe: tool("ffprobe"), encoder }),
    store,
    queue,
    changed,
    describe: (id) => analysis.describe(id),
  });
  const music = new MusicPipeline({ ...realMusicDeps({ ffmpeg: tool("ffmpeg"), ffprobe: tool("ffprobe") }), store, queue, changed });
  const thumbnail = new ThumbnailPipeline({ ...realThumbnailDeps({ ffmpeg: tool("ffmpeg") }), cutout, store, queue, changed });
  const exporter = new ExportRunner({
    store,
    queue,
    changed,
    ffmpeg: (args, { cwd, duration, ctx }) =>
      runFfmpeg(tool("ffmpeg"), args, { cwd, duration, onProgress: (f) => ctx.progress(f), signal: ctx.signal }),
    encoder,
    fontsDir: FONTS_DIR,
    sfxDir: SFX_DIR,
    renderSlide: (projectId, asset, size, fps, out, ctx) =>
      renderVideo(tool("ffmpeg"), `slide://${projectId}/${asset.id}`, size, fps, asset.media.duration, out, { signal: ctx.signal, progress: (f) => ctx.progress(f) }),
  });
  /** One edit, from the transcript editor or an outside agent: applied and saved if `revision` is still current, then announced. */
  const edit = async (id: string, revision: number, op: EditOp) => {
    const next = await store.update(id, revision, (p) => applyEdit(p, op, () => `g${randomUUID().slice(0, 8)}`));
    broadcast("project:changed", { id, revision: next.revision });
    if (op.type === "remove-asset") void media.forget(id, op.assetId);
    if (op.type === "remove-music") void music.forget(id);
    if (op.type === "slide" || op.type === "describe") void analysis.designMissing(id);
    return next;
  };
  const recordings = new RecordingSessions({
    tempDir: join(data, "recordings"),
    outDir: join(app.getPath("videos"), "ClipCat"),
    inspect: (file) => inspectStreams(tool("ffprobe"), file),
    ffmpeg: (args) => runFfmpeg(tool("ffmpeg"), args, { duration: 0 }),
    now: () => new Date(),
  });
  return { store, settings, keys, providerKeys, queue, jobs, pipeline, media, music, thumbnail, analysis, exporter, edit, recordings, speech };
}

/** Where outside agents reach the app, and what their configs run to get there. */
function mcpEnv(socket: string): InstallEnv {
  return {
    home: homedir(),
    appData: app.getPath("appData"),
    spec: serverSpec(process.execPath, app.getAppPath(), socket, app.isPackaged),
    transient: process.platform === "darwin" && process.execPath.includes("/AppTranslocation/"),
  };
}

/** A file name from the video's title: no characters Windows or macOS refuse. */
const fileName = (title: string) => title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "ClipCat export";

/** Writes the edit as a timeline for another editor, named for the video. */
async function writeTimeline(store: ProjectStore, id: string, format: TimelineFormat, path: string): Promise<void> {
  const project = await store.get(id);
  await writeFile(path, TIMELINE_FORMATS[format].write(project, project.suggestedTitle || project.name));
}

/** The article as a Markdown file: its title as the heading, then the body. */
const articleFile = (a: Article) => `${a.title.trim() ? `# ${a.title.trim()}\n\n` : ""}${a.markdown.trim()}\n`;

/** The app's window; the face detector's hidden window is never it. */
let mainWindow: BrowserWindow | null = null;
/** Set once the menu bar is up: turns its project items off when the window closes. */
let onMainWindowClosed: (() => void) | null = null;

/**
 * Started by the MCP bridge for an agent (the Claude desktop app starts its
 * servers as it opens), not by the person: no window and no Dock icon until
 * they open ClipCat, and gone when the last agent session ends.
 */
let background = process.argv.includes(BACKGROUND_ARG);

/** The person opened ClipCat: from here on it's an ordinary app with its window. */
function showWindow(): void {
  if (background) {
    background = false;
    void app.dock?.show();
  }
  const win = mainWindow;
  if (!win) {
    createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.focus();
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "ClipCat",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    // The window paints this before the UI loads, so it matches the page background.
    backgroundColor: tokens[nativeTheme.shouldUseDarkColors ? "dark" : "light"]["color-background"],
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  // Links open in the browser; the window itself never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(APP_ORIGIN) && !(DEV_URL && url.startsWith(DEV_URL))) event.preventDefault();
  });

  mainWindow = win;
  win.on("closed", () => {
    mainWindow = null;
    onMainWindowClosed?.();
    closeFaceDetector();
    closeCutout();
  });

  win.once("ready-to-show", () => {
    if (!isSmokeRun()) win.show();
  });
  void win.loadURL(DEV_URL ?? `${APP_ORIGIN}/index.html`);
  return win;
}

if (!squirrelLaunch && !app.requestSingleInstanceLock()) {
  // Another ClipCat is running and gets focus ("second-instance" below). This one
  // leaves before starting anything, so it can't take over the MCP socket or rerun jobs.
  app.quit();
} else if (!squirrelLaunch) {
  if (background) app.dock?.hide();
  app.whenReady().then(() => {
    const { store, settings, keys, providerKeys, queue, jobs, pipeline, media, music, thumbnail, analysis, exporter, edit, recordings, speech } = startPipeline();
    app.on("will-quit", () => void recordings.discardAll());
    const updater = new Updater({
      feed: updateFeed(),
      version: app.getVersion(),
      platform: process.platform,
      arch: process.platform === "darwin" && app.runningUnderARM64Translation ? "arm64" : process.arch,
      // Squirrel.Windows holds a lock on the first run after installing, so that one waits for the next launch.
      enabled: app.isPackaged && !isSmokeRun() && !process.argv.includes("--squirrel-firstrun"),
      autoUpdater,
      fetchJson: async (url) => {
        const response = await net.fetch(url, { cache: "no-store" });
        if (!response.ok) throw new Error(`${response.status} from ${url}`);
        return response.json();
      },
      onChange: (status) => {
        if (status.state === "error") mainLog.write("warn", "update:", status.detail);
        broadcast("update", status);
      },
      now: () => new Date(),
    });
    updater.start();
    // The UI's getDisplayMedia gets the screen picked in the recorder, with the computer's sound on Windows.
    let pickedScreen: { screenId: string; systemAudio: boolean } | null = null;
    session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
      const pick = pickedScreen;
      pickedScreen = null;
      if (!pick) return callback({});
      void desktopCapturer.getSources({ types: ["screen"] }).then(
        (sources) => {
          const source = sources.find((s) => s.id === pick.screenId);
          if (!source) return callback({});
          callback({ video: source, ...(pick.systemAudio && process.platform === "win32" ? { audio: "loopback" as const } : {}) });
        },
        () => callback({}),
      );
    });
    const socket = socketPath(app.getPath("userData"), process.platform);
    const installEnv = mcpEnv(socket);
    let agentSessions = 0;
    // In the background, ClipCat leaves once no agent is connected and the jobs they started have finished.
    const leaveWhenDone = () => {
      if (!background || agentSessions > 0) return;
      if (jobs.list(null).some((j) => j.state === "queued" || j.state === "running")) setTimeout(leaveWhenDone, 5_000);
      else app.quit();
    };
    // In case the bridge that started it gave up before connecting.
    if (background) setTimeout(leaveWhenDone, 60_000);
    // Which agents really opened a session, so Settings shows what happened rather than what a file says.
    const agentStatus = () => mcpStatus(installEnv, (id) => sessions.seen(id));
    const sessions = new SessionLog(join(app.getPath("userData"), "agent-sessions.json"), () => {
      void agentStatus().then((agents) => broadcast("mcp:agents", agents), () => {});
    });
    const mcp = listen(
      socket,
      () => {
        const server = createMcpServer({
          version: app.getVersion(),
          list: () => store.list(),
          get: (id) => store.get(id),
          edit,
          analyze: (id, brief) => analysis.analyze(id, brief),
          request: async (id, request) => analysis.request(id, request),
          writeup: async (id) => analysis.writeup(id),
          shorts: async (id, count, seconds) => analysis.shorts(id, count, seconds),
          exportVideo: async (id, format, path) => {
            await store.get(id);
            exporter.export(id, format, path);
          },
          importFiles: (files, projectId) => pipeline.import(files, projectId),
          exportTimeline: (id, format, path) => writeTimeline(store, id, format, path),
          jobs: (projectId) => jobs.list(projectId),
        });
        sessions.track(server);
        return server;
      },
      process.platform,
      (open) => {
        agentSessions = open;
        if (open === 0) leaveWhenDone();
      },
    ).then(
      () => null,
      (e: unknown) => {
        // Nothing to serve and nothing on screen.
        if (background) app.quit();
        return `The MCP socket didn't open: ${e instanceof Error ? e.message : String(e)}`;
      },
    );
    if (!isSmokeRun()) void healRegistrations(installEnv);
    // Each key's model list, fetched once per key: listing needs the network, and the lists change rarely.
    const modelLists = new Map<string, Promise<ModelChoice[]>>();
    const providerStatus = async (provider: KeyedProviderValue, current: SettingsValue) => {
      const key = await providerKeys[provider].get();
      const model = provider === "openai" ? current.openaiModel : current.openrouterModel;
      if (!key) return { hasKey: false, model, choices: [] };
      const cacheKey = `${provider}:${key}`;
      if (!modelLists.has(cacheKey)) {
        const list = listModels(provider, key);
        modelLists.set(cacheKey, list);
        // A failed listing is tried again next time rather than kept.
        list.catch(() => modelLists.delete(cacheKey));
      }
      const choices = await modelLists.get(cacheKey)!.catch(() => [] as ModelChoice[]);
      return { hasKey: true, model, choices };
    };
    const aiStatus = async () => {
      const host = await hostEnv;
      const current = await settings.get();
      const [claude, codex, key, codexOffers, openai, openrouter] = await Promise.all([
        probeClaude(host),
        probeCodex(host),
        keys.get(),
        codexModels(host),
        providerStatus("openai", current),
        providerStatus("openrouter", current),
      ]);
      return {
        claude,
        codex,
        api: { hasKey: key !== null, model: current.apiModel },
        openai,
        openrouter,
        agent: current.agent,
        models: {
          claude: { choices: CLAUDE_MODELS, fallback: null, selected: current.claudeModel },
          codex: { ...codexOffers, selected: current.codexModel },
        },
      };
    };
    const cliDeps = async (): Promise<CliDeps> => {
      const host = await hostEnv;
      return { host, codexRuns: async () => (await resolveCodex(host))?.binary ?? null };
    };
    const cliRuns = new Map<string, ReturnType<typeof runCli>>();
    serveUi(UI_ROOT);
    setFacePage(DEV_URL ? new URL("faces.html", DEV_URL).toString() : `${APP_ORIGIN}/faces.html`);
    setCutoutPage(DEV_URL ? new URL("cutout.html", DEV_URL).toString() : `${APP_ORIGIN}/cutout.html`);
    serveModels(MODELS_DIR);
    serveMedia((id) => store.dir(id));
    serveSounds(SFX_DIR);
    serveSlides(async (host, id) => {
      if (host === "draft") return drafts.get(id) ?? null;
      const slide = (await store.get(host)).assets.find((a) => a.id === id)?.slide;
      return slide?.html ? slideHtml(slide.html, slide.look) : null;
    }, SLIDE_CSP);
    const showLogs = async () => {
      const dir = dirname(mainLog.path);
      await mkdir(dir, { recursive: true });
      await shell.openPath(dir);
    };
    /** Saves the diagnostics zip where the user picks, from the dialog over `win`; null when they cancel. */
    const saveDiagnostics = async (win: BrowserWindow | null): Promise<string | null> => {
      const day = new Date().toISOString().slice(0, 10);
      const options: Electron.SaveDialogOptions = {
        title: "Save diagnostics",
        defaultPath: join(app.getPath("desktop"), `ClipCat diagnostics ${day}.zip`),
        filters: [{ name: "Zip", extensions: ["zip"] }],
      };
      const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return null;
      const path = extname(result.filePath).toLowerCase() === ".zip" ? result.filePath : `${result.filePath}.zip`;
      // Each part is asked for on its own, so one that fails is noted instead of losing the bundle.
      const part = <T>(run: () => Promise<T> | T) => Promise.resolve().then(run).catch((e: unknown) => ({ failed: e instanceof Error ? e.message : String(e) }));
      const about = {
        createdAt: new Date().toISOString(),
        versions: { app: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
        system: { platform: process.platform, arch: process.arch, release: release(), locale: app.getLocale(), memory: totalmem(), gpu: app.getGPUFeatureStatus() },
        info: await part(appInfo),
        ai: await part(aiStatus),
        settings: await part(() => settings.get()),
        agents: await part(agentStatus),
        mcp: await part(() => mcp),
        update: updater.current,
      };
      const zip = await diagnosticsZip({
        about,
        logs: [mainLog.oldPath, mainLog.path].filter((f) => existsSync(f)),
        jobs: jobs.list(null),
        projectsDir: join(app.getPath("userData"), "projects"),
        crashDir: app.getPath("crashDumps"),
        home: homedir(),
      });
      await writeFile(path, zip);
      return path;
    };
    // The menu bar matches what the window shows, and is built again when that changes.
    const recent = new RecentProjects(join(app.getPath("userData"), "recent-projects.json"));
    let menuState: MenuStateValue = { project: null };
    let pendingCommand: { command: MenuCommandValue; projectId?: string } | null = null;
    // Windows whose page has loaded and listens for menu commands.
    const listening = new WeakSet<Electron.WebContents>();
    const sendCommand = (command: MenuCommandValue, projectId?: string) => {
      // Undo and Redo belong to the window in front: the Help window's search box undoes its own typing.
      const focused = BrowserWindow.getFocusedWindow();
      if ((command === "undo" || command === "redo") && focused !== mainWindow) {
        if (focused) focused.webContents[command]();
        return;
      }
      const win = mainWindow;
      if (win && listening.has(win.webContents)) send(win, "menu", { command, ...(projectId ? { projectId } : {}) });
      else pendingCommand = { command, ...(projectId ? { projectId } : {}) };
      showWindow();
    };
    // One build at a time, so a slow one can't put back an older Open Recent.
    let menuBuild: Promise<void> = Promise.resolve();
    const refreshMenu = () => (menuBuild = menuBuild.then(buildMenu, buildMenu));
    const buildMenu = async () => {
      const [ids, projects] = await Promise.all([recent.list(), store.list().catch(() => [])]);
      const names = new Map(projects.map((p) => [p.id, p.name]));
      Menu.setApplicationMenu(
        Menu.buildFromTemplate(
          menuTemplate({
            platform: process.platform,
            dev: !app.isPackaged,
            state: menuState,
            recent: ids.flatMap((id) => (names.has(id) ? [{ id, name: names.get(id)! }] : [])),
            send: sendCommand,
            help: (page) => openHelp(page, { appOrigin: APP_ORIGIN, devUrl: DEV_URL }),
            open: (url) => void shell.openExternal(url),
            issueUrl: () => issueUrl({ version: app.getVersion(), platform: process.platform, arch: process.arch, release: process.getSystemVersion() }),
            releasesUrl: RELEASES_URL,
            // From the menu, the saved zip is shown in Finder or File Explorer, since no screen says where it went.
            saveDiagnostics: () =>
              void saveDiagnostics(BrowserWindow.getFocusedWindow() ?? mainWindow).then(
                (path) => path && shell.showItemInFolder(path),
                (e: unknown) => dialog.showErrorBox("Couldn't save diagnostics", e instanceof Error ? e.message : String(e)),
              ),
            showLogs: () => void showLogs(),
            // Settings shows how the check goes.
            checkUpdates: () => {
              sendCommand("settings-updates");
              void updater.check();
            },
            showProject: (id) => void shell.openPath(store.dir(id)),
            clearRecent: () => void recent.clear().then(refreshMenu),
          }),
        ),
      );
    };
    registerIpc(
      {
        "app:info": () => appInfo(),
        "app:ready": async ({ screen }, event) => {
          // A menu item chosen with no window open waits for the window it opened.
          const waiting = pendingCommand;
          pendingCommand = null;
          const win = BrowserWindow.fromWebContents(event.sender);
          if (win === mainWindow) listening.add(event.sender);
          if (waiting && win) send(win, "menu", waiting);
          if (!isSmokeRun()) return;
          const info = await appInfo();
          const file = process.env.CLIPCAT_SMOKE_IMPORT;
          const ai = await aiStatus();
          const [faceDetector, cutout, mcpProblem, recorder] = await Promise.all([
            faceDetectorProblem(),
            cutoutProblem(),
            mcp.then((problem) => problem ?? smokeMcp(installEnv.spec)),
            process.platform === "darwin" ? toolInfo("clipcat-recorder") : null,
          ]);
          finishSmoke({ screen, info, ai, faceDetector, cutout, mcp: mcpProblem, recorder, ...(file ? { import: await smokeImport(pipeline, exporter, store, queue, file) } : {}) });
        },
        "library:list": () => store.list(),
        "files:pick": async (_, event) => {
          const win = BrowserWindow.fromWebContents(event.sender);
          const options: Electron.OpenDialogOptions = {
            title: "Add videos",
            properties: ["openFile", "multiSelections"],
            filters: [
              { name: "Video and audio", extensions: ["mp4", "mov", "m4v", "mkv", "webm", "avi", "mp3", "wav", "m4a", "aac", "flac"] },
              { name: "All files", extensions: ["*"] },
            ],
          };
          const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
          return result.canceled ? [] : result.filePaths;
        },
        "media:pick": async (_, event) => {
          const win = BrowserWindow.fromWebContents(event.sender);
          const options: Electron.OpenDialogOptions = {
            title: "Add b-roll",
            properties: ["openFile", "multiSelections"],
            filters: [
              { name: "Pictures and videos", extensions: [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS] },
              { name: "All files", extensions: ["*"] },
            ],
          };
          const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
          return result.canceled ? [] : result.filePaths;
        },
        "music:pick": async (_, event) => {
          const win = BrowserWindow.fromWebContents(event.sender);
          const options: Electron.OpenDialogOptions = {
            title: "Add music",
            properties: ["openFile"],
            filters: [
              { name: "Music", extensions: MUSIC_EXTENSIONS },
              { name: "All files", extensions: ["*"] },
            ],
          };
          const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
          return result.canceled ? null : (result.filePaths[0] ?? null);
        },
        "project:set-music": ({ id, file }) => music.set(id, file),
        "project:import": ({ projectId, files }) => pipeline.import(files, projectId),
        "project:add-media": ({ id, files }) => media.add(id, files),
        "project:get": ({ id }) => store.get(id),
        "project:remove": async ({ id }) => {
          queue.cancel(id);
          const origin = (await store.get(id).catch(() => null))?.origin;
          await store.remove(id);
          // A deleted short leaves its long video's list of shorts.
          if (origin) {
            const parent = await store
              .update(origin.projectId, null, (p) => {
                p.shorts = p.shorts.filter((x) => x.id !== id);
              })
              .catch(() => null);
            if (parent) broadcast("project:changed", { id: parent.id, revision: parent.revision });
          }
        },
        "project:rename": async ({ id, name }) => {
          const next = await store.update(id, null, (p) => {
            p.name = name;
          });
          broadcast("project:changed", { id, revision: next.revision });
          // Shorts name their long video, and the long video lists its shorts by title.
          const related = [
            ...(next.origin
              ? [
                  store.update(next.origin.projectId, null, (p) => {
                    for (const s of p.shorts) if (s.id === id) s.title = name;
                  }),
                ]
              : []),
            ...next.shorts.map((s) =>
              store.update(s.id, null, (p) => {
                if (p.origin?.projectId === id) p.origin.name = name;
              }),
            ),
          ];
          for (const r of await Promise.allSettled(related)) if (r.status === "fulfilled") broadcast("project:changed", { id: r.value.id, revision: r.value.revision });
          return next;
        },
        "project:reveal": ({ id }) => shell.showItemInFolder(store.dir(id)),
        "ai:status": () => aiStatus(),
        "settings:get": () => settings.get(),
        "settings:set": (patch) => settings.set(patch),
        "settings:api-key": async ({ key }) => {
          const { apiModel } = await settings.get();
          // A key is tried before it's kept, so a typo shows up here rather than mid-analysis.
          if (key) await verifyKey(key, apiModel);
          await keys.set(key);
          return { hasKey: key !== null, model: apiModel };
        },
        "settings:provider-key": async ({ provider, key }) => {
          // A key is tried before it's kept, so a typo shows up here rather than mid-analysis.
          if (key) await verifyProviderKey(provider, key);
          await providerKeys[provider].set(key);
          let current = await settings.get();
          const status = await providerStatus(provider, current);
          // OpenAI's list is short and ranked, so a new key starts on its best model; OpenRouter's is too long to guess from.
          if (provider === "openai" && key && !current.openaiModel && status.choices[0]) {
            current = await settings.set({ openaiModel: status.choices[0].id });
            return { ...status, model: current.openaiModel };
          }
          return status;
        },
        "project:analyze": ({ id, brief }) => analysis.analyze(id, brief),
        "project:request": async ({ id, request }) => analysis.request(id, request),
        "project:correct": async ({ id }) => analysis.correct(id),
        "project:language": ({ id, language }) => pipeline.setLanguage(id, language),
        "speech:models": () => speech.list(),
        "speech:download": async ({ id }) => {
          await speech.download(id);
          return speech.list();
        },
        "speech:remove": async ({ id }) => {
          await speech.remove(id);
          return speech.list();
        },
        "project:design-slides": ({ id }) => analysis.designMissing(id),
        "project:writeup": async ({ id }) => analysis.writeup(id),
        "project:save-article": async ({ id }, event) => {
          const project = await store.get(id);
          const article = project.writeup?.article;
          if (!article?.markdown.trim()) throw new Error("There's no article yet. Write chapters and article first.");
          const win = BrowserWindow.fromWebContents(event.sender);
          const options: Electron.SaveDialogOptions = {
            title: "Save the article",
            defaultPath: join(app.getPath("documents"), `${fileName(article.title || project.suggestedTitle || project.name)}.md`),
            filters: [{ name: "Markdown", extensions: ["md"] }],
          };
          const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
          if (result.canceled || !result.filePath) return { path: null };
          const path = extname(result.filePath).toLowerCase() === ".md" ? result.filePath : `${result.filePath}.md`;
          await writeFile(path, articleFile(article));
          return { path };
        },
        "project:thumbnail-frame": ({ id, sourceId, time }) => thumbnail.pick(id, sourceId, time),
        "project:save-thumbnail": async ({ id, png }, event) => {
          const project = await store.get(id);
          const win = BrowserWindow.fromWebContents(event.sender);
          const options: Electron.SaveDialogOptions = {
            title: "Save the thumbnail",
            defaultPath: join(app.getPath("pictures"), `${fileName(project.suggestedTitle || project.name)}.png`),
            filters: [{ name: "PNG image", extensions: ["png"] }],
          };
          const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
          if (result.canceled || !result.filePath) return { path: null };
          const path = extname(result.filePath).toLowerCase() === ".png" ? result.filePath : `${result.filePath}.png`;
          await writeFile(path, Buffer.from(png, "base64"));
          return { path };
        },
        "project:shorts": async ({ id, count, seconds }) => analysis.shorts(id, count, seconds),
        "project:edit": ({ id, revision, op }) => edit(id, revision, op),
        "project:export": async ({ id, format, cover }, event) => {
          const project = await store.get(id);
          const win = BrowserWindow.fromWebContents(event.sender);
          const suffix = format === "9:16" ? " (vertical)" : "";
          const options: Electron.SaveDialogOptions = {
            title: `Export ${format}`,
            defaultPath: join(app.getPath("videos"), `${fileName(project.suggestedTitle || project.name)}${suffix}.mp4`),
            filters: [{ name: "MP4 video", extensions: ["mp4"] }],
          };
          const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
          if (result.canceled || !result.filePath) return { path: null };
          const path = extname(result.filePath).toLowerCase() === ".mp4" ? result.filePath : `${result.filePath}.mp4`;
          exporter.export(id, format, path, cover ? Buffer.from(cover, "base64") : null);
          return { path };
        },
        "project:export-timeline": async ({ id, format }, event) => {
          const project = await store.get(id);
          const { label, extension } = TIMELINE_FORMATS[format];
          const win = BrowserWindow.fromWebContents(event.sender);
          const options: Electron.SaveDialogOptions = {
            title: `Export a timeline for ${label}`,
            defaultPath: join(app.getPath("documents"), `${fileName(project.suggestedTitle || project.name)}.${extension}`),
            filters: [{ name: label, extensions: [extension] }],
          };
          const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
          if (result.canceled || !result.filePath) return { path: null };
          const path = extname(result.filePath).toLowerCase() === `.${extension}` ? result.filePath : `${result.filePath}.${extension}`;
          await writeTimeline(store, id, format, path);
          return { path };
        },
        "project:reveal-export": async ({ id }) => {
          const last = (await store.get(id)).lastExport;
          if (last) shell.showItemInFolder(last.path);
        },
        "jobs:cancel": ({ id }) => queue.cancel(id),
        "record:setup": async () => {
          const screenAccess = process.platform === "darwin" ? systemPreferences.getMediaAccessStatus("screen") : "granted";
          const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 320, height: 180 } }).catch(() => []);
          const native = NATIVE_SCREEN && existsSync(tool("clipcat-recorder"));
          return {
            screens: sources.map((s, i) => ({ id: s.id, displayId: s.display_id || "", name: sources.length > 1 ? `Screen ${i + 1}` : "Your screen", thumbnail: s.thumbnail.toDataURL() })),
            native,
            systemAudio: native || process.platform === "win32",
            screenAccess,
          };
        },
        "record:access": async ({ kind }) =>
          process.platform === "darwin" ? systemPreferences.askForMediaAccess(kind) : systemPreferences.getMediaAccessStatus(kind) !== "denied",
        "record:pick-screen": (pick) => {
          pickedScreen = pick;
        },
        "record:begin": async ({ kind, mimeType }) => {
          const token = await recordings.begin(kind, mimeType);
          // The window keeps out of its own screen recording (WDA_EXCLUDEFROMCAPTURE on Windows, sharing off on a Mac);
          // the macOS 15 recorder leaves ClipCat out by itself.
          if (kind === "screen") mainWindow?.setContentProtection(true);
          return { token };
        },
        "record:privacy": ({ kind }) => shell.openExternal(privacyPane(kind)),
        "record:native": async ({ displayId, mic, micName, systemAudio }) => {
          if (!NATIVE_SCREEN) throw new Error("The built-in screen recorder needs macOS 15 or newer");
          const binary = tool("clipcat-recorder");
          const token = await recordings.beginNative((out) => startNative(binary, { displayId, out, mic, micName, systemAudio, excludePid: process.pid }));
          return { token };
        },
        "record:chunk": ({ token, data }) => recordings.append(token, Buffer.from(data, "base64")),
        "record:end": async ({ token, projectId }) => {
          const file = await recordings.end(token).finally(() => mainWindow?.setContentProtection(false));
          return pipeline.import([file], projectId);
        },
        "record:discard": async ({ token }) => {
          mainWindow?.setContentProtection(false);
          await recordings.discard(token);
        },
        "update:status": () => updater.current,
        "update:check": () => updater.check(),
        "update:install": () => updater.install(),
        "update:open": async () => {
          if (updater.current.page) await shell.openExternal(updater.current.page);
        },
        "app:reveal-logs": () => showLogs(),
        "app:diagnostics": async (_, event) => ({ path: await saveDiagnostics(BrowserWindow.fromWebContents(event.sender)) }),
        "help:open": ({ page }) => openHelp(page, { appOrigin: APP_ORIGIN, devUrl: DEV_URL }),
        "menu:state": async (state) => {
          const opened = state.project && state.project.id !== menuState.project?.id ? state.project.id : null;
          if (!opened && JSON.stringify(state) === JSON.stringify(menuState)) return;
          menuState = state;
          if (opened) await recent.opened(opened);
          await refreshMenu();
        },
        "cli:status": async ({ id }) => cliStatus(id, await cliDeps()),
        "cli:run": async ({ id }) => {
          // One run per CLI: a second press while one is going waits for it.
          const running = cliRuns.get(id);
          if (running) return running;
          const run = cliDeps()
            .then((deps) => runCli(id, deps, (line) => broadcast("cli:progress", { id, line })))
            .finally(() => cliRuns.delete(id));
          cliRuns.set(id, run);
          return run;
        },
        "mcp:status": agentStatus,
        "mcp:connect": async ({ agent, connect }) => {
          await connectAgent(installEnv, agent, connect);
          return agentStatus();
        },
        "mcp:check": async ({ agent }) => checkAgent(agent, { env: installEnv, host: await hostEnv, platform: process.platform }),
        "mcp:setup": async () => mcpSetup(installEnv),
      },
      DEV_URL,
    );
    onMainWindowClosed = () => {
      menuState = { project: null };
      void refreshMenu();
    };
    void refreshMenu();
    if (isSmokeRun()) startSmokeTimer();
    else {
      // Each part picks up its own unfinished work, so one failing doesn't stop the others.
      const resume = (what: string, run: () => Promise<unknown>) => run().catch((e) => console.error(`Couldn't resume ${what}:`, e));
      void resume("preparing and transcribing", () => pipeline.resume())
        .then(() => resume("b-roll", () => media.resume()))
        .then(() => resume("music", () => music.resume()));
    }
    if (!background) createWindow();
  });

  app.on("second-instance", () => showWindow());

  app.on("activate", () => {
    if (!mainWindow) showWindow();
  });

  app.on("window-all-closed", () => {
    // In the background the only windows are hidden helpers, and closing them leaves the agent's session running.
    if (process.platform !== "darwin" && !background) app.quit();
  });
}
