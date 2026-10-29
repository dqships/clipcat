import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ BrowserWindow: class {}, nativeTheme: {}, shell: {} }));
import { helpUrl, issueUrl } from "./help";
import { type MenuDeps, menuTemplate } from "./menu";

const PROJECT = { id: "p1", hideCuts: true };

const deps = (platform: NodeJS.Platform, more: Partial<MenuDeps> = {}): MenuDeps & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    platform,
    dev: false,
    state: { project: PROJECT },
    recent: [
      { id: "p1", name: "Launch video" },
      { id: "p2", name: "Pricing take" },
    ],
    send: (command, id) => calls.push(id ? `${command}:${id}` : command),
    help: (page) => calls.push(`help:${page}`),
    open: (url) => calls.push(`open:${url}`),
    issueUrl: () => "https://github.com/dqships/clipcat/issues/new",
    releasesUrl: "https://github.com/dqships/clipcat/releases",
    saveDiagnostics: () => calls.push("diagnostics"),
    showLogs: () => calls.push("logs"),
    checkUpdates: () => calls.push("updates"),
    showProject: (id) => calls.push(`show:${id}`),
    clearRecent: () => calls.push("clear"),
    ...more,
  };
};

type Item = MenuItemConstructorOptions;
const items = (menu: Item) => (menu.submenu as Item[]).filter((i) => i.type !== "separator");
const menu = (template: Item[], label: string) => template.find((m) => m.label === label || m.role === label)!;
const item = (template: Item[], path: string) => {
  const [top, ...rest] = path.split(" > ");
  let found = menu(template, top!);
  for (const label of rest) found = items(found).find((i) => i.label === label || i.role === label)!;
  return found;
};
const click = (i: Item) => (i.click as () => void)();
/** Every clickable item, depth first, as the actions it took. */
const clickAll = (d: MenuDeps & { calls: string[] }, top: string) => {
  const walk = (m: Item): void => {
    for (const i of items(m)) {
      if (i.submenu) walk(i);
      else if (i.click) click(i);
    }
  };
  walk(menu(menuTemplate(d), top));
  return d.calls;
};

describe("the menu bar", () => {
  it("has the ClipCat menu on macOS, and puts About and updates under Help on Windows", () => {
    const mac = menuTemplate(deps("darwin")).map((m) => m.label ?? m.role);
    const win = menuTemplate(deps("win32")).map((m) => m.label ?? m.role);
    expect(mac).toEqual(["ClipCat", "File", "Edit", "View", "Playback", "windowMenu", "help"]);
    expect(win).toEqual(["File", "Edit", "View", "Playback", "windowMenu", "help"]);
    expect(items(menu(menuTemplate(deps("win32")), "help")).some((i) => i.role === "about")).toBe(true);
    expect(items(menu(menuTemplate(deps("darwin")), "help")).some((i) => i.role === "about")).toBe(false);
  });

  it("puts Settings in the ClipCat menu on macOS and the File menu on Windows", () => {
    expect(item(menuTemplate(deps("darwin")), "ClipCat > Settings…").accelerator).toBe("Cmd+,");
    expect(item(menuTemplate(deps("win32")), "File > Settings…").accelerator).toBe("Ctrl+,");
  });

  it("sends each File item to the window", () => {
    expect(clickAll(deps("darwin"), "File")).toEqual(["new-recording", "import", "add-videos", "open-project:p1", "open-project:p2", "clear", "export", "show:p1"]);
  });

  it("turns project items off without a project", () => {
    const template = menuTemplate(deps("darwin", { state: { project: null } }));
    for (const path of ["File > Add Videos to Project…", "File > Export…", "File > Show in Finder", "View > Edit Tools", "View > Hide Cuts", "Playback > Pause"]) {
      expect(item(template, path).enabled, path).toBe(false);
    }
    expect(item(template, "File > New Recording…").enabled).toBeUndefined();
  });

  it("lists recent projects, and turns Clear off when there are none", () => {
    const none = item(menuTemplate(deps("darwin", { recent: [] })), "File > Open Recent");
    expect(items(none).map((i) => [i.label, i.enabled])).toEqual([["Clear Menu", false]]);
  });

  it("names the file manager for the platform", () => {
    expect(item(menuTemplate(deps("win32")), "File > Show in File Explorer").enabled).toBe(true);
  });

  it("shows Hide Cuts as it is", () => {
    expect(item(menuTemplate(deps("darwin")), "View > Hide Cuts").checked).toBe(true);
    expect(item(menuTemplate(deps("darwin", { state: { project: { ...PROJECT, hideCuts: false } } })), "View > Hide Cuts").checked).toBe(false);
  });

  it("has Reload and the developer tools in development only", () => {
    const roles = (dev: boolean) => items(menu(menuTemplate(deps("darwin", { dev })), "View")).map((i) => i.role);
    expect(roles(true)).toContain("toggleDevTools");
    expect(roles(false)).not.toContain("toggleDevTools");
    expect(roles(false)).not.toContain("reload");
  });

  it("sends Undo and Redo to the window, which picks the text box or the project", () => {
    expect(clickAll(deps("darwin"), "Edit")).toEqual(["undo", "redo"]);
  });

  it("shows the playback keys on Windows without taking them, and leaves them off on macOS", () => {
    const win = items(menu(menuTemplate(deps("win32")), "Playback"));
    expect(win[0]).toMatchObject({ label: "Play or Pause", accelerator: "Space", registerAccelerator: false });
    expect(win.every((i) => i.registerAccelerator === false)).toBe(true);
    expect(items(menu(menuTemplate(deps("darwin")), "Playback")).every((i) => i.accelerator === undefined)).toBe(true);
    expect(clickAll(deps("darwin"), "Playback")).toEqual([
      "play-pause",
      "play-backwards",
      "pause",
      "play-forwards",
      "back-frame",
      "forward-frame",
      "back-second",
      "forward-second",
    ]);
  });

  it("only gives the menu keys with Cmd or Ctrl, or F1", () => {
    const keys: string[] = [];
    const walk = (m: Item): void => {
      for (const i of items(m)) {
        if (i.submenu) walk(i);
        else if (i.accelerator && i.registerAccelerator !== false) keys.push(String(i.accelerator));
      }
    };
    for (const platform of ["darwin", "win32"] as const) for (const m of menuTemplate(deps(platform))) if (m.submenu) walk(m);
    expect(keys.filter((k) => !/Cmd|Ctrl|^F1$/.test(k))).toEqual([]);
  });

  it("opens help with ⌘? on macOS and F1 on Windows", () => {
    expect(item(menuTemplate(deps("darwin")), "help > ClipCat Help").accelerator).toBe("Cmd+?");
    expect(item(menuTemplate(deps("win32")), "help > ClipCat Help").accelerator).toBe("F1");
  });

  it("turns each Help item into its action", () => {
    expect(clickAll(deps("win32"), "help")).toEqual([
      "help:",
      "help:shortcuts",
      "help:agents",
      "help:faq",
      "help:troubleshooting",
      "open:https://github.com/dqships/clipcat/releases",
      "open:https://github.com/dqships/clipcat/issues/new",
      "diagnostics",
      "logs",
      "updates",
    ]);
  });

  it("only opens help pages that exist", () => {
    for (const call of clickAll(deps("darwin"), "help").filter((c) => c.startsWith("help:"))) {
      const file = call.slice(5) || "README";
      expect(() => readFileSync(join(__dirname, "..", "..", "..", "docs", `${file}.md`))).not.toThrow();
    }
  });
});

describe("helpUrl", () => {
  it("points at the built help page, or the dev server's", () => {
    expect(helpUrl("", { appOrigin: "app://clipcat", devUrl: null })).toBe("app://clipcat/help.html");
    expect(helpUrl("agents", { appOrigin: "app://clipcat", devUrl: null })).toBe("app://clipcat/help.html?page=agents");
    expect(helpUrl("faq", { appOrigin: "app://clipcat", devUrl: "http://localhost:5173/" })).toBe("http://localhost:5173/help.html?page=faq");
  });
});

describe("issueUrl", () => {
  it("fills in the version and system", () => {
    const url = new URL(issueUrl({ version: "0.1.1", platform: "darwin", arch: "arm64", release: "15.1.0" }));
    expect(url.origin + url.pathname).toBe("https://github.com/dqships/clipcat/issues/new");
    expect(url.searchParams.get("body")).toContain("ClipCat 0.1.1, macOS 15.1.0 (arm64)");
  });
});
