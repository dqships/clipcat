// The Help window: the help pages from the repo's docs/ folder, built into the
// UI as help.html. There's one, opened from the Help menu or a link in the app,
// and it has no preload, so it can't reach the IPC handlers. Links out of the
// help open in the browser.

import { BrowserWindow, nativeTheme, shell } from "electron";
import tokens from "../../../design/tokens.json";

/** Where issues are filed and releases are listed. */
export const REPO_URL = "https://github.com/dqships/clipcat";
export const RELEASES_URL = `${REPO_URL}/releases`;

/** The help page's address, at one page of the help ("" for the overview). */
export function helpUrl(page: string, origin: { appOrigin: string; devUrl: string | null }): string {
  const base = origin.devUrl ? new URL("help.html", origin.devUrl).toString() : `${origin.appOrigin}/help.html`;
  return page ? `${base}?page=${encodeURIComponent(page)}` : base;
}

/** A new GitHub issue with the version and system filled in, so a report says what it ran on. */
export function issueUrl(about: { version: string; platform: string; arch: string; release: string }): string {
  const system = { darwin: "macOS", win32: "Windows", linux: "Linux" }[about.platform] ?? about.platform;
  const body = [
    "**What happened**",
    "",
    "",
    "**What you expected**",
    "",
    "",
    "**Steps to see it again**",
    "",
    "1. ",
    "",
    "---",
    `ClipCat ${about.version}, ${system} ${about.release} (${about.arch})`,
    "",
    "If you can, attach the zip from Help > Save Diagnostics. It has logs and versions, never your transcripts or videos.",
  ].join("\n");
  return `${REPO_URL}/issues/new?${new URLSearchParams({ body }).toString()}`;
}

let helpWindow: BrowserWindow | null = null;

/** Opens the Help window at a page, or brings it forward and turns to that page. */
export function openHelp(page: string, origin: { appOrigin: string; devUrl: string | null }): void {
  const url = helpUrl(page, origin);
  if (helpWindow && !helpWindow.isDestroyed()) {
    void helpWindow.loadURL(url);
    if (helpWindow.isMinimized()) helpWindow.restore();
    helpWindow.focus();
    return;
  }
  const win = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 640,
    minHeight: 480,
    show: false,
    title: "ClipCat Help",
    backgroundColor: tokens[nativeTheme.shouldUseDarkColors ? "dark" : "light"]["color-background"],
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true },
  });
  win.webContents.setWindowOpenHandler(({ url: link }) => {
    if (link.startsWith("https://")) void shell.openExternal(link);
    return { action: "deny" };
  });
  // The page turns its own pages; anything else that tries to load here goes to the browser instead.
  win.webContents.on("will-navigate", (event, link) => {
    if (link.startsWith(helpUrl("", origin))) return;
    event.preventDefault();
    if (link.startsWith("https://")) void shell.openExternal(link);
  });
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    helpWindow = null;
  });
  helpWindow = win;
  void win.loadURL(url);
}
