import { buildTimeline, initialSegments, setRange } from "@clipcat/core";
import { source } from "@clipcat/core/fixtures";
import { describe, expect, it } from "vitest";
import { audioCommand, chunkCommand, chunkList, exportChunks, exportSize, frameTimeline, muxArgs } from "./export";

let n = 0;
const id = () => `g${++n}`;

/** Two recordings, 10 s and 5 s, with 2–4 s of the first cut. */
function setup(speed = 1) {
  const sources = [source("a", 10), source("b", 5, 1)];
  let segments = [...initialSegments("a", 10, id), ...initialSegments("b", 5, id)];
  segments = setRange(segments, "a", [2, 4], false, id);
  const project = { sources, speed };
  const timeline = frameTimeline(buildTimeline({ ...project, segments }), 30);
  const inputs = new Map([
    ["a", "/v/a.mov"],
    ["b", "/v/b.mov"],
  ]);
  return { project, timeline, inputs, shape: { project, format: "16:9" as const, fps: 30, inputs, graphFile: "graph.txt" } };
}

describe("exportSize", () => {
  it("keeps landscape at the recording's height, up to 1440p", () => {
    expect(exportSize("16:9", [source("a", 1)])).toEqual({ width: 1920, height: 1080 });
    const big = { ...source("a", 1), media: { ...source("a", 1).media, width: 3840, height: 2160 } };
    expect(exportSize("16:9", [big])).toEqual({ width: 2560, height: 1440 });
    expect(exportSize("9:16", [big])).toEqual({ width: 1080, height: 1920 });
  });
});

describe("frameTimeline", () => {
  it("snaps every kept range to whole frames, laid end to end", () => {
    const { timeline } = setup();
    expect(timeline.items.map((i) => [i.sourceId, i.from, i.frames])).toEqual([
      ["a", 0, 60],
      ["a", 120, 180],
      ["b", 0, 150],
    ]);
    expect(timeline.frames).toBe(390);
    expect(timeline.items[1]!.outputStart).toBeCloseTo(2);
    expect(timeline.duration).toBeCloseTo(13);
  });

  it("counts frames in output time when the speed changes", () => {
    const { timeline } = setup(1.25);
    // 13 s of source at 1.25× is 10.4 s, 312 frames.
    expect(timeline.frames).toBe(312);
    expect(timeline.items[1]!.sourceStart).toBeCloseTo(4);
  });

  it("drops ranges too short for a frame", () => {
    const t = frameTimeline(
      { speed: 1, duration: 0.01, items: [{ segmentId: "s", sourceId: "a", sourceStart: 1, sourceEnd: 1.01, outputStart: 0, outputEnd: 0.01 }] },
      30,
    );
    expect(t.items).toEqual([]);
  });
});

describe("exportChunks", () => {
  it("fills each chunk to the size, splitting a range that crosses the boundary", () => {
    const { timeline } = setup();
    const chunks = exportChunks(timeline, 100);
    expect(chunks.map((c) => [c.start, c.frames])).toEqual([
      [0, 100],
      [100, 100],
      [200, 100],
      [300, 90],
    ]);
    expect(chunks[0]!.items.map((i) => [i.sourceId, i.from, i.frames])).toEqual([
      ["a", 0, 60],
      ["a", 120, 40],
    ]);
    expect(chunks[1]!.items.map((i) => [i.from, i.frames])).toEqual([[160, 100]]);
    expect(exportChunks(timeline, 10_000)).toHaveLength(1);
  });
});

describe("chunkCommand", () => {
  it("seeks to the chunk, cuts by frame and numbers frames from the chunk's start for the captions", () => {
    const { timeline, shape } = setup();
    const chunk = exportChunks(timeline, 100)[0]!;
    const { graph, args } = chunkCommand({ ...shape, chunk, captions: { ass: "captions.ass", fontsDir: "fonts" }, encoder: "libx264", out: "chunk-000.mp4" });
    expect(args.filter((a) => a === "-i")).toHaveLength(1);
    expect(args).toEqual(expect.arrayContaining(["-ss", "0.000000", "-i", "/v/a.mov", "-an", "-map", "[outv]", "chunk-000.mp4"]));
    expect(graph).toContain("[0:v:0]fps=fps=30000/1000:start_time=0,split=2[s0v0][s0v1]");
    expect(graph).toContain("[s0v1]trim=start_frame=120:end_frame=160,setpts=PTS-STARTPTS,scale=1920:1080");
    expect(graph).toContain("concat=n=2:v=1:a=0[cv]");
    expect(graph).toContain("[cv]settb=1/30,setpts=N+0,ass=filename=captions.ass:fontsdir=fonts,setpts=N[outv]");

    const later = exportChunks(timeline, 100)[2]!;
    const second = chunkCommand({ ...shape, chunk: later, captions: null, encoder: "libx264", out: "chunk-002.mp4" });
    // Chunk 2 is the last 40 frames of a (from frame 260) and the first 60 of b.
    expect(second.args).toEqual(expect.arrayContaining(["-ss", "8.666667", "-i", "/v/a.mov", "-ss", "0.000000", "-i", "/v/b.mov"]));
    expect(second.graph).toContain("[s0v0]trim=start_frame=0:end_frame=40");
    expect(second.graph).not.toContain("ass=");
  });

  it("crops for vertical and reads the speed change as a slower frame grid", () => {
    const { timeline, shape } = setup(1.25);
    const chunk = exportChunks(timeline, 10_000)[0]!;
    const { graph } = chunkCommand({ ...shape, format: "9:16", chunk, captions: null, encoder: "libx264", out: "c.mp4" });
    expect(graph).toContain("fps=fps=30000/1250:start_time=0,split=");
    expect(graph).toContain("setpts=PTS-STARTPTS,crop=w='min(iw,ih*0.562500)':h='min(ih,iw/0.562500)':x='(iw-ow)*0.5000'");
    expect(graph).toContain("[cv]settb=1/30,setpts=N[outv]");
  });

  it("moves the vertical crop to the speaker at each cut, and holds a hand-set position", () => {
    const { timeline, shape } = setup();
    // The speaker sits left in a's first range and right in its second.
    const a = { ...shape.project.sources[0]!, faces: [{ t: 1, x: 0.3 }, { t: 6, x: 0.7 }] };
    const project = { ...shape.project, sources: [a, shape.project.sources[1]!] };
    const chunk = exportChunks(timeline, 10_000)[0]!;
    const crops = (p: typeof project) =>
      [...chunkCommand({ ...shape, project: p, format: "9:16", chunk, captions: null, encoder: "libx264", out: "c.mp4" }).graph.matchAll(/x='\(iw-ow\)\*([\d.]+)'/g)].map((m) => Number(m[1]));
    const [first, second, third] = crops(project);
    expect(first).toBeCloseTo((0.3 - 0.31640625 / 2) / (1 - 0.31640625), 3);
    expect(second).toBeCloseTo((0.7 - 0.31640625 / 2) / (1 - 0.31640625), 3);
    // b found no faces: the middle.
    expect(third).toBe(0.5);
    const held = { ...project, sources: [{ ...a, framing: "manual" as const, frameX: 0.5 }, project.sources[1]!] };
    expect(crops(held).slice(0, 2)).toEqual([0.5, 0.5]);
  });
});

describe("audioCommand", () => {
  it("cuts the sound by sample on the same grid, then changes its speed", () => {
    const { timeline, shape } = setup(1.25);
    const { graph, args } = audioCommand({ ...shape, timeline, out: "audio.m4a" });
    expect(args.filter((a) => a === "-i")).toHaveLength(2);
    expect(graph).toContain("asplit=2[s0a0][s0a1]");
    expect(graph).toContain("[s0a1]atrim=start_sample=192000:end_sample=480000");
    expect(graph).toContain("concat=n=3:v=0:a=1[ca]");
    expect(graph).toContain("[ca]atempo=1.25[outa]");
    expect(args).toEqual(expect.arrayContaining(["-map", "[outa]", "-vn", "audio.m4a"]));
    expect(audioCommand({ ...setup().shape, timeline: setup().timeline, out: "a.m4a" }).graph).not.toContain("atempo");
  });
});

describe("muxArgs", () => {
  it("joins the chunks and the sound without re-encoding", () => {
    expect(chunkList(["chunk-000.mp4", "chunk-001.mp4"])).toBe("ffconcat version 1.0\nfile 'chunk-000.mp4'\nfile 'chunk-001.mp4'\n");
    expect(muxArgs("chunks.txt", "audio.m4a", "/o.mp4")).toEqual(
      expect.arrayContaining(["-f", "concat", "-i", "chunks.txt", "-i", "audio.m4a", "-c", "copy", "+faststart", "/o.mp4"]),
    );
  });
});
