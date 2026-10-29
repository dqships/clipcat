import { buildTimeline, defaultOverlay, initialSegments, overlayProposal, punchProposal, setRange, slideAsset, timedOverlays, timedPunches } from "@clipcat/core";
import { asset, source } from "@clipcat/core/fixtures";
import { describe, expect, it } from "vitest";
import { audioCommand, chunkCommand, chunkList, chunkOverlays, exportChunks, exportSize, ffmetadata, frameTimeline, muxArgs, overlayFit, punchPieces } from "./export";

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

describe("punch-ins", () => {
  const punch = (id: string, range: [number, number], style: "cut" | "zoom-in" | "slow-zoom") =>
    punchProposal({ id, sourceId: "a", wordIds: [], reason: "", confidence: 1, status: "accepted" }, range, style);

  it("splits ranges where punch-ins start and end, across chunks, counting from the punch-in's start", () => {
    const { timeline } = setup();
    // a plays 0..2 then 4..10 (output 2..8); the punch-in covers source 1..5, output 1..3.
    const punches = timedPunches({ proposals: [punch("p", [1, 5], "slow-zoom")] }, timeline);
    expect(punches[0]).toMatchObject({ start: 1, end: 3 });
    const [first, second] = exportChunks(timeline, 75);
    const one = punchPieces(first!.items, punches, 30, 1);
    expect(one.map((x) => [x.from, x.frames, x.at, x.punch?.id ?? null])).toEqual([
      [0, 30, 0, null],
      [30, 30, 30, "p"],
      [120, 15, 60, "p"],
    ]);
    // The rest of the punch-in starts the next chunk, still counted from output frame 30.
    expect(punchPieces(second!.items, punches, 30, 1).map((x) => [x.from, x.frames, x.at, x.punch?.id ?? null])).toEqual([
      [135, 15, 75, "p"],
      [150, 60, 90, null],
    ]);
  });

  it("snaps in with a crop, and zooms with zoompan from where the piece starts", () => {
    const { timeline, shape } = setup();
    const chunk = exportChunks(timeline, 10_000)[0]!;
    const graph = (style: "cut" | "zoom-in" | "slow-zoom") =>
      chunkCommand({ ...shape, punches: timedPunches({ proposals: [punch("p", [1, 5], style)] }, timeline), chunk, captions: null, encoder: "libx264", out: "c.mp4" }).graph;
    expect(graph("cut")).toContain("scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,crop=w='trunc(iw/1.2500/2)*2':h='trunc(ih/1.2500/2)*2':x='(iw-ow)*0.5000':y='(ih-oh)*0.4000',scale=1920:1080:flags=lanczos");
    // Four branches now: before, the two halves of the punch-in either side of the cut, after.
    expect(graph("cut")).toContain("split=4[s0v0][s0v1][s0v2][s0v3]");
    // The second half starts 30 frames into the punch-in; a zoom-in has pushed in by then (9 frames).
    expect(graph("zoom-in")).toContain("zoompan=z='1+0.2000*min(1,(30+on)/9)':x='(iw-iw/zoom)*0.5000':y='(ih-ih/zoom)*0.4000':d=1:s=1920x1080:fps=30000/1000");
    expect(graph("slow-zoom")).toContain("scale=3840:2160:flags=bicubic,zoompan=z='1+0.1500*(30+on)/60'");
  });
});

describe("b-roll", () => {
  const { shape, timeline } = setup();
  const clip = asset("m1", "video", 3);
  const picture = asset("m2", "image");
  const at = (id: string, range: [number, number], a: typeof clip, placement: "full" | "pip") =>
    overlayProposal({ id, sourceId: "a", wordIds: [], reason: "", confidence: 1, status: "accepted" }, defaultOverlay(range, a.id, placement));
  // 1–3 s of "a" plays at 1–2 s (2–4 is cut); 6–7 s plays at 4–5 s.
  const overlays = timedOverlays({ assets: [clip, picture], proposals: [at("o1", [1, 3], clip, "full"), at("o2", [6, 7], picture, "pip")] }, timeline);

  it("cuts each one to the chunk it shows in, holding a short clip on its last stretch", () => {
    expect(chunkOverlays({ start: 0, frames: 45 }, overlays, 30)).toEqual([{ overlay: overlays[0], from: 30, frames: 15, at: 0 }]);
    expect(chunkOverlays({ start: 45, frames: 300 }, overlays, 30)).toEqual([
      { overlay: overlays[0], from: 0, frames: 15, at: 0.5 },
      { overlay: overlays[1], from: 75, frames: 30, at: 0 },
    ]);
    const late = { ...overlays[0]!, offset: 2.8 };
    expect(chunkOverlays({ start: 0, frames: 300 }, [late], 30)[0]!.at).toBe(2.5);
  });

  it("covers the frame, or crops into a window with a rounded mask", () => {
    expect(overlayFit(overlays[0]!, { width: 1920, height: 1080 })).toEqual({
      filter: "scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos,crop=1920:1080,setsar=1,format=yuv420p",
      x: 0,
      y: 0,
    });
    const round = overlayFit({ ...overlays[1]!, shape: "circle" }, { width: 1920, height: 1080 });
    expect(round).toMatchObject({ x: 1920 - 378 - 43, y: 43 });
    expect(round.filter).toBe(
      "scale=378:378:force_original_aspect_ratio=increase:flags=lanczos,crop=378:378,setsar=1,format=yuva420p,geq=lum='p(X,Y)':a='255*clip(189-hypot(max(abs(X+0.5-189)-0,0),max(abs(Y+0.5-189)-0,0))+0.5,0,1)'",
    );
  });

  it("keeps a slide's own transparency, full-frame or in a window", () => {
    const card = { ...overlays[0]!, asset: slideAsset("s1", "Hi", "overlay", 3) };
    expect(overlayFit(card, { width: 1920, height: 1080 }).filter).toMatch(/,format=yuva420p$/);
    expect(overlayFit({ ...card, placement: "pip", shape: "circle" }, { width: 1920, height: 1080 }).filter).toContain(":a='alpha(X,Y)*clip(");
    expect(chunkOverlays({ start: 45, frames: 300 }, [card], 30)[0]!.at).toBe(0.5);
  });

  it("reads each one for its part of the chunk and lays it over the picture, under the captions", () => {
    const overlayInputs = new Map([
      ["m1", "/v/clip.mov"],
      ["m2", "/p/m2/preview.png"],
    ]);
    const chunk = exportChunks(timeline, 1000)[0]!;
    const { graph, args } = chunkCommand({
      ...shape,
      overlays,
      overlayInputs,
      chunk,
      captions: { ass: "captions.ass", fontsDir: "fonts" },
      encoder: "libx264",
      out: "c.mp4",
    });
    expect(args.join(" ")).toContain("-ss 0.000000 -t 2.000000 -i /v/clip.mov -loop 1 -framerate 30 -t 2.000000 -i /p/m2/preview.png");
    const lines = graph.trim().split(";\n");
    expect(lines.slice(-6)).toEqual([
      "[cv]settb=1/30,setpts=N[b0]",
      expect.stringMatching(/^\[2:v:0\]fps=fps=30,tpad=stop_mode=clone:stop=-1,trim=end_frame=30,setpts=PTS-STARTPTS,scale=1920:1080:.*,settb=1\/30,setpts=N\+30\[o0\]$/),
      "[b0][o0]overlay=x=0:y=0:eof_action=pass:format=auto[b1]",
      expect.stringMatching(/^\[3:v:0\].*setpts=N\+120\[o1\]$/),
      "[b1][o1]overlay=x=1205:y=43:eof_action=pass:format=auto[b2]",
      "[b2]setpts=N+0,ass=filename=captions.ass:fontsdir=fonts,setpts=N[outv]",
    ]);
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

  it("lays effects and ducked music under the speech, landing each effect's hit on its moment", () => {
    const { timeline, shape } = setup();
    const cue = (id: string, effect: string, time: number, volume = 0.7) => ({ id, sourceId: "a", at: time, effect, volume, time });
    const { graph, args } = audioCommand({
      ...shape,
      timeline,
      out: "audio.m4a",
      sounds: {
        cues: [cue("p1", "whoosh", 0.2), cue("p2", "pop", 2, 1), cue("p3", "whoosh", 4)],
        files: new Map([["whoosh", "/sfx/whoosh.wav"], ["pop", "/sfx/pop.wav"]]),
        hits: new Map([["whoosh", 0.4], ["pop", 0]]),
      },
      music: { file: "/music.mp3", volume: 0.15, duck: true },
    });
    expect(args.join(" ")).toContain("-i /sfx/whoosh.wav -i /sfx/pop.wav -stream_loop -1 -i /music.mp3");
    expect(graph).toContain("concat=n=3:v=0:a=1[speech]");
    expect(graph).toContain("[2:a:0]aformat=sample_rates=48000:channel_layouts=stereo,asplit=2[e0c0][e0c1]");
    // The first whoosh would start before the video does, so it starts late into its file.
    expect(graph).toContain("[e0c0]atrim=start=0.200000,asetpts=PTS-STARTPTS,volume=0.700,adelay=0:all=1[x0_0]");
    expect(graph).toContain("[e0c1]volume=0.700,adelay=3600:all=1[x0_1]");
    expect(graph).toContain("[e1c0]volume=1.000,adelay=2000:all=1[x1_0]");
    expect(graph).toMatch(/\[4:a:0\]aformat=[^;]*atrim=0:[\d.]+,asetpts=PTS-STARTPTS,afade=t=in:d=1,afade=t=out:st=[\d.]+:d=[\d.]+,volume=0\.150\[mus\]/);
    expect(graph).toContain("[speech]asplit=2[sp][key]");
    expect(graph).toContain("[mus][key]sidechaincompress=threshold=0.02:ratio=6:attack=30:release=400[bed]");
    expect(graph).toContain("[sp][x0_0][x0_1][x1_0][bed]amix=inputs=5:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95:level=false[outa]");
  });

  it("mixes music without ducking straight in, and leaves speech alone when there is nothing to lay under it", () => {
    const { timeline, shape } = setup();
    const plain = audioCommand({ ...shape, timeline, out: "a.m4a" }).graph;
    expect(audioCommand({ ...shape, timeline, out: "a.m4a", sounds: { cues: [], files: new Map(), hits: new Map() }, music: null }).graph).toBe(plain);
    const { graph } = audioCommand({ ...shape, timeline, out: "a.m4a", music: { file: "/m.wav", volume: 0.3, duck: false } });
    expect(graph).not.toContain("sidechaincompress");
    expect(graph).toContain("[speech][mus]amix=inputs=2:");
  });
});

describe("ffmetadata", () => {
  it("writes the title and each chapter up to the next, escaping what the format reserves", () => {
    expect(ffmetadata("Tips; tricks = fun", [{ start: 0, title: "Intro" }, { start: 12.3456, title: "#1 tip" }], 30)).toBe(
      [";FFMETADATA1", "title=Tips\\; tricks \\= fun", "[CHAPTER]", "TIMEBASE=1/1000", "START=0", "END=12346", "title=Intro", "[CHAPTER]", "TIMEBASE=1/1000", "START=12346", "END=30000", "title=\\#1 tip", ""].join("\n"),
    );
    expect(ffmetadata("", [], 5)).toBe(";FFMETADATA1\n");
  });

  it("maps the chapters and title into the joined file only when there are some", () => {
    expect(muxArgs("c.txt", "a.m4a", "/o.mp4", "meta.txt").join(" ")).toContain("-i a.m4a -f ffmetadata -i meta.txt -map_metadata 2 -map_chapters 2 -map 0:v:0");
    expect(muxArgs("c.txt", "a.m4a", "/o.mp4")).not.toContain("ffmetadata");
  });

  it("adds the thumbnail as cover art after every input, numbered after the metadata when there is some", () => {
    expect(muxArgs("c.txt", "a.m4a", "/o.mp4", "meta.txt", "cover.png").join(" ")).toContain(
      "-i meta.txt -i cover.png -map_metadata 2 -map_chapters 2 -map 0:v:0 -map 1:a:0 -map 3:v:0 -c copy -c:v:1 png -disposition:v:1 attached_pic",
    );
    expect(muxArgs("c.txt", "a.m4a", "/o.mp4", null, "cover.png").join(" ")).toContain("-i cover.png -map 0:v:0 -map 1:a:0 -map 2:v:0");
    expect(muxArgs("c.txt", "a.m4a", "/o.mp4")).not.toContain("attached_pic");
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
