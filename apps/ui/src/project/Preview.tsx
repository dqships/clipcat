import {
  MUSIC,
  type Project,
  type Source,
  type TimedOverlay,
  type TimedPunch,
  type Timeline,
  buildTimeline,
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
  timedSounds,
} from "@clipcat/core";
import { type CSSProperties, type Ref, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { mediaUrl } from "../format";
import { previewFrame } from "./CaptionOverlay";
import { SlideFrame, seekSlide } from "./SlideFrame";
import { EFFECTS, effectUrl, playQuietly } from "./SoundPanel";

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

/** Where b-roll sits over the preview: the export's box, as shares of the stage's width (the stage is the frame's shape). */
export function brollStyle(o: TimedOverlay, frame: { width: number; height: number }): CSSProperties {
  const box = overlayBox(o, frame);
  const at = (n: number) => `calc(${n} / ${frame.width} * 100cqw)`;
  return { left: at(box.x), top: at(box.y), width: at(box.width), height: at(box.height), borderRadius: at(box.radius) };
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
  const overlays = useMemo(() => timedOverlays(project, timeline), [project, timeline]);
  const broll = useRef<HTMLVideoElement>(null);
  const slide = useRef<HTMLIFrameElement>(null);
  /** Where the slide showing should be, for a page that has only just loaded. */
  const slideTime = useRef(0);
  const [shown, setShown] = useState<TimedOverlay | null>(null);
  const showing = useRef<TimedOverlay | null>(null);
  const sounds = useMemo(() => timedSounds(project, timeline), [project, timeline]);
  const music = project.music;
  const musicEl = useRef<HTMLAudioElement>(null);
  const effects = useRef(new Map<string, HTMLAudioElement>());
  /** Output time at the last check while playing; effects between it and now play. */
  const heard = useRef<number | null>(null);
  const transcript = project.transcript;
  const live = useRef({ timeline, order, sourceId, onTime, sources, tall, punches, overlays, sounds, music, transcript });
  live.current = { timeline, order, sourceId, onTime, sources, tall, punches, overlays, sounds, music, transcript };

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
      const { timeline: tl, order: ord, sourceId: sid, onTime: report, sources: all, tall: narrow, punches: zooms, overlays: rolls, sounds: cues, music: bed, transcript: said } = live.current;
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
      // The music runs on the output clock, looping, faded at both ends, and dips while someone speaks.
      const m = musicEl.current;
      if (m && bed) {
        if (v.paused) {
          if (!m.paused) m.pause();
        } else if (out !== null) {
          const want = out % bed.duration;
          if (Math.abs(m.currentTime - want) > DRIFT) m.currentTime = want;
          const fade = Math.max(0, Math.min(1, out / MUSIC.fadeIn, (tl.duration - out) / MUSIC.fadeOut));
          const speaking = bed.duck && said.some((w) => w.sourceId === sid && t >= w.start && t < w.end);
          m.volume = Math.min(1, bed.volume * fade * (speaking ? DUCKED : 1));
          if (m.paused) playQuietly(m);
        }
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
    v.addEventListener("pause", check);
    return () => {
      if (handle && "cancelVideoFrameCallback" in v) v.cancelVideoFrameCallback(handle);
      v.removeEventListener("timeupdate", check);
      v.removeEventListener("seeked", check);
      v.removeEventListener("pause", check);
    };
  }, [sourceId]);

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
  const shownPrep = shown?.asset.prep;
  return (
    <>
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
      {music?.prep && <audio ref={musicEl} key={music.prep} src={mediaUrl(project.id, music.prep)} preload="auto" />}
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
