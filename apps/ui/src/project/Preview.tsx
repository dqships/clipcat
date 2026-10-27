import { type Project, type Timeline, buildTimeline } from "@clipcat/core";
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
  const live = useRef({ timeline, order, sourceId, onTime });
  live.current = { timeline, order, sourceId, onTime };

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
      const { timeline: tl, order: ord, sourceId: sid, onTime: report } = live.current;
      if (!sid) return;
      const t = v.currentTime;
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

  const source = sources.find((s) => s.id === sourceId);
  if (!source?.prep) return <div className="project__video project__video--pending" />;
  return (
    <video
      ref={video}
      className="project__video"
      src={mediaUrl(project.id, source.prep.proxy)}
      controls
      preload="auto"
      onLoadedMetadata={(e) => {
        const next = pending.current;
        pending.current = null;
        if (!next) return;
        e.currentTarget.currentTime = next.time;
        if (next.play) void e.currentTarget.play().catch(() => {});
      }}
    />
  );
}
