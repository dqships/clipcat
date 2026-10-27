import { describe, expect, it } from "vitest";
import { formatDuration, mediaUrl } from "./format";

describe("format", () => {
  it("formats durations", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(75.4)).toBe("1:15");
    expect(formatDuration(3725)).toBe("1:02:05");
  });

  it("builds media URLs from project paths", () => {
    expect(mediaUrl("p-1", "media/s1/thumb-%04d.jpg")).toBe("media://p-1/s1/thumb-%2504d.jpg");
    expect(mediaUrl("p-1", "media/s1/proxy.mp4")).toBe("media://p-1/s1/proxy.mp4");
  });
});
