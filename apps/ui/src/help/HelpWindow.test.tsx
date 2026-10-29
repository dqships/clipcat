import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { HelpWindow } from "./HelpWindow";

// jsdom doesn't scroll.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("HelpWindow", () => {
  it("opens at the page in the address", () => {
    window.history.replaceState(null, "", "/help.html?page=shortcuts");
    render(<HelpWindow />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Keyboard shortcuts");
  });

  it("opens at the overview for an unknown page", () => {
    window.history.replaceState(null, "", "/help.html?page=nope");
    render(<HelpWindow />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("ClipCat help");
  });

  it("turns the page from the list and from links in a page", () => {
    window.history.replaceState(null, "", "/help.html");
    render(<HelpWindow />);
    fireEvent.click(within(screen.getByRole("navigation", { name: "Help pages" })).getByRole("link", { name: "Fix a problem" }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Fix a problem");
    expect(window.location.search).toBe("?page=troubleshooting");
    const inPage = document.querySelector<HTMLAnchorElement>('.help__body a[href^="?page=agents"]')!;
    fireEvent.click(inPage);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Use ClipCat from Claude or Codex");
  });

  it("searches the pages", () => {
    render(<HelpWindow />);
    fireEvent.change(screen.getByPlaceholderText("Search the help"), { target: { value: "whisper" } });
    expect(screen.getByRole("list", { name: "Pages that match" }).textContent).toContain("Settings");
    fireEvent.change(screen.getByPlaceholderText("Search the help"), { target: { value: "zzqx" } });
    expect(screen.getByText(/No page mentions/).textContent).toContain("zzqx");
  });
});
