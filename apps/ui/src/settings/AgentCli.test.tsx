import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentCli } from "./AgentCli";

afterEach(() => {
  cleanup();
  delete window.clipcat;
});

const cli = (over: object = {}) => ({
  id: "codex",
  label: "Codex",
  path: "/Users/me/.local/bin/codex",
  version: "0.157.1",
  source: "native",
  latest: "0.165.0",
  action: "update",
  command: "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
  manual: null,
  warning: null,
  ...over,
});

/** A bridge whose `cli:run` waits until the test lets it finish. */
function fakeBridge(status: object, run: () => Promise<unknown>) {
  const listeners = new Set<(p: unknown) => void>();
  const invoke = vi.fn(async (method: string) => (method === "cli:run" ? run() : status));
  window.clipcat = {
    invoke,
    on: (_event: string, listener: (p: unknown) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    pathForFile: () => "",
  } as never;
  return { invoke, emit: (payload: unknown) => act(() => listeners.forEach((l) => l(payload))) };
}

describe("AgentCli", () => {
  it("updates an old CLI, showing the installer's progress and the warning", async () => {
    let finish: (v: unknown) => void = () => {};
    const warning = "Your codex command is 0.157.1, older than the ChatGPT app's Codex (0.164.0), and both read ~/.codex/config.toml.";
    const { invoke, emit } = fakeBridge(cli({ warning }), () => new Promise((resolve) => (finish = resolve)));
    render(<AgentCli cli="codex" />);
    expect(await screen.findByText("Version 0.157.1. 0.165.0 is out.")).toBeTruthy();
    expect(screen.getByRole("note").textContent).toBe(warning);
    expect(screen.getByText("curl -fsSL https://chatgpt.com/codex/install.sh | sh")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Update to 0.165.0" }));
    expect(invoke).toHaveBeenCalledWith("cli:run", { id: "codex" });
    expect((screen.getByRole("button", { name: "Updating…" }) as HTMLButtonElement).disabled).toBe(true);
    emit({ id: "claude", line: "not this one" });
    emit({ id: "codex", line: "Downloading Codex 0.165.0" });
    expect(screen.getByText("Downloading Codex 0.165.0")).toBeTruthy();
    expect(screen.queryByText("not this one")).toBeNull();

    await act(async () => finish(cli({ version: "0.165.0", action: null, command: null })));
    expect(await screen.findByText("Updated to Codex 0.165.0.")).toBeTruthy();
    expect(screen.getByText("Version 0.165.0, the newest.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("installs a missing CLI and shows why it failed", async () => {
    fakeBridge(cli({ id: "claude", label: "Claude Code", path: null, version: null, action: "install", command: "curl -fsSL https://claude.ai/install.sh | bash" }), () =>
      Promise.reject(new Error("Error invoking remote method 'cli:run': Error: curl -fsSL https://claude.ai/install.sh | bash failed (exit 1): curl: (6) Could not resolve host")),
    );
    render(<AgentCli cli="claude" />);
    expect(await screen.findByText("The Claude Code command-line tool isn't installed. The newest is 0.165.0.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Install Claude Code" }));
    expect((await screen.findByRole("alert")).textContent).toBe("curl -fsSL https://claude.ai/install.sh | bash failed (exit 1): curl: (6) Could not resolve host");
    expect(screen.getByRole("button", { name: "Install Claude Code" })).toBeTruthy();
  });

  it("says how to update a copy it can't update itself", async () => {
    fakeBridge(cli({ source: "app", action: null, command: null, manual: "This Codex came with an app. Update the app to update it." }), () => Promise.resolve(null));
    render(<AgentCli cli="codex" />);
    expect(await screen.findByText("This Codex came with an app. Update the app to update it.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
