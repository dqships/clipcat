import { describe, expect, it } from "vitest";
import { asset, source } from "./fixtures";
import { defaultOverlay, overlayAt, overlayBox, overlayProposal, overlayTime, timedOverlays, validateDescriptions } from "./overlays";
import { slideAsset, slideName, unusedSlides } from "./slides";
import { buildTimeline } from "./timeline";

const seg = (id: string, sourceStart: number, sourceEnd: number, included = true) => ({ id, sourceId: "a", sourceStart, sourceEnd, included });

describe("timedOverlays", () => {
  const timeline = buildTimeline({ sources: [source("a", 30)], speed: 1, segments: [seg("1", 0, 10), seg("2", 10, 14, false), seg("3", 14, 30)] });
  const broll = (id: string, range: [number, number], assetId = "m1", status: "accepted" | "pending" = "accepted") =>
    overlayProposal({ id, sourceId: "a", wordIds: [], reason: "", confidence: 1, status }, defaultOverlay(range, assetId, "full"));
  const assets = [asset("m1"), { ...asset("m2"), prep: null }];

  it("times accepted b-roll on the output, straight across a cut", () => {
    const timed = timedOverlays({ assets, proposals: [broll("o1", [8, 16]), broll("o2", [20, 22], "m1", "pending")] }, timeline);
    expect(timed.map((o) => [o.id, o.start, o.end])).toEqual([["o1", 8, 12]]);
    expect(timed[0]!.asset.id).toBe("m1");
  });

  it("leaves out b-roll whose media is gone or not prepared yet", () => {
    expect(timedOverlays({ assets, proposals: [broll("o1", [0, 4], "m2"), broll("o2", [4, 6], "gone")] }, timeline)).toEqual([]);
  });

  it("ends earlier b-roll where the next one starts", () => {
    const timed = timedOverlays({ assets, proposals: [broll("o2", [5, 9]), broll("o1", [2, 7])] }, timeline);
    expect(timed.map((o) => [o.id, o.start, o.end])).toEqual([
      ["o1", 2, 5],
      ["o2", 5, 9],
    ]);
    expect(overlayAt(timed, 4.9)?.id).toBe("o1");
    expect(overlayAt(timed, 5)?.id).toBe("o2");
    expect(overlayAt(timed, 9)).toBeNull();
  });
});

describe("overlayTime", () => {
  it("plays a video on from its offset and holds its last frame; a picture stays put", () => {
    const o = { asset: asset("m", "video", 3), offset: 1, start: 10 };
    expect(overlayTime(o, 10.5)).toBe(1.5);
    expect(overlayTime(o, 20)).toBe(3);
    expect(overlayTime({ ...o, asset: asset("p", "image") }, 12)).toBe(0);
  });
});

describe("overlayBox", () => {
  const wide = { width: 1920, height: 1080 };
  const tall = { width: 1080, height: 1920 };

  it("fills the frame, or sits in a corner a margin in", () => {
    expect(overlayBox({ placement: "full", shape: "circle", corner: "top-left", size: 0.3 }, wide)).toEqual({ x: 0, y: 0, width: 1920, height: 1080, radius: 0 });
    // 0.35 of 1920 is 672 across, 378 down; the margin is 4% of 1080.
    expect(overlayBox({ placement: "pip", shape: "rectangle", corner: "top-right", size: 0.35 }, wide)).toEqual({ x: 1920 - 672 - 43, y: 43, width: 672, height: 378, radius: 30 });
    expect(overlayBox({ placement: "pip", shape: "circle", corner: "bottom-left", size: 0.4 }, tall)).toEqual({ x: 43, y: 1920 - 432 - 43, width: 432, height: 432, radius: 216 });
  });
});

describe("validateDescriptions", () => {
  it("maps numbers to media and lists what's missing or wrong", () => {
    const { descriptions, errors } = validateDescriptions(
      { descriptions: [{ media: 0, description: " A drone shot of a city " }, { media: 0, description: "again" }, { media: 5, description: "x" }] },
      [asset("m1"), asset("m2")],
    );
    expect([...descriptions]).toEqual([["m1", "A drone shot of a city"]]);
    expect(errors).toEqual(["description 1: media 0 is described twice", "description 2: media must be a number from 0 to 1", "media 1: not described"]);
  });
});

describe("slides", () => {
  it("names a slide from its brief and finds the ones nothing shows", () => {
    expect(slideName("  A very long first line that goes on and on past the limit of the list\nsecond")).toHaveLength(48);
    expect(slideName("")).toBe("Slide");
    const s = slideAsset("s1", "Hello", "paper", 3);
    expect(unusedSlides([s, asset("m1")], [{ overlay: null }])).toEqual(new Set(["s1"]));
    expect(unusedSlides([s], [{ overlay: { assetId: "s1" } }])).toEqual(new Set());
  });
});
