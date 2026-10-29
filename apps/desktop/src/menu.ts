// The menu bar. It's a plain template built from what the items do, so a test
// can check it without Electron; main.ts hands it to Menu.buildFromTemplate.

import type { MenuItemConstructorOptions } from "electron";

export type MenuDeps = {
  platform: NodeJS.Platform;
  /** Opens the Help window at docs/<page>.md ("" for the overview). */
  help: (page: string) => void;
  /** Opens a page in the browser. */
  open: (url: string) => void;
  /** The address of a new issue with this copy's version filled in. */
  issueUrl: () => string;
  releasesUrl: string;
  saveDiagnostics: () => void;
  showLogs: () => void;
};

/** The Help menu: the help pages first, then the ways to get help from outside the app. */
function helpMenu(deps: MenuDeps): MenuItemConstructorOptions {
  const page = (label: string, slug: string, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    ...(accelerator ? { accelerator } : {}),
    click: () => deps.help(slug),
  });
  return {
    role: "help",
    submenu: [
      page("ClipCat Help", "", deps.platform === "darwin" ? "Cmd+?" : "F1"),
      page("Keyboard Shortcuts", "shortcuts"),
      page("Use ClipCat from Claude or Codex", "agents"),
      page("Questions People Ask", "faq"),
      page("Fix a Problem", "troubleshooting"),
      { type: "separator" },
      { label: "Release Notes", click: () => deps.open(deps.releasesUrl) },
      { label: "Report an Issue…", click: () => deps.open(deps.issueUrl()) },
      { label: "Save Diagnostics…", click: () => deps.saveDiagnostics() },
      { label: "Show Log Folder", click: () => deps.showLogs() },
    ],
  };
}

export function menuTemplate(deps: MenuDeps): MenuItemConstructorOptions[] {
  return [
    ...(deps.platform === "darwin" ? [{ role: "appMenu" } as const] : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    helpMenu(deps),
  ];
}
