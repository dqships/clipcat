// The write-up: what goes with the video when it is posted. Chapters (a
// title on the word each one starts with, so they follow their words through
// edits), a description for YouTube or a podcast feed, and an article written
// from what the video says. The AI editor drafts it from the edited
// transcript; the user can change any of it.

import { z } from "zod";
import { isWordKept, orderedWords } from "./edits";
import type { Chapter, Project, Word, Writeup } from "./project";
import { type Timeline, sourceToOutput } from "./timeline";

export const CHAPTERS = {
  /** YouTube shows chapters only when there are at least three, each at least ten seconds long. */
  min: 3,
  max: 30,
  seconds: 10,
  /** A video shorter than this gets no chapters. */
  video: 60,
} as const;

/** The agent's write-up: chapters by the number of the word each starts on. */
export const AgentWriteup = z.object({
  chapters: z.array(z.object({ word: z.number().int(), title: z.string().min(1).max(100) })).max(CHAPTERS.max),
  description: z.string().max(5000),
  article: z.object({ title: z.string().min(1).max(200), markdown: z.string().min(1).max(100_000) }),
});
export type AgentWriteup = z.infer<typeof AgentWriteup>;

/** A chapter at its place on the output timeline. */
export type TimedChapter = Chapter & { start: number };

/** Where each word plays in the output, or null for a cut one. */
function outputStart(timeline: Timeline, w: Word): number | null {
  return sourceToOutput(timeline, w.sourceId, w.start);
}

/**
 * The chapters on the output timeline, in order. One whose word was cut since
 * starts at the next word that is still in; the first always starts at 0:00,
 * as YouTube requires, and two that land together keep the first.
 */
export function timedChapters(project: Pick<Project, "writeup" | "segments" | "sources" | "transcript">, timeline: Timeline): TimedChapter[] {
  const words = orderedWords(project);
  const chapters = project.writeup?.chapters ?? [];
  const index = new Map(words.map((w, i) => [w.id, i]));
  const out: TimedChapter[] = [];
  for (const c of chapters) {
    const from = index.get(c.wordId);
    if (from === undefined) continue;
    let start: number | null = null;
    for (let i = from; i < words.length && start === null; i++) {
      if (isWordKept(project.segments, words[i]!)) start = outputStart(timeline, words[i]!);
    }
    if (start !== null) out.push({ ...c, start });
  }
  out.sort((a, b) => a.start - b.start);
  const kept = out.filter((c, i) => i === 0 || c.start > out[i - 1]!.start + 0.5);
  if (kept[0]) kept[0].start = 0;
  return kept;
}

/** "1:05" or "1:02:05", the way YouTube reads a timestamp. */
export function chapterTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** The chapters as YouTube reads them in a description, one "0:00 Title" per line. */
export function chapterList(chapters: TimedChapter[]): string {
  return chapters.map((c) => `${chapterTime(c.start)} ${c.title}`).join("\n");
}

/** The description to paste: the text, then the chapters when there are enough for YouTube to show. */
export function postText(description: string, chapters: TimedChapter[]): string {
  const list = chapters.length >= CHAPTERS.min ? chapterList(chapters) : "";
  return [description.trim(), list].filter(Boolean).join("\n\n");
}

/**
 * Checks the agent's write-up against the words it was shown (`words`, in
 * the numbering of the prompt) and the edit: each chapter starts on a word
 * that is still in, they come in order, at least CHAPTERS.seconds apart,
 * and there are none, or at least three, depending on the video's length.
 */
export function validateWriteup(
  answer: AgentWriteup,
  words: Word[],
  project: Pick<Project, "segments">,
  timeline: Timeline,
): { writeup: Writeup; errors: string[] } {
  const errors: string[] = [];
  const chapters: Chapter[] = [];
  let last = Number.NEGATIVE_INFINITY;
  answer.chapters.forEach((c, i) => {
    const where = `chapter ${i} ("${c.title}")`;
    const word = words[c.word];
    if (!word) return void errors.push(`${where}: word must be a number from 0 to ${words.length - 1}`);
    const start = isWordKept(project.segments, word) ? outputStart(timeline, word) : null;
    if (start === null) return void errors.push(`${where}: word ${c.word} is cut from the video; start on a word that is still in`);
    const at = chapters.length === 0 ? 0 : start;
    if (at < last + CHAPTERS.seconds) return void errors.push(`${where}: starts ${Math.max(0, at - last).toFixed(1)} s after the chapter before; chapters must be in order and at least ${CHAPTERS.seconds} s long`);
    last = at;
    chapters.push({ wordId: word.id, title: c.title.trim() });
  });
  if (timeline.duration < CHAPTERS.video && chapters.length > 0) {
    errors.push(`the video is under ${CHAPTERS.video} s long: give no chapters`);
    chapters.length = 0;
  } else if (timeline.duration >= CHAPTERS.video && chapters.length < CHAPTERS.min && errors.length === 0) {
    errors.push(`give at least ${CHAPTERS.min} chapters, the first on the first word that is still in`);
  }
  return {
    writeup: { chapters, description: answer.description.trim(), article: { title: answer.article.title.trim(), markdown: answer.article.markdown.trim() } },
    errors,
  };
}
