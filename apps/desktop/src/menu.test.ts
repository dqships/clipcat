import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ BrowserWindow: class {}, nativeTheme: {}, shell: {} }));
import { helpUrl, issueUrl } from "./help";
import { type MenuDeps, menuTemplate } from "./menu";

const deps = (platform: NodeJS.Platform): MenuDeps & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    platform,
    help: (page) => calls.push(`help:${page}`),
    open: (url) => calls.push(`open:${url}`),
    issueUrl: () => "https://github.com/dqships/clipcat/issues/new",
    releasesUrl: "https://github.com/dqships/clipcat/releases",
    saveDiagnostics: () => calls.push("diagnostics"),
    showLogs: () => calls.push("logs"),
  };
};

const help = (template: MenuItemConstructorOptions[]) => template.find((m) => m.role === "help")!.submenu as MenuItemConstructorOptions[];
const click = (item: MenuItemConstructorOptions) => (item.click as () => void)();

describe("the menu bar", () => {
  it("has the app menu on macOS only", () => {
    expect(menuTemplate(deps("darwin"))[0]!.role).toBe("appMenu");
    expect(menuTemplate(deps("win32")).some((m) => m.role === "appMenu")).toBe(false);
  });

  it("opens help with ⌘? on macOS and F1 on Windows", () => {
    expect(help(menuTemplate(deps("darwin")))[0]).toMatchObject({ label: "ClipCat Help", accelerator: "Cmd+?" });
    expect(help(menuTemplate(deps("win32")))[0]).toMatchObject({ label: "ClipCat Help", accelerator: "F1" });
  });

  it("turns each Help item into its action", () => {
    const d = deps("darwin");
    for (const item of help(menuTemplate(d))) if (item.click) click(item);
    expect(d.calls).toEqual([
      "help:",
      "help:shortcuts",
      "help:agents",
      "help:faq",
      "help:troubleshooting",
      "open:https://github.com/dqships/clipcat/releases",
      "open:https://github.com/dqships/clipcat/issues/new",
      "diagnostics",
      "logs",
    ]);
  });

  it("only opens help pages that exist", () => {
    const d = deps("darwin");
    for (const item of help(menuTemplate(d))) if (item.click) click(item);
    for (const call of d.calls.filter((c) => c.startsWith("help:"))) {
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
    const url = new URL(issueUrl({ version: "0.1.1", platform: "darwin", arch: "arm64", release: "24.1.0" }));
    expect(url.origin + url.pathname).toBe("https://github.com/dqships/clipcat/issues/new");
    expect(url.searchParams.get("body")).toContain("ClipCat 0.1.1, macOS 24.1.0 (arm64)");
  });
});
