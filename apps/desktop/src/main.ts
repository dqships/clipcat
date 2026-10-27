// ClipCat's main process: one window, the UI on app://clipcat, prepared media
// on media://, and the IPC handlers. All media work lives here, never in the
// renderer.

import { BrowserWindow, app, dialog, nativeTheme, shell } from "electron";
import { randomUUID } from "node:crypto";
import { applyEdit } from "@clipcat/core";
import tokens from "../../../design/tokens.json";
import { extname, join, resolve } from "node:path";
import type { AppInfoValue } from "@clipcat/ipc";
import { AnalysisRunner } from "./ai/analyze";
import { claudeAgent, probeClaude } from "./ai/claude";
import { hydrateEnv } from "./ai/env";
import { type Binary, binaryPath, probeVersion } from "./tools";
import { broadcast, registerIpc } from "./ipc";
import { JobQueue } from "./jobs/queue";
import { defaultEncoder } from "./media/prep";
import { runFfmpeg } from "./media/run";
import { realDeps } from "./pipeline/deps";
import { ExportRunner } from "./pipeline/export";
import { ImportPipeline } from "./pipeline/import";
import { APP_ORIGIN, registerSchemes, serveMedia, serveUi } from "./protocol";
import { handleSquirrelEvent } from "./squirrel";
import { ProjectStore } from "./store/projects";
import type { ModelId } from "./transcribe/models";
import { startSmokeTimer, finishSmoke, isSmokeRun, recordSmokeJob, smokeImport } from "./smoke";

const squirrelLaunch = handleSquirrelEvent();

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

async function appInfo(): Promise<AppInfoValue> {
  const [ffmpeg, whisper] = await Promise.all([toolInfo("ffmpeg"), toolInfo("whisper-cli")]);
  return { name: "ClipCat", version: app.getVersion(), platform: process.platform, arch: process.arch, ffmpeg, whisper };
}

/** The smaller model is for CI and slow machines; everyone else gets the accurate one. */
const MODEL: ModelId = process.env.CLIPCAT_MODEL === "base" ? "base" : "large-v3-turbo-q5_0";

/** The user's PATH from their login shell, read once; the agent CLIs are found on it. */
const hostEnv = hydrateEnv();

function startPipeline() {
  const data = app.getPath("userData");
  const store = new ProjectStore(join(data, "projects"));
  const queue = new JobQueue((event) => {
    if (isSmokeRun()) recordSmokeJob(event);
    broadcast("job", event);
  });
  const changed = (p: { id: string; revision: number }) => broadcast("project:changed", { id: p.id, revision: p.revision });
  const analysis = new AnalysisRunner({
    store,
    queue,
    agent: async () => {
      const host = await hostEnv;
      const status = await probeClaude(host);
      if (status.status !== "ready") throw new Error(status.detail ?? "Claude Code isn't ready");
      return claudeAgent(host, app.getVersion());
    },
    changed,
  });
  const pipeline = new ImportPipeline({
    ...realDeps({
      ffmpeg: tool("ffmpeg"),
      ffprobe: tool("ffprobe"),
      whisper: tool("whisper-cli"),
      // CI points this at a cached folder so each run doesn't download the model again.
      modelsDir: process.env.CLIPCAT_MODELS_DIR ?? join(data, "models"),
      model: MODEL,
      encoder: defaultEncoder(process.platform),
    }),
    store,
    queue,
    changed,
  });
  const exporter = new ExportRunner({
    store,
    queue,
    changed,
    ffmpeg: (args, { cwd, duration, ctx }) =>
      runFfmpeg(tool("ffmpeg"), args, { cwd, duration, onProgress: (f) => ctx.progress(f), signal: ctx.signal }),
    encoder: defaultEncoder(process.platform),
    fontsDir: app.isPackaged ? join(process.resourcesPath, "fonts") : join(REPO_ROOT, "apps", "desktop", "resources", "fonts"),
  });
  return { store, queue, pipeline, analysis, exporter };
}

/** A file name from the video's title: no characters Windows or macOS refuse. */
const fileName = (title: string) => title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "ClipCat export";

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

  win.once("ready-to-show", () => {
    if (!isSmokeRun()) win.show();
  });
  void win.loadURL(DEV_URL ?? `${APP_ORIGIN}/index.html`);
  return win;
}

if (!squirrelLaunch) {
  if (!app.requestSingleInstanceLock()) app.quit();

  app.whenReady().then(() => {
    const { store, queue, pipeline, analysis, exporter } = startPipeline();
    serveUi(UI_ROOT);
    serveMedia((id) => store.dir(id));
    registerIpc(
      {
        "app:info": () => appInfo(),
        "app:ready": async ({ screen }) => {
          if (!isSmokeRun()) return;
          const info = await appInfo();
          const file = process.env.CLIPCAT_SMOKE_IMPORT;
          const ai = { claude: await probeClaude(await hostEnv) };
          finishSmoke({ screen, info, ai, ...(file ? { import: await smokeImport(pipeline, exporter, store, queue, file) } : {}) });
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
        "project:import": ({ projectId, files }) => pipeline.import(files, projectId),
        "project:get": ({ id }) => store.get(id),
        "project:remove": async ({ id }) => {
          queue.cancel(id);
          await store.remove(id);
        },
        "ai:status": async () => ({ claude: await probeClaude(await hostEnv) }),
        "project:analyze": ({ id, brief }) => analysis.analyze(id, brief),
        "project:edit": async ({ id, revision, op }) => {
          const next = await store.update(id, revision, (p) => applyEdit(p, op, () => `g${randomUUID().slice(0, 8)}`));
          broadcast("project:changed", { id, revision: next.revision });
          return next;
        },
        "project:export": async ({ id, format }, event) => {
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
          exporter.export(id, format, path);
          return { path };
        },
        "project:reveal-export": async ({ id }) => {
          const last = (await store.get(id)).lastExport;
          if (last) shell.showItemInFolder(last.path);
        },
        "jobs:cancel": ({ id }) => queue.cancel(id),
      },
      DEV_URL,
    );
    if (isSmokeRun()) startSmokeTimer();
    else void pipeline.resume();
    createWindow();
  });

  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
