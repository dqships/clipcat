// The edit as a timeline other editors open: FCPXML for Final Cut Pro (and
// DaVinci Resolve), Final Cut 7 XML for Premiere Pro (and Resolve), and a
// CMX 3600 EDL for anything else. Each lists the kept stretches of the
// original recordings, frame-snapped, end to end, so the user can finish the
// cut by hand. Speed, captions, punch-ins, b-roll and sound aren't carried:
// the other editor does those its own way. Chapters become markers.

import type { Project, Source } from "./project";
import { buildTimeline } from "./timeline";
import { timedChapters } from "./writeup";

/** A frame rate as editors spell it: 29.97 is 30000/1001, counted in 30 frames a second with ntsc set. */
export type Rate = { num: number; den: number; timebase: number; ntsc: boolean };

/** The standard rate nearest `fps`; 30 when there's no video to go by. */
export function frameRate(fps: number): Rate {
  if (!(fps > 0)) return { num: 30, den: 1, timebase: 30, ntsc: false };
  for (const base of [24, 30, 60]) {
    if (Math.abs(fps - (base * 1000) / 1001) < 0.01) return { num: base * 1000, den: 1001, timebase: base, ntsc: true };
  }
  const whole = Math.max(1, Math.round(fps));
  return { num: whole, den: 1, timebase: whole, ntsc: false };
}

const framesAt = (seconds: number, rate: Rate) => Math.round((seconds * rate.num) / rate.den);

/** One kept stretch: source frames [in, out) placed at `record` on the sequence. */
export type Edit = { source: Source; in: number; out: number; record: number };

export type Interchange = {
  name: string;
  rate: Rate;
  width: number;
  height: number;
  edits: Edit[];
  /** Sequence length in frames. */
  duration: number;
  markers: { frame: number; title: string }[];
};

/**
 * The kept stretches at normal speed, in sequence frames. Each stretch is
 * snapped to whole frames on its own, then laid end to end, so no gap or
 * overlap creeps in; one too short to hold a frame is dropped.
 */
export function interchange(project: Project, name: string): Interchange {
  const video = [...project.sources].sort((a, b) => a.order - b.order).find((s) => s.media.width > 0);
  const rate = frameRate(video?.media.fps ?? 0);
  const timeline = buildTimeline({ ...project, speed: 1 });
  const byId = new Map(project.sources.map((s) => [s.id, s]));
  const edits: Edit[] = [];
  /** The edit each timeline item became, by item index; dropped items have none. */
  const editOf = new Map<number, Edit>();
  let record = 0;
  timeline.items.forEach((item, index) => {
    const source = byId.get(item.sourceId)!;
    const last = Math.floor((source.media.duration * rate.num) / rate.den);
    const a = Math.min(framesAt(item.sourceStart, rate), last);
    const b = Math.min(framesAt(item.sourceEnd, rate), last);
    if (b <= a) return;
    const edit = { source, in: a, out: b, record };
    edits.push(edit);
    editOf.set(index, edit);
    record += b - a;
  });
  // Chapters are timed on the unsnapped timeline, so each is placed within the stretch it falls in.
  const markers = timedChapters(project, timeline).map((c) => {
    let index = -1;
    timeline.items.forEach((item, i) => {
      if (item.outputStart <= c.start + 1e-6 && editOf.has(i)) index = i;
    });
    const edit = editOf.get(index);
    if (!edit) return { frame: 0, title: c.title };
    const into = framesAt(c.start - timeline.items[index]!.outputStart, rate);
    return { frame: edit.record + Math.max(0, Math.min(into, edit.out - edit.in - 1)), title: c.title };
  });
  return { name, rate, width: video?.media.width || 1920, height: video?.media.height || 1080, edits, duration: record, markers };
}

/** A file URL for `path`, on macOS or Windows, with each part percent-encoded. */
export function fileUrl(path: string, host = ""): string {
  const parts = path.replace(/\\/g, "/").split("/");
  const drive = /^[A-Za-z]:$/.test(parts[0] ?? "");
  const encoded = parts.map((p, i) => (i === 0 && drive ? p : encodeURIComponent(p)));
  return `file://${host}${drive ? "/" : ""}${encoded.join("/")}`;
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const baseName = (path: string) => path.split(/[\\/]/).at(-1) ?? path;
const hasVideo = (s: Source) => s.media.width > 0;

// --- FCPXML -----------------------------------------------------------------

/** A time in FCPXML's rational seconds: frames × frame duration. */
const fcpTime = (frames: number, rate: Rate) => (frames === 0 ? "0s" : `${frames * rate.den}/${rate.num}s`);

export function toFcpxml(project: Project, name: string): string {
  const x = interchange(project, name);
  const { rate } = x;
  const used = [...new Map(x.edits.map((e) => [e.source.id, e.source])).values()];
  const asset = new Map(used.map((s, i) => [s.id, `r${i + 2}`]));
  const frameDuration = fcpTime(1, rate);
  const lines = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE fcpxml>`,
    `<fcpxml version="1.10">`,
    `  <resources>`,
    `    <format id="r1" frameDuration="${frameDuration}" width="${x.width}" height="${x.height}"/>`,
    ...used.map((s) => {
      const length = fcpTime(Math.floor((s.media.duration * rate.num) / rate.den), rate);
      const video = hasVideo(s) ? ` hasVideo="1" format="r1"` : "";
      return [
        `    <asset id="${asset.get(s.id)}" name="${xml(baseName(s.path))}" start="0s" duration="${length}"${video} hasAudio="${s.media.audioCodec ? 1 : 0}" audioSources="1" audioChannels="2">`,
        `      <media-rep kind="original-media" src="${xml(fileUrl(s.path))}"/>`,
        `    </asset>`,
      ].join("\n");
    }),
    `  </resources>`,
    `  <library>`,
    `    <event name="ClipCat">`,
    `      <project name="${xml(name)}">`,
    `        <sequence format="r1" duration="${fcpTime(x.duration, rate)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">`,
    `          <spine>`,
  ];
  for (const e of x.edits) {
    const markers = x.markers.filter((m) => m.frame >= e.record && m.frame < e.record + (e.out - e.in));
    const open = `            <asset-clip ref="${asset.get(e.source.id)}" name="${xml(baseName(e.source.path))}" offset="${fcpTime(e.record, rate)}" start="${fcpTime(e.in, rate)}" duration="${fcpTime(e.out - e.in, rate)}" tcFormat="NDF"`;
    if (markers.length === 0) {
      lines.push(`${open}/>`);
      continue;
    }
    lines.push(`${open}>`);
    for (const m of markers) {
      // A marker's start is in the clip's own time, which runs on from its source in point.
      lines.push(`              <chapter-marker start="${fcpTime(e.in + m.frame - e.record, rate)}" duration="${frameDuration}" value="${xml(m.title)}" posterOffset="0s"/>`);
    }
    lines.push(`            </asset-clip>`);
  }
  lines.push(`          </spine>`, `        </sequence>`, `      </project>`, `    </event>`, `  </library>`, `</fcpxml>`, ``);
  return lines.join("\n");
}

// --- Final Cut 7 XML (Premiere Pro) ----------------------------------------

const xmemlRate = (r: Rate) => `<rate><timebase>${r.timebase}</timebase><ntsc>${r.ntsc ? "TRUE" : "FALSE"}</ntsc></rate>`;

export function toXmeml(project: Project, name: string): string {
  const x = interchange(project, name);
  const { rate } = x;
  const fileIds = new Map<string, string>();
  const described = new Set<string>();
  const sourceFrames = (s: Source) => Math.floor((s.media.duration * rate.num) / rate.den);
  for (const e of x.edits) if (!fileIds.has(e.source.id)) fileIds.set(e.source.id, `file-${fileIds.size + 1}`);

  /** The file, described in full the first time it appears and by id after. */
  const file = (s: Source) => {
    const id = fileIds.get(s.id)!;
    if (described.has(id)) return `<file id="${id}"/>`;
    described.add(id);
    const video = hasVideo(s) ? `<video><samplecharacteristics><width>${s.media.width}</width><height>${s.media.height}</height></samplecharacteristics></video>` : "";
    return `<file id="${id}"><name>${xml(baseName(s.path))}</name><pathurl>${xml(fileUrl(s.path, "localhost"))}</pathurl>${xmemlRate(rate)}<duration>${sourceFrames(s)}</duration><media>${video}<audio><channelcount>2</channelcount></audio></media></file>`;
  };

  const clip = (e: Edit, i: number, kind: "video" | "audio") =>
    [
      `          <clipitem id="${kind}-${i + 1}">`,
      `            <name>${xml(baseName(e.source.path))}</name>`,
      `            <duration>${sourceFrames(e.source)}</duration>`,
      `            ${xmemlRate(rate)}`,
      `            <start>${e.record}</start><end>${e.record + e.out - e.in}</end><in>${e.in}</in><out>${e.out}</out>`,
      `            ${file(e.source)}`,
      ...(kind === "audio" ? [`            <sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>`] : []),
      `          </clipitem>`,
    ].join("\n");

  const videoEdits = x.edits.filter((e) => hasVideo(e.source));
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE xmeml>`,
    `<xmeml version="4">`,
    `  <sequence id="sequence-1">`,
    `    <name>${xml(name)}</name>`,
    `    <duration>${x.duration}</duration>`,
    `    ${xmemlRate(rate)}`,
    `    <timecode>${xmemlRate(rate)}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>`,
    `    <media>`,
    `      <video>`,
    `        <format><samplecharacteristics>${xmemlRate(rate)}<width>${x.width}</width><height>${x.height}</height><pixelaspectratio>square</pixelaspectratio></samplecharacteristics></format>`,
    `        <track>`,
    ...videoEdits.map((e, i) => clip(e, i, "video")),
    `        </track>`,
    `      </video>`,
    `      <audio>`,
    `        <track>`,
    ...x.edits.map((e, i) => clip(e, i, "audio")),
    `        </track>`,
    `      </audio>`,
    `    </media>`,
    ...x.markers.map((m) => `    <marker><name>${xml(m.title)}</name><comment></comment><in>${m.frame}</in><out>-1</out></marker>`),
    `  </sequence>`,
    `</xmeml>`,
    ``,
  ].join("\n");
}

// --- CMX 3600 EDL ------------------------------------------------------------

/** Non-drop timecode, counting `timebase` frames a second. */
export function timecode(frames: number, rate: Rate): string {
  const fps = rate.timebase;
  const f = frames % fps;
  const s = Math.floor(frames / fps);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(f)}`;
}

/** The sequence starts at 01:00:00:00, as editors expect from an EDL. */
const RECORD_START_HOURS = 1;

export function toEdl(project: Project, name: string): string {
  const x = interchange(project, name);
  const { rate } = x;
  const start = RECORD_START_HOURS * 3600 * rate.timebase;
  const title = name.replace(/[\r\n]+/g, " ").slice(0, 70);
  const lines = [`TITLE: ${title}`, `FCM: NON-DROP FRAME`, ``];
  x.edits.forEach((e, i) => {
    // The reel is a placeholder; editors relink by the clip name and source file below.
    const event = String(i + 1).padStart(3, "0");
    const track = hasVideo(e.source) ? "AA/V" : "AA";
    const tc = [e.in, e.out, start + e.record, start + e.record + e.out - e.in].map((f) => timecode(f, rate)).join(" ");
    lines.push(`${event}  ${"AX".padEnd(8)} ${track.padEnd(5)} C        ${tc}`, `* FROM CLIP NAME: ${baseName(e.source.path)}`, `* SOURCE FILE: ${e.source.path}`, ``);
  });
  for (const m of x.markers) lines.push(`* CHAPTER ${timecode(start + m.frame, rate)}: ${m.title.replace(/[\r\n]+/g, " ")}`);
  return `${lines.join("\n").trimEnd()}\n`;
}

/** The timeline formats, as the save dialog and the MCP tool name them. */
export const TIMELINE_FORMATS = {
  fcpxml: { label: "Final Cut Pro", extension: "fcpxml", write: toFcpxml },
  premiere: { label: "Premiere Pro", extension: "xml", write: toXmeml },
  edl: { label: "EDL", extension: "edl", write: toEdl },
} as const;

export type TimelineFormat = keyof typeof TIMELINE_FORMATS;
