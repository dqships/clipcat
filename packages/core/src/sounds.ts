// Sound effects and music. An effect is a short sound from ClipCat's library
// (a whoosh, a pop, a ding), landing on a moment in a recording: it sits in
// source time on an accepted "sound" proposal, like a punch-in, so it follows
// its word through edits and is timed on the output for the export and the
// preview. Music plays under the whole video, faded in and out, and can dip
// while someone speaks.

import type { Proposal, SoundCue } from "./project";
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

/** A sound proposal landing at `cue.at` of `sourceId`. */
export function soundProposal(fields: Pick<Proposal, "id" | "sourceId" | "wordIds" | "reason" | "confidence" | "status">, cue: SoundCue): Proposal {
  return { ...fields, type: "sound", cuts: [], keepWordIds: [], punch: null, overlay: null, sound: cue };
}
