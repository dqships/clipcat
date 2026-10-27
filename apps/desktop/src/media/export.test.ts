import { buildTimeline, initialSegments, setRange } from "@clipcat/core";
import { source } from "@clipcat/core/fixtures";
import { describe, expect, it } from "vitest";
import { exportCommand, exportSize } from "./export";

let n = 0;
const id = () => `g${++n}`;

function plan(format: "16:9" | "9:16", speed = 1, captions = true) {
  const sources = [source("a", 10), source("b", 5, 1)];
  let segments = [...initialSegments("a", 10, id), ...initialSegments("b", 5, id)];
  segments = setRange(segments, "a", [2, 4], false, id);
  const project = { sources, speed };
  return exportCommand({
    project,
    timeline: buildTimeline({ ...project, segments }),
    format,
    inputs: new Map([
      ["a", "/v/a.mov"],
      ["b", "/v/b.mov"],
    ]),
    captions: captions ? { ass: "captions.ass", fontsDir: "fonts" } : null,
    encoder: "libx264",
    graphFile: "graph.txt",
    out: "/out/x.mp4",
  });
}

describe("exportSize", () => {
  it("keeps landscape at the recording's height, up to 1440p", () => {
    expect(exportSize("16:9", [source("a", 1)])).toEqual({ width: 1920, height: 1080 });
    const big = { ...source("a", 1), media: { ...source("a", 1).media, width: 3840, height: 2160 } };
    expect(exportSize("16:9", [big])).toEqual({ width: 2560, height: 1440 });
    expect(exportSize("9:16", [big])).toEqual({ width: 1080, height: 1920 });
  });
});

describe("exportCommand", () => {
  it("reads each recording once and splits it per kept range", () => {
    const { graph, args } = plan("16:9");
    expect(args.filter((a) => a === "-i")).toHaveLength(2);
    expect(graph).toContain("[0:v:0]fps=30,scale=1920:1080");
    expect(graph).toContain("split=2[s0v0][s0v1]");
    expect(graph).toContain("[s0v1]trim=start=4.000000:end=10.000000");
    expect(graph).toContain("concat=n=3:v=1:a=1[cv][ca]");
    expect(graph).toContain("[cv]ass=filename=captions.ass:fontsdir=fonts[outv]");
    expect(args).toEqual(expect.arrayContaining(["-filter_complex_script", "graph.txt", "-map", "[outv]", "-map", "[ca]", "+faststart"]));
  });

  it("crops for vertical, changes speed and can leave captions out", () => {
    const { graph, args } = plan("9:16", 1.25, false);
    expect(graph).toContain("crop=w='min(iw,ih*0.562500)'");
    expect(graph).toContain("[cv]setpts=PTS/1.25[sv]");
    expect(graph).toContain("[ca]atempo=1.25[sa]");
    expect(graph).not.toContain("ass=");
    expect(args).toEqual(expect.arrayContaining(["-map", "[sv]", "-map", "[sa]"]));
  });

  it("refuses an edit with nothing left", () => {
    expect(() =>
      exportCommand({
        project: { sources: [source("a", 1)], speed: 1 },
        timeline: { items: [], duration: 0, speed: 1 },
        format: "16:9",
        inputs: new Map(),
        captions: null,
        encoder: "libx264",
        graphFile: "g",
        out: "o",
      }),
    ).toThrow(/Nothing is left/);
  });
});
