// ClipCat's main process: one window, the UI on app://clipcat, and the IPC
// handlers. All media work will live here, never in the renderer.

import { BrowserWindow, app, nativeTheme, shell } from "electron";
import tokens from "../../../design/tokens.json";
import { join, resolve } from "node:path";
import type { AppInfoValue } from "@clipcat/ipc";
import { binaryPath, probeVersion } from "./ffmpeg";
import { registerIpc } from "./ipc";
import { APP_ORIGIN, registerSchemes, serveUi } from "./protocol";
import { handleSquirrelEvent } from "./squirrel";
import { startSmokeTimer, finishSmoke, isSmokeRun } from "./smoke";

const squirrelLaunch = handleSquirrelEvent();

const DEV_URL = process.env.CLIPCAT_DEV_URL ?? null;
const UI_ROOT = join(__dirname, "..", "ui");
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

app.setName("ClipCat");
registerSchemes();

async function appInfo(): Promise<AppInfoValue> {
  const path = binaryPath("ffmpeg", {
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    repoRoot: REPO_ROOT,
    platform: process.platform,
    arch: process.arch,
  });
  const version = await probeVersion(path);
  return {
    name: "ClipCat",
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    ffmpeg: { available: version !== null, version, path },
  };
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

  win.once("ready-to-show", () => {
    if (!isSmokeRun()) win.show();
  });
  void win.loadURL(DEV_URL ?? `${APP_ORIGIN}/index.html`);
  return win;
}

if (!squirrelLaunch) {
  if (!app.requestSingleInstanceLock()) app.quit();

  app.whenReady().then(() => {
    serveUi(UI_ROOT);
    registerIpc(
      {
        "app:info": () => appInfo(),
        "app:ready": async ({ screen }) => {
          if (isSmokeRun()) finishSmoke({ screen, info: await appInfo() });
        },
      },
      DEV_URL,
    );
    if (isSmokeRun()) startSmokeTimer();
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
