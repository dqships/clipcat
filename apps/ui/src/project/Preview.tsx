import {
  type Project,
  type Source,
  type TimedPunch,
  type Timeline,
  buildTimeline,
  cropOffset,
  framingAt,
  punchFocus,
  punchZoom,
  sourceToOutput,
  timedPunches,
} from "@clipcat/core";
import { type Ref, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { mediaUrl } from "../format";

/** A moment in one recording. */
export type Playhead = { sourceId: string; time: number };

export type PreviewHandle = { seek: (sourceId: string, time: number) => void };

type Props = {
  project: Project;
  onTime: (playhead: Playhead) => void;
  ref?: Ref<PreviewHandle>;
};

/** Seconds of slack before a cut counts as reached, so a jump never lands a frame short of it and loops. */
const EDGE = 0.01;
/** How far playback moves before the playhead is reported again: often enough to follow words, rare enough not to re-render every frame. */
const REPORT_STEP = 0.1;

/**
 * Where the 9:16 crop sits (0 = left edge, 1 = right) at `time` in `source`:
 * the same place the export puts it for the kept range there, or for the
 * moment itself inside a cut.
 */
export function previewOffset(timeline: Timeline, source: Source, time: number): number {
  const item = timeline.items.find((i) => i.sourceId === source.id && time >= i.sourceStart - EDGE && time < i.sourceEnd);
  const { width, height } = source.media;
  const aspect = width > 0 && height > 0 ? width / height : 16 / 9;
  return cropOffset(framingAt(source, item?.sourceStart ?? time, item?.sourceEnd ?? time), aspect, 9 / 16);
}

const aspectOf = (s: Source) => (s.media.width > 0 && s.media.height > 0 ? s.media.width / s.media.height : 16 / 9);

/**
 * The part of the recording a punch-in shows, as a CSS object-view-box: the
 * export's crop for the kept range `item`, zoomed by `zoom` toward where the
 * punch-in aims. Its shape is the frame's, so object-fit has nothing left to crop.
 */
export function punchViewBox(source: Source, item: [number, number], punch: Pick<TimedPunch, "range">, zoom: number, tall: boolean): string {
  const aspect = aspectOf(source);
  const out = tall ? 9 / 16 : 16 / 9;
  const width = Math.min(1, out / aspect);
  const left = width < 1 ? cropOffset(framingAt(source, item[0], item[1]), aspect, out) * (1 - width) : 0;
  const focus = punchFocus(source, item, punch.range, aspect, out);
  const w = width / zoom;
  const h = 1 / zoom;
  const x = left + (width - w) * focus.x;
  const y = (1 - h) * focus.y;
  const pct = (n: number) => `${(Math.max(0, n) * 100).toFixed(3)}%`;
  return `inset(${pct(y)} ${pct(1 - x - w)} ${pct(1 - y - h)} ${pct(x)})`;
}

/** The kept stretch to play after `time` in `sourceId`, in timeline order, or null at the end. */
export function nextKept(timeline: Timeline, sourceId: string, time: number, order: Map<string, number>) {
  const here = order.get(sourceId) ?? 0;
  return (
    timeline.items.find((item) => {
      const o = order.get(item.sourceId) ?? 0;
      return o > here || (item.sourceId === sourceId && item.sourceEnd > time + EDGE);
    }) ?? null
  );
}

/**
 * Plays the edit: the proxies of the recordings in order, jumping over every
 * cut. A paused seek may land inside a cut, so struck words can still be
 * looked at; playback leaves it at the next kept frame.
 */
export function Preview({ project, onTime, ref }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const sources = useMemo(() => [...project.sources].filter((s) => s.prep).sort((a, b) => a.order - b.order), [project.sources]);
  const order = useMemo(() => new Map(sources.map((s) => [s.id, s.order])), [sources]);
  const timeline = useMemo(() => buildTimeline(project), [project]);
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? null);
  /** Where to go once a newly loaded proxy can seek, and whether to keep playing. */
  const pending = useRef<{ time: number; play: boolean } | null>(null);
  const tall = project.aspectRatio === "9:16";
  const [offset, setOffset] = useState(0.5);
  const punches = useMemo(() => timedPunches(project, timeline), [project, timeline]);
  const live = useRef({ timeline, order, sourceId, onTime, sources, tall, punches });
  live.current = { timeline, order, sourceId, onTime, sources, tall, punches };

  useEffect(() => {
    if (!sourceId && sources[0]) setSourceId(sources[0].id);
  }, [sourceId, sources]);

  const go = (target: string, time: number, play: boolean) => {
    const v = video.current;
    if (target !== live.current.sourceId || !v) {
      pending.current = { time, play };
      setSourceId(target);
      return;
    }
    v.currentTime = time;
    if (play) void v.play().catch(() => {});
  };

  useImperativeHandle(ref, () => ({ seek: (target, time) => go(target, time, false) }));

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    let handle = 0;
    let reported = Number.NaN;
    const check = () => {
      const { timeline: tl, order: ord, sourceId: sid, onTime: report, sources: all, tall: narrow, punches: zooms } = live.current;
      if (!sid) return;
      const t = v.currentTime;
      const here = all.find((s) => s.id === sid);
      if (here && narrow) setOffset(previewOffset(tl, here, t));
      // A punch-in zooms the picture, the way the export will.
      const out = sourceToOutput(tl, sid, t);
      const punch = out === null ? undefined : zooms.find((p) => out >= p.start && out < p.end);
      const item = tl.items.find((i) => i.sourceId === sid && t >= i.sourceStart && t < i.sourceEnd);
      const box = here && punch && item && out !== null ? punchViewBox(here, [item.sourceStart, item.sourceEnd], punch, punchZoom(punch, out), narrow) : "";
      if (v.style.getPropertyValue("object-view-box") !== box) v.style.setProperty("object-view-box", box);
      if (v.paused || !(Math.abs(t - reported) < REPORT_STEP)) {
        reported = t;
        report({ sourceId: sid, time: t });
      }
      if (v.paused) return;
      const inside = tl.items.some((i) => i.sourceId === sid && t >= i.sourceStart - EDGE && t < i.sourceEnd - EDGE);
      if (inside) return;
      const next = nextKept(tl, sid, t, ord);
      if (!next) {
        v.pause();
        return;
      }
      go(next.sourceId, next.sourceStart, true);
    };
    const frame = () => {
      check();
      handle = v.requestVideoFrameCallback(frame);
    };
    // Frame callbacks catch a cut within a frame; timeupdate (4 times a second) covers seeks and pauses.
    if ("requestVideoFrameCallback" in v) handle = v.requestVideoFrameCallback(frame);
    v.addEventListener("timeupdate", check);
    v.addEventListener("seeked", check);
    return () => {
      if (handle && "cancelVideoFrameCallback" in v) v.cancelVideoFrameCallback(handle);
      v.removeEventListener("timeupdate", check);
      v.removeEventListener("seeked", check);
    };
  }, [sourceId]);

  // A new shape or framing moves the crop at once, even while paused.
  useEffect(() => {
    const v = video.current;
    const here = sources.find((s) => s.id === sourceId);
    if (tall && v && here) setOffset(previewOffset(timeline, here, v.currentTime));
  }, [tall, timeline, sources, sourceId]);

  // The preview plays at the export's speed; loading another recording resets the rate, so it is set again then.
  const speed = project.speed;
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.defaultPlaybackRate = speed;
    v.playbackRate = speed;
  }, [speed, sourceId]);

  const source = sources.find((s) => s.id === sourceId);
  const shape = tall ? " project__video--tall" : "";
  if (!source?.prep) return <div className={`project__video project__video--pending${shape}`} />;
  return (
    <video
      ref={video}
      className={`project__video${shape}`}
      // The vertical export's crop, shown by covering a 9:16 box and sliding the picture.
      style={tall ? { objectPosition: `${offset * 100}% 50%` } : undefined}
      src={mediaUrl(project.id, source.prep.proxy)}
      controls
      preload="auto"
      onLoadedMetadata={(e) => {
        e.currentTarget.playbackRate = speed;
        const next = pending.current;
        pending.current = null;
        if (!next) return;
        e.currentTarget.currentTime = next.time;
        if (next.play) void e.currentTarget.play().catch(() => {});
      }}
    />
  );
}
