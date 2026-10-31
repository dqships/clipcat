import {
  type Project,
  type Source,
  type TimedOverlay,
  type TimedPunch,
  type Timeline,
  buildTimeline,
  musicAt,
  musicFade,
  musicTime,
  timedMusic,
  cropOffset,
  framingAt,
  overlayAt,
  overlayBox,
  overlayTime,
  punchFocus,
  punchZoom,
  slideSize,
  sourceToOutput,
  timedOverlays,
  timedPunches,
  outputToSource,
  timedSounds,
} from "@clipcat/core";
import { type CSSProperties, type Ref, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { mediaUrl } from "../format";
import { previewFrame } from "./CaptionOverlay";
import { SlideFrame, seekSlide } from "./SlideFrame";
import { EFFECTS, effectUrl, playQuietly } from "./SoundPanel";

/** A moment in one recording. */
export type Playhead = { sourceId: string; time: number };

export type PreviewHandle = {
  seek: (sourceId: string, time: number) => void;
  /** Plays at the export's speed, or pauses. */
  toggle: () => void;
  pause: () => void;
  /** J and L: plays that way, faster on each press in the same direction. */
  shuttle: (direction: 1 | -1) => void;
  /** Pauses and moves `frames` frames of the edit (negative goes back). */
  step: (frames: number) => void;
};

/** How playback is going: `rate` is a multiple of the export's speed, negative backwards, 0 when paused. */
export type Transport = { rate: number };

type Props = {
  project: Project;
  onTime: (playhead: Playhead) => void;
  onTransport?: (transport: Transport) => void;
  ref?: Ref<PreviewHandle>;
};

/** Shuttle speeds J and L step through, as multiples of the export's speed. */
export const SHUTTLE = [1, 2, 4, 8];

/** The next shuttle rate after a J (-1) or L (1) press at `rate`. */
export function nextShuttle(rate: number, direction: 1 | -1): number {
  if (Math.sign(rate) !== direction) return direction;
  const i = SHUTTLE.indexOf(Math.abs(rate));
  return direction * (SHUTTLE[Math.min(SHUTTLE.length - 1, i + 1)] ?? 1);
}

/** Where `time` in `sourceId` sits in the edit; a moment inside a cut counts as the next kept frame. */
export function outputAt(timeline: Timeline, sourceId: string, time: number, order: Map<string, number>): number {
  return sourceToOutput(timeline, sourceId, time) ?? nextKept(timeline, sourceId, time, order)?.outputStart ?? timeline.duration;
}

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

/** Where b-roll sits over the preview: the export's box, as shares of the stage's width (the stage is the frame's shape). */
export function brollStyle(o: TimedOverlay, frame: { width: number; height: number }): CSSProperties {
  const box = overlayBox(o, frame);
  const at = (n: number) => `calc(${n} / ${frame.width} * 100cqw)`;
  return { left: at(box.x), top: at(box.y), width: at(box.width), height: at(box.height), borderRadius: at(box.radius) };
}

/** The blurred fill is drawn this small and stretched, which blurs it; CSS softens it further. */
const FILL = { width: 32, height: 18 };

/** Draws the frame covering the fill canvas. */
function drawFill(g: CanvasRenderingContext2D, v: HTMLVideoElement): void {
  const scale = Math.max(FILL.width / v.videoWidth, FILL.height / v.videoHeight);
  const w = v.videoWidth * scale;
  const h = v.videoHeight * scale;
  g.drawImage(v, (FILL.width - w) / 2, (FILL.height - h) / 2, w, h);
}

/** Seconds b-roll video or music may drift from where it should be while playing before it is set right. */
const DRIFT = 0.3;
/** How far the music dips under speech in the preview: a stand-in for the export's compressor. */
const DUCKED = 0.35;
/** A playhead move longer than this is a jump, which plays no effects on the way. */
const JUMP = 0.5;

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
 * cut, with punch-ins zooming, b-roll showing over it and its sound effects
 * and music playing as the export will.
 * A paused seek may land inside a cut, so struck words can still be looked
 * at; playback leaves it at the next kept frame.
 */
export function Preview({ project, onTime, onTransport, ref }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const sources = useMemo(() => [...project.sources].filter((s) => s.prep).sort((a, b) => a.order - b.order), [project.sources]);
  const order = useMemo(() => new Map(sources.map((s) => [s.id, s.order])), [sources]);
  const timeline = useMemo(() => buildTimeline(project), [project]);
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? null);
  /** Where to go once a newly loaded proxy can seek, and whether to keep playing. */
  const pending = useRef<{ time: number; play: boolean } | null>(null);
  const tall = project.aspectRatio === "9:16";
  const blur = !tall && project.bars === "blur";
  const [offset, setOffset] = useState(0.5);
  const punches = useMemo(() => timedPunches(project, timeline), [project, timeline]);
  const overlays = useMemo(() => timedOverlays(project, timeline), [project, timeline]);
  const broll = useRef<HTMLVideoElement>(null);
  const fill = useRef<HTMLCanvasElement>(null);
  const slide = useRef<HTMLIFrameElement>(null);
  /** Where the slide showing should be, for a page that has only just loaded. */
  const slideTime = useRef(0);
  const [shown, setShown] = useState<TimedOverlay | null>(null);
  const showing = useRef<TimedOverlay | null>(null);
  const sounds = useMemo(() => timedSounds(project, timeline), [project, timeline]);
  const music = useMemo(() => timedMusic(project, timeline), [project, timeline]);
  const musicEls = useRef(new Map<string, HTMLAudioElement>());
  const effects = useRef(new Map<string, HTMLAudioElement>());
  /** Output time at the last check while playing; effects between it and now play. */
  const heard = useRef<number | null>(null);
  const transcript = project.transcript;
  const speed = project.speed;
  const live = useRef({ timeline, order, sourceId, onTime, sources, tall, punches, overlays, sounds, music, transcript, speed });
  live.current = { timeline, order, sourceId, onTime, sources, tall, punches, overlays, sounds, music, transcript, speed };

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

  /** The shuttle rate playing forward, or backwards while `reverse` runs; 1 is the export's speed. */
  const rate = useRef(1);
  const reverse = useRef<number | null>(null);
  const [transport, setTransport] = useState<Transport>({ rate: 0 });
  const report = (next: number) => setTransport((t) => (t.rate === next ? t : { rate: next }));

  const stopReverse = () => {
    if (reverse.current !== null) cancelAnimationFrame(reverse.current);
    reverse.current = null;
  };

  const setForward = (r: number) => {
    rate.current = r;
    const v = video.current;
    if (v) v.playbackRate = speed * r;
  };

  const pause = () => {
    stopReverse();
    setForward(1);
    video.current?.pause();
    report(0);
  };

  // Video can't play backwards, so J seeks back through the edit a step at a time, over the cuts, as fast as the proxy keeps up.
  const playBackwards = (r: number) => {
    const v = video.current;
    if (!v) return;
    stopReverse();
    v.pause();
    setForward(1);
    rate.current = r;
    let last = performance.now();
    const tick = (now: number) => {
      const el = video.current;
      const { timeline: tl, order: ord, sourceId: sid } = live.current;
      if (!el || !sid) return;
      if (el.seeking || pending.current) {
        reverse.current = requestAnimationFrame(tick);
        return;
      }
      const at = outputAt(tl, sid, el.currentTime, ord) - ((now - last) / 1000) * Math.abs(rate.current);
      last = now;
      const dest = outputToSource(tl, Math.max(0, at));
      if (!dest) return pause();
      go(dest.sourceId, dest.time, false);
      if (at <= 0) return pause();
      reverse.current = requestAnimationFrame(tick);
    };
    reverse.current = requestAnimationFrame(tick);
    report(r);
  };

  const playForward = (r: number) => {
    const v = video.current;
    if (!v) return;
    stopReverse();
    setForward(r);
    // From the end of the edit, play starts again from the top.
    const { timeline: tl, sourceId: sid, order: ord } = live.current;
    if (sid && tl.items.length > 0 && !nextKept(tl, sid, v.currentTime, ord)) {
      const first = tl.items[0]!;
      go(first.sourceId, first.sourceStart, true);
    } else void v.play().catch(() => {});
    report(r);
  };

  const step = (frames: number) => {
    const v = video.current;
    const { timeline: tl, sourceId: sid, sources: all } = live.current;
    if (!v || !sid) return;
    pause();
    const fps = all.find((s) => s.id === sid)?.media.fps || 30;
    const out = sourceToOutput(tl, sid, v.currentTime);
    // Inside a cut there is no edit to step through, so it steps through the recording.
    if (out === null) {
      v.currentTime = Math.max(0, v.currentTime + (frames / fps) * tl.speed);
      return;
    }
    const dest = outputToSource(tl, Math.min(Math.max(0, out + frames / fps), Math.max(0, tl.duration - 1 / fps)));
    if (dest) go(dest.sourceId, dest.time, false);
  };

  useImperativeHandle(ref, () => ({
    seek: (target, time) => go(target, time, false),
    toggle: () => (transport.rate === 0 ? playForward(1) : pause()),
    pause,
    shuttle: (direction) => {
      const next = nextShuttle(transport.rate, direction);
      if (next > 0) playForward(next);
      else playBackwards(next);
    },
    step,
  }));

  useEffect(() => onTransport?.(transport), [transport, onTransport]);
  useEffect(() => stopReverse, []);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    let handle = 0;
    let reported = Number.NaN;
    const check = () => {
      const { timeline: tl, order: ord, sourceId: sid, onTime: report, sources: all, tall: narrow, punches: zooms, overlays: rolls, sounds: cues, music: bed, transcript: said } = live.current;
      if (!sid) return;
      const t = v.currentTime;
      const here = all.find((s) => s.id === sid);
      if (here && narrow) setOffset(previewOffset(tl, here, t));
      // A recording of another shape shows over itself blurred, the way the export fills its sides.
      const g = fill.current?.getContext("2d");
      if (g && v.videoWidth > 0) drawFill(g, v);
      // A punch-in zooms the picture, the way the export will.
      const out = sourceToOutput(tl, sid, t);
      const punch = out === null ? undefined : zooms.find((p) => out >= p.start && out < p.end);
      const item = tl.items.find((i) => i.sourceId === sid && t >= i.sourceStart && t < i.sourceEnd);
      const box = here && punch && item && out !== null ? punchViewBox(here, [item.sourceStart, item.sourceEnd], punch, punchZoom(punch, out), narrow) : "";
      if (v.style.getPropertyValue("object-view-box") !== box) v.style.setProperty("object-view-box", box);
      // B-roll shows over it, a video kept in step with the edit.
      const roll = out === null ? null : overlayAt(rolls, out);
      if (roll?.id !== showing.current?.id || roll?.asset.id !== showing.current?.asset.id) {
        showing.current = roll;
        setShown(roll);
      }
      if (roll && out !== null && roll.asset.kind === "slide") {
        const want = overlayTime(roll, out);
        if (want !== slideTime.current) {
          slideTime.current = want;
          seekSlide(slide.current, want);
        }
      }
      const b = broll.current;
      if (roll && out !== null && b && roll.asset.kind === "video") {
        const want = overlayTime(roll, out);
        if (v.paused) {
          if (!b.paused) b.pause();
          if (Math.abs(b.currentTime - want) > 0.04) b.currentTime = want;
        } else {
          if (Math.abs(b.currentTime - want) > DRIFT) b.currentTime = want;
          if (b.paused) void b.play().catch(() => {});
        }
      }
      // Each effect starts as the playhead crosses its start, so its hit lands on the word.
      const before = heard.current;
      heard.current = v.paused ? null : out;
      if (out !== null && before !== null && out > before && out - before < JUMP) {
        for (const cue of cues) {
          const start = cue.time - (EFFECTS.get(cue.effect)?.hit ?? 0);
          if (start <= before || start > out) continue;
          let el = effects.current.get(cue.effect);
          if (!el) {
            el = new Audio(effectUrl(cue.effect));
            effects.current.set(cue.effect, el);
          }
          el.volume = cue.volume;
          el.currentTime = out - start;
          playQuietly(el);
        }
      }
      // One stretch of music plays at a time, looping, faded at both ends, and dips while someone speaks.
      const playing = v.paused || out === null ? null : musicAt(bed, out);
      for (const [id, m] of musicEls.current) {
        if (playing?.track.id !== id) {
          if (!m.paused) m.pause();
          continue;
        }
        const want = musicTime(playing, out!);
        if (Math.abs(m.currentTime - want) > DRIFT) m.currentTime = want;
        const speaking = playing.track.duck && said.some((w) => w.sourceId === sid && t >= w.start && t < w.end);
        m.volume = Math.min(1, playing.track.volume * musicFade(playing, out!) * (speaking ? DUCKED : 1));
        if (m.paused) playQuietly(m);
      }
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
        rate.current = 1;
        v.playbackRate = live.current.speed;
        setTransport({ rate: 0 });
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
    v.addEventListener("loadeddata", check);
    v.addEventListener("pause", check);
    return () => {
      if (handle && "cancelVideoFrameCallback" in v) v.cancelVideoFrameCallback(handle);
      v.removeEventListener("timeupdate", check);
      v.removeEventListener("seeked", check);
      v.removeEventListener("loadeddata", check);
      v.removeEventListener("pause", check);
    };
  }, [sourceId]);

  // Turning the blurred fill on draws it at once, even while paused.
  useEffect(() => {
    const v = video.current;
    const g = fill.current?.getContext("2d");
    if (blur && v && g && v.videoWidth > 0) drawFill(g, v);
  }, [blur, sourceId]);

  // A new shape or framing moves the crop at once, even while paused.
  useEffect(() => {
    const v = video.current;
    const here = sources.find((s) => s.id === sourceId);
    if (tall && v && here) setOffset(previewOffset(timeline, here, v.currentTime));
  }, [tall, timeline, sources, sourceId]);

  // Accepting, moving or removing b-roll shows at once, even while paused.
  useEffect(() => {
    const v = video.current;
    if (!v || !sourceId) return;
    const out = sourceToOutput(timeline, sourceId, v.currentTime);
    const roll = out === null ? null : overlayAt(overlays, out);
    showing.current = roll;
    setShown(roll);
    if (roll && out !== null) slideTime.current = overlayTime(roll, out);
  }, [overlays, timeline, sourceId]);

  // The preview plays at the export's speed times the shuttle rate; loading another recording resets the rate, so it is set again then.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.defaultPlaybackRate = speed;
    v.playbackRate = speed * (reverse.current === null ? rate.current : 1);
  }, [speed, sourceId]);

  const source = sources.find((s) => s.id === sourceId);
  const shape = tall ? " project__video--tall" : "";
  if (!source?.prep) return <div className={`project__video project__video--pending${shape}`} />;
  const shownPrep = shown?.asset.prep;
  return (
    <>
      {blur && <canvas ref={fill} className="project__fill" width={FILL.width} height={FILL.height} aria-hidden />}
      <video
        ref={video}
        className={`project__video${shape}${blur ? " project__video--over-fill" : ""}`}
        // The vertical export's crop, shown by covering a 9:16 box and sliding the picture.
        style={tall ? { objectPosition: `${offset * 100}% 50%` } : undefined}
        src={mediaUrl(project.id, source.prep.proxy)}
        preload="auto"
        playsInline
        onClick={() => (transport.rate === 0 ? playForward(1) : pause())}
        onLoadedMetadata={(e) => {
          e.currentTarget.playbackRate = speed * (reverse.current === null ? rate.current : 1);
          const next = pending.current;
          pending.current = null;
          if (!next) return;
          e.currentTarget.currentTime = next.time;
          if (next.play) void e.currentTarget.play().catch(() => {});
        }}
      />
      {project.music.map(
        (t) =>
          t.prep && (
            <audio
              key={t.id}
              ref={(el) => {
                if (el) musicEls.current.set(t.id, el);
                else musicEls.current.delete(t.id);
              }}
              src={mediaUrl(project.id, t.prep)}
              preload="auto"
            />
          ),
      )}
      {shown && shownPrep && (
        <div className="broll" style={brollStyle(shown, previewFrame(project))} aria-hidden>
          {shown.asset.kind === "slide" ? (
            <SlideFrame
              ref={slide}
              key={shown.asset.id}
              projectId={project.id}
              asset={shown.asset}
              frame={shown.asset.media.width > 0 ? shown.asset.media : slideSize(project.aspectRatio)}
              onLoad={(frame) => seekSlide(frame, slideTime.current)}
            />
          ) : shown.asset.kind === "video" ? (
            <video ref={broll} key={shown.id} className="broll__media" src={mediaUrl(project.id, shownPrep.preview)} muted playsInline preload="auto" />
          ) : (
            <img className="broll__media" src={mediaUrl(project.id, shownPrep.preview)} alt="" />
          )}
        </div>
      )}
    </>
  );
}
