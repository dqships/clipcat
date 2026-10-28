import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SlideFrame, designKey, seekSlide, slideUrl } from "./SlideFrame";

// jsdom has no layout, so nothing resizes.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

describe("SlideFrame", () => {
  it("loads the slide's page sandboxed, at its own size, from a URL that changes with the design", () => {
    const asset = { id: "g1", slide: { brief: "Hi", look: "paper" as const, html: "<h1>Hi</h1>" }, media: { duration: 2, width: 1920, height: 1080 } };
    expect(designKey("<h1>Hi</h1>")).toBe(designKey("<h1>Hi</h1>"));
    expect(designKey("<h1>Hi</h1>")).not.toBe(designKey("<h1>Ho</h1>"));
    const onLoad = vi.fn();
    const { container } = render(<SlideFrame projectId="p1" asset={asset} frame={{ width: 1920, height: 1080 }} onLoad={onLoad} />);
    const frame = container.querySelector("iframe")!;
    expect(frame.getAttribute("src")).toBe(slideUrl("p1", asset));
    expect(frame.getAttribute("src")).toMatch(/^slide:\/\/p1\/g1\?v=/);
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.style.width).toBe("1920px");
  });

  it("moves the slide by message", () => {
    const post = vi.fn();
    seekSlide({ contentWindow: { postMessage: post } } as unknown as HTMLIFrameElement, 1.5);
    expect(post).toHaveBeenCalledWith({ type: "clipcat-seek", t: 1.5 }, "*");
    seekSlide(null, 1);
  });
});
