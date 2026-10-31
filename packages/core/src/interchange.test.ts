import { describe, expect, it } from "vitest";
import { initialSegments, setRange } from "./edits";
import { counter, source, words } from "./fixtures";
import { fileUrl, frameRate, interchange, timecode, toEdl, toFcpxml, toXmeml } from "./interchange";
import type { Project } from "./project";

function project(over: Partial<Project> = {}): Project {
  const id = counter("g");
  const a = source("a", 10);
  a.path = "/Users/dq/Movies/Take one & two.mov";
  // Keep 0-2 s and 4-10 s of a: one cut in the middle.
  const segments = setRange(initialSegments("a", 10, id), "a", [2, 4], false, id);
  return {
    version: 1,
    id: "p",
    name: "Launch",
    language: "en",
    aspectRatio: "16:9",
    bars: "black",
    speed: 1.5,
    revision: 1,
    brief: "",
    suggestedTitle: "",
    sources: [a],
    assets: [],
    music: [],
    transcript: words("a", "one two three four five six seven eight nine ten", 0),
    segments,
    proposals: [],
    captions: { enabled: true, mode: "sentence", font: "Jost", size: 54, color: "#FFFFFF", effect: "shadow", case: "regular", background: "none", boxColor: "#000000", position: 0.82 },
    history: { past: [], future: [] },
    lastExport: null,
    origin: null,
    shorts: [],
    writeup: null,
    thumbnail: null,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

describe("frame rates", () => {
  it("knows the NTSC rates and rounds the rest", () => {
    expect(frameRate(29.97)).toEqual({ num: 30000, den: 1001, timebase: 30, ntsc: true });
    expect(frameRate(23.976)).toEqual({ num: 24000, den: 1001, timebase: 24, ntsc: true });
    expect(frameRate(59.94)).toMatchObject({ num: 60000, timebase: 60, ntsc: true });
    expect(frameRate(25)).toEqual({ num: 25, den: 1, timebase: 25, ntsc: false });
    expect(frameRate(0)).toMatchObject({ num: 30, ntsc: false });
  });

  it("writes non-drop timecode", () => {
    expect(timecode(30 * 3600 + 30 * 61 + 7, frameRate(30))).toBe("01:01:01:07");
  });
});

describe("interchange", () => {
  it("lists the kept stretches at normal speed, end to end", () => {
    const x = interchange(project(), "Launch");
    expect(x.rate.num).toBe(30);
    expect(x.edits.map((e) => [e.in, e.out, e.record])).toEqual([
      [0, 60, 0],
      [120, 300, 60],
    ]);
    expect(x.duration).toBe(240);
  });

  it("puts chapters on the frame where their word plays", () => {
    const x = interchange(project({ writeup: { chapters: [{ wordId: "a-w0", title: "Start" }, { wordId: "a-w7", title: "Eight" }], description: "", article: { title: "", markdown: "" } } }), "x");
    // Word 7 starts at 4.2 s in the source, 0.2 s into the second stretch, which starts at frame 60.
    expect(x.markers).toEqual([
      { frame: 0, title: "Start" },
      { frame: 66, title: "Eight" },
    ]);
  });

  it("makes file URLs for macOS and Windows paths", () => {
    expect(fileUrl("/Users/dq/My Movies/a#1.mov")).toBe("file:///Users/dq/My%20Movies/a%231.mov");
    expect(fileUrl("C:\\Users\\dq\\Videos\\take.mp4")).toBe("file:///C:/Users/dq/Videos/take.mp4");
    expect(fileUrl("/x/y.mov", "localhost")).toBe("file://localhost/x/y.mov");
  });
});

describe("FCPXML", () => {
  it("has one asset and a clip per kept stretch, in rational time", () => {
    const text = toFcpxml(project({ writeup: { chapters: [{ wordId: "a-w0", title: "Start" }, { wordId: "a-w7", title: "Q&A" }], description: "", article: { title: "", markdown: "" } } }), "Launch <final>");
    expect(text).toContain('<fcpxml version="1.10">');
    expect(text).toContain('<format id="r1" frameDuration="1/30s" width="1920" height="1080"/>');
    expect(text).toContain('src="file:///Users/dq/Movies/Take%20one%20%26%20two.mov"');
    expect(text).toContain('name="Take one &amp; two.mov"');
    expect(text).toContain('<project name="Launch &lt;final&gt;">');
    expect(text).toContain('offset="0s" start="0s" duration="60/30s"');
    expect(text).toContain('offset="60/30s" start="120/30s" duration="180/30s" tcFormat="NDF">');
    // The marker sits in the clip's own time: its in point plus how far into the clip.
    expect(text).toContain('<chapter-marker start="126/30s" duration="1/30s" value="Q&amp;A" posterOffset="0s"/>');
    expect(text.match(/<asset id=/g)).toHaveLength(1);
  });

  it("counts 29.97 in 1001ths", () => {
    const p = project();
    p.sources[0]!.media.fps = 29.97;
    expect(toFcpxml(p, "x")).toContain('frameDuration="1001/30000s"');
  });
});

describe("Premiere XML", () => {
  it("describes the file once and refers to it after", () => {
    const text = toXmeml(project(), "Launch");
    expect(text.match(/<file id="file-1">/g)).toHaveLength(1);
    expect(text.match(/<file id="file-1"\/>/g)).toHaveLength(3);
    expect(text).toContain("<start>60</start><end>240</end><in>120</in><out>300</out>");
    expect(text).toContain("<pathurl>file://localhost/Users/dq/Movies/Take%20one%20%26%20two.mov</pathurl>");
  });
});

describe("EDL", () => {
  it("writes CMX 3600 events from 01:00:00:00 with the clip name", () => {
    const text = toEdl(project(), "Launch");
    expect(text.split("\n").slice(0, 6)).toEqual([
      "TITLE: Launch",
      "FCM: NON-DROP FRAME",
      "",
      "001  AX       AA/V  C        00:00:00:00 00:00:02:00 01:00:00:00 01:00:02:00",
      "* FROM CLIP NAME: Take one & two.mov",
      "* SOURCE FILE: /Users/dq/Movies/Take one & two.mov",
    ]);
    expect(text).toContain("002  AX       AA/V  C        00:00:04:00 00:00:10:00 01:00:02:00 01:00:08:00");
  });
});
