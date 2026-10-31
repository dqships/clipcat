// Sound effects and music. An effect is a short sound from ClipCat's library
// (a whoosh, a pop, a ding), landing on a moment in a recording: it sits in
// source time on an accepted "sound" proposal, like a punch-in, so it follows
// its word through edits and is timed on the output for the export and the
// preview. A project can have several music tracks: one can play under the
// whole video, and the others play over the words they're placed on, taking
// over while they do. Placements sit on accepted "music" proposals, so they
// follow their words through edits. Every stretch fades in and out and can
// dip while someone speaks.

import type { MusicCue, MusicTrack, Project, Proposal, SoundCue } from "./project";
import { outputSpan } from "./punchins";
import { type Timeline, sourceToOutput } from "./timeline";

export const SOUND = {
  /** Source seconds that must separate two effects in one recording. */
  gap: 1.5,
} as const;

/**
 * ClipCat's sound effects, made by scripts/make-sfx.mjs (synthesized, so
 * they are ClipCat's own) and shipped with the app. Each says what it means,
 * which is how the AI editor picks one, and where in the file the sound
 * lands, so the export and the preview can put that moment on the word.
 */
export type SoundEffect = {
  id: string;
  name: string;
  /** When to use it, written for the AI editor and shown to the user. */
  meaning: string;
  /** Seconds into the file where the sound lands: a whoosh's peak, a riser's end. */
  hit: number;
};

export const SOUND_EFFECTS: readonly SoundEffect[] = [
  { id: "whoosh", name: "Whoosh", meaning: "A smooth sweep of air. A transition: moving on to a new topic, section or scene.", hit: 0.4 },
  { id: "swish", name: "Swish", meaning: "A quick, light swipe. Something slides in: a title, a list item, a picture.", hit: 0.08 },
  { id: "pop", name: "Pop", meaning: "A soft pop. Something small appears or a point is made: a word on screen, a quick aside.", hit: 0 },
  { id: "click", name: "Click", meaning: "A crisp click. Pressing a button, choosing something, moving through a screen.", hit: 0 },
  { id: "tick", name: "Tick", meaning: "A small wooden tick. Counting through a list, one per item.", hit: 0 },
  { id: "ding", name: "Ding", meaning: "A clear bell. An idea lands: the insight, the right answer, the lightbulb moment.", hit: 0 },
  { id: "chime", name: "Chime", meaning: "Two rising notes. Success: a goal reached, a win, a happy result.", hit: 0.13 },
  { id: "riser", name: "Riser", meaning: "Tension building up to a moment. Lands on the reveal or big statement it leads into.", hit: 1.6 },
  { id: "boom", name: "Boom", meaning: "A deep hit. Weight on a bold claim, a dramatic reveal, a punchline that lands hard.", hit: 0 },
  { id: "blip", name: "Blip", meaning: "A friendly two-note alert. A tip, a notification, 'here's the thing'.", hit: 0.1 },
  { id: "buzz", name: "Buzz", meaning: "A wrong-answer buzzer. A mistake, a myth busted, 'don't do this'.", hit: 0 },
  { id: "shutter", name: "Shutter", meaning: "A camera shutter. A photo, a screenshot, freezing a moment.", hit: 0 },
  { id: "scratch", name: "Record scratch", meaning: "A record scratch. A sudden stop, a twist, 'wait, what?'.", hit: 0.05 },
];

export const soundIds = SOUND_EFFECTS.map((e) => e.id);

export const MUSIC = {
  /** Seconds the music takes to come in and to fade out at the end. */
  fadeIn: 1,
  fadeOut: 3,
  /** Seconds a stretch takes to fade out when more of the video follows it. */
  handover: 1,
  /** Source seconds a placement should cover at least, for the AI editor. */
  min: 5,
} as const;

/** An accepted effect, at its place on the output timeline. */
export type TimedSound = SoundCue & { id: string; sourceId: string; time: number };

/** The effects that play, in order; one whose moment is cut doesn't. */
export function timedSounds(project: { proposals: Proposal[] }, timeline: Timeline): TimedSound[] {
  const out: TimedSound[] = [];
  for (const p of project.proposals) {
    if (p.status !== "accepted" || !p.sound) continue;
    const time = sourceToOutput(timeline, p.sourceId, p.sound.at);
    if (time !== null) out.push({ ...p.sound, id: p.id, sourceId: p.sourceId, time });
  }
  return out.sort((a, b) => a.time - b.time);
}

/** One stretch of music on the output timeline: which track, when, where in the file it starts, and how it fades. */
export type TimedMusic = { id: string; track: MusicTrack; start: number; end: number; offset: number; fadeIn: number; fadeOut: number };

/**
 * The music that plays, in order and never two at once: the placed tracks,
 * each ending as the next starts, and the whole-video track in the gaps. A
 * placed track starts from its beginning; the whole-video track keeps to the
 * output clock, so it picks up where it would have been. All of them loop.
 */
export function timedMusic(project: Pick<Project, "music" | "proposals">, timeline: Pick<Timeline, "items" | "speed" | "duration">): TimedMusic[] {
  const tracks = new Map(project.music.map((t) => [t.id, t]));
  const placed: { id: string; track: MusicTrack; start: number; end: number }[] = [];
  for (const p of project.proposals) {
    if (p.status !== "accepted" || !p.music) continue;
    const track = tracks.get(p.music.trackId);
    const span = track && outputSpan(timeline, p.sourceId, p.music.range);
    if (!track || !span || span[1] - span[0] <= 0) continue;
    placed.push({ id: p.id, track, start: span[0], end: span[1] });
  }
  placed.sort((a, b) => a.start - b.start);
  for (let i = 0; i < placed.length - 1; i++) placed[i]!.end = Math.min(placed[i]!.end, placed[i + 1]!.start);
  const stretches = placed.filter((s) => s.end > s.start).map((s) => ({ ...s, offset: 0 }));

  const whole = project.music.find((t) => t.whole);
  const gaps: typeof stretches = [];
  if (whole) {
    let at = 0;
    for (const s of [...stretches, null]) {
      const end = s ? s.start : timeline.duration;
      if (end - at > 0.01) gaps.push({ id: `${whole.id}@${at}`, track: whole, start: at, end, offset: at % whole.duration });
      if (s) at = s.end;
    }
  }
  return [...stretches, ...gaps]
    .sort((a, b) => a.start - b.start)
    .map((s) => {
      const length = s.end - s.start;
      const out = s.end >= timeline.duration - 0.01 ? MUSIC.fadeOut : MUSIC.handover;
      return { ...s, fadeIn: Math.min(MUSIC.fadeIn, length / 2), fadeOut: Math.min(out, length / 2) };
    });
}

/** The stretch of music playing at output time `t`, if any. */
export function musicAt(music: TimedMusic[], t: number): TimedMusic | null {
  return music.find((m) => t >= m.start && t < m.end) ?? null;
}

/** Where in its file a stretch is at output time `t`. */
export const musicTime = (m: Pick<TimedMusic, "track" | "start" | "offset">, t: number): number => (m.offset + t - m.start) % m.track.duration;

/** How far faded in a stretch is at output time `t`, 0 to 1. */
export function musicFade(m: Pick<TimedMusic, "start" | "end" | "fadeIn" | "fadeOut">, t: number): number {
  return Math.max(0, Math.min(1, (t - m.start) / (m.fadeIn || 1), (m.end - t) / (m.fadeOut || 1)));
}

/** A music placement over `cue.range` of `sourceId`. */
export function musicProposal(fields: Pick<Proposal, "id" | "sourceId" | "wordIds" | "reason" | "confidence" | "status">, cue: MusicCue): Proposal {
  return { ...fields, type: "music", cuts: [], keepWordIds: [], punch: null, overlay: null, sound: null, music: cue };
}

/** A sound proposal landing at `cue.at` of `sourceId`. */
export function soundProposal(fields: Pick<Proposal, "id" | "sourceId" | "wordIds" | "reason" | "confidence" | "status">, cue: SoundCue): Proposal {
  return { ...fields, type: "sound", cuts: [], keepWordIds: [], punch: null, overlay: null, sound: cue, music: null };
}
