// The menu bar. It's a plain template built from what the items do and what
// the window shows, so a test can check it without Electron; main.ts hands it
// to Menu.buildFromTemplate and builds it again whenever the window changes.
//
// The editor answers its own keys (Cmd+Z, Space, J/K/L, the arrows) before the
// menu sees them, so the menu's items for those are for clicking and for
// showing the key. Keys without Cmd or Ctrl aren't given to the menu on macOS,
// where it would take them even while you type.

import type { MenuCommandValue, MenuStateValue } from "@clipcat/ipc";
import type { MenuItemConstructorOptions } from "electron";

export type MenuDeps = {
  platform: NodeJS.Platform;
  /** A development build: View gets Reload and the developer tools. */
  dev: boolean;
  /** What the window shows. */
  state: MenuStateValue;
  /** File > Open Recent, newest first. */
  recent: { id: string; name: string }[];
  /** Asks the window to do something. */
  send: (command: MenuCommandValue, projectId?: string) => void;
  /** Opens the Help window at docs/<page>.md ("" for the overview). */
  help: (page: string) => void;
  /** Opens a page in the browser. */
  open: (url: string) => void;
  /** The address of a new issue with this copy's version filled in. */
  issueUrl: () => string;
  releasesUrl: string;
  saveDiagnostics: () => void;
  showLogs: () => void;
  checkUpdates: () => void;
  /** Shows a project's folder in Finder or File Explorer. */
  showProject: (id: string) => void;
  clearRecent: () => void;
};

const separator: MenuItemConstructorOptions = { type: "separator" };

function fileMenu(deps: MenuDeps): MenuItemConstructorOptions {
  const project = deps.state.project;
  const mac = deps.platform === "darwin";
  return {
    label: "File",
    submenu: [
      { label: "New Recording…", accelerator: "CmdOrCtrl+N", click: () => deps.send("new-recording") },
      { label: "Import Videos…", accelerator: "CmdOrCtrl+O", click: () => deps.send("import") },
      { label: "Add Videos to Project…", accelerator: "CmdOrCtrl+Shift+O", enabled: !!project, click: () => deps.send("add-videos") },
      {
        label: "Open Recent",
        submenu: [
          ...deps.recent.map((p): MenuItemConstructorOptions => ({ label: p.name, click: () => deps.send("open-project", p.id) })),
          ...(deps.recent.length ? [separator] : []),
          { label: "Clear Menu", enabled: deps.recent.length > 0, click: () => deps.clearRecent() },
        ],
      },
      separator,
      { label: "Export…", accelerator: "CmdOrCtrl+E", enabled: !!project, click: () => deps.send("export") },
      {
        label: mac ? "Show in Finder" : "Show in File Explorer",
        enabled: !!project,
        click: () => project && deps.showProject(project.id),
      },
      separator,
      ...(mac ? [] : [{ label: "Settings…", accelerator: "Ctrl+,", click: () => deps.send("settings") }, separator]),
      mac ? { role: "close" } : { role: "quit", label: "Exit" },
    ],
  };
}

function editMenu(deps: MenuDeps): MenuItemConstructorOptions {
  return {
    label: "Edit",
    submenu: [
      // In a text box these undo the typing; anywhere else, the last edit to the project.
      { label: "Undo", accelerator: "CmdOrCtrl+Z", click: () => deps.send("undo") },
      { label: "Redo", accelerator: "Shift+CmdOrCtrl+Z", click: () => deps.send("redo") },
      separator,
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ],
  };
}

function viewMenu(deps: MenuDeps): MenuItemConstructorOptions {
  const project = deps.state.project;
  const tab = (label: string, command: MenuCommandValue, key: string): MenuItemConstructorOptions => ({
    label,
    accelerator: `CmdOrCtrl+${key}`,
    enabled: !!project,
    click: () => deps.send(command),
  });
  return {
    label: "View",
    submenu: [
      tab("Edit Tools", "tab-edit", "1"),
      tab("Look Tools", "tab-look", "2"),
      tab("Publish Tools", "tab-publish", "3"),
      tab("Export Tools", "tab-export", "4"),
      separator,
      {
        label: "Hide Cuts",
        type: "checkbox",
        checked: project?.hideCuts ?? false,
        accelerator: "CmdOrCtrl+Shift+H",
        enabled: !!project,
        click: () => deps.send("hide-cuts"),
      },
      separator,
      ...(deps.dev ? [{ role: "reload" } as const, { role: "toggleDevTools" } as const, separator] : []),
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
      separator,
      { role: "togglefullscreen" },
    ],
  };
}

function playbackMenu(deps: MenuDeps): MenuItemConstructorOptions {
  const mac = deps.platform === "darwin";
  const item = (label: string, command: MenuCommandValue, key: string): MenuItemConstructorOptions => ({
    label,
    // Shown on Windows, where the menu doesn't take it; on macOS the menu would, so the key is in the help instead.
    ...(mac ? {} : { accelerator: key, registerAccelerator: false }),
    enabled: !!deps.state.project,
    click: () => deps.send(command),
  });
  return {
    label: "Playback",
    submenu: [
      item("Play or Pause", "play-pause", "Space"),
      separator,
      item("Play Backwards", "play-backwards", "J"),
      item("Pause", "pause", "K"),
      item("Play Forwards", "play-forwards", "L"),
      separator,
      item("Back One Frame", "back-frame", "Left"),
      item("Forward One Frame", "forward-frame", "Right"),
      item("Back One Second", "back-second", "Shift+Left"),
      item("Forward One Second", "forward-second", "Shift+Right"),
    ],
  };
}

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
      separator,
      { label: "Release Notes", click: () => deps.open(deps.releasesUrl) },
      { label: "Report an Issue…", click: () => deps.open(deps.issueUrl()) },
      { label: "Save Diagnostics…", click: () => deps.saveDiagnostics() },
      { label: "Show Log Folder", click: () => deps.showLogs() },
      // Windows has no app menu, so these live here.
      ...(deps.platform === "darwin" ? [] : [separator, { label: "Check for Updates…", click: () => deps.checkUpdates() }, { role: "about" } as const]),
    ],
  };
}

/** The ClipCat menu, on macOS only. */
function appMenu(deps: MenuDeps): MenuItemConstructorOptions {
  return {
    label: "ClipCat",
    submenu: [
      { role: "about" },
      { label: "Check for Updates…", click: () => deps.checkUpdates() },
      separator,
      { label: "Settings…", accelerator: "Cmd+,", click: () => deps.send("settings") },
      separator,
      { role: "services" },
      separator,
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      separator,
      { role: "quit" },
    ],
  };
}

export function menuTemplate(deps: MenuDeps): MenuItemConstructorOptions[] {
  return [
    ...(deps.platform === "darwin" ? [appMenu(deps)] : []),
    fileMenu(deps),
    editMenu(deps),
    viewMenu(deps),
    playbackMenu(deps),
    { role: "windowMenu" },
    helpMenu(deps),
  ];
}
