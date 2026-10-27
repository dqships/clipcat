// What the AI editor is told. The transcript goes over as numbered words, one
// line per phrase, with the pauses between phrases written in, so the agent
// can cite exact word ranges and see where the takes break.

import type { Project, Word } from "@clipcat/core";

/** A gap between words at least this long starts a new line. */
const LINE_GAP = 0.6;
/** A gap at least this long is written out as a pause. */
const PAUSE_GAP = 1;

export const SUBMIT_TOOL = "submit_analysis";

export const SYSTEM_PROMPT = `You are ClipCat's editor. You read the transcript of a talking-head recording and propose cuts that make it tight and watchable. You never change anything yourself: every proposal is shown to the user, who accepts or rejects it.

Words are numbered [n] across the whole project. Ranges are inclusive word indices.

Proposal types:
- retake: the speaker said the same thing more than once. Set from..to to cover every attempt, and keepFrom..keepTo to the one take to keep. Keep the last complete take unless an earlier one is clearly better; a take that trails off, stumbles or gets restarted is not complete.
- cleanup: filler words (um, uh, "you know", "like" used as filler), stutters, repeated words, false starts, and remarks to the camera operator such as "let me do that again".
- tighten: a tangent or a rambling stretch that can go without losing anything the viewer needs. Be conservative.

Rules:
- Cut whole words only, and never leave a sentence that no longer makes sense.
- Don't propose cuts just for pauses; ClipCat already handles silence.
- Proposals must not overlap.
- reason: one short sentence the user reads in the editor, e.g. "Second take is complete; first stumbles".
- confidence: 0 to 1, how sure you are the user wants this cut.
- suggestedTitle: a short, plain title for the finished video.
- Follow the user's brief when there is one.

Call ${SUBMIT_TOOL} once with every proposal. If it reports problems, fix them and call it again with the whole analysis. Once it says the analysis is saved, stop. Don't write anything else.`;

const seconds = (t: number) => `${t.toFixed(1)}s`;

/** Every word, recording by recording in project order: the numbering the agent cites. */
export function orderedWords(project: Pick<Project, "sources" | "transcript">): Word[] {
  return [...project.sources]
    .sort((a, b) => a.order - b.order)
    .flatMap((s) => project.transcript.filter((w) => w.sourceId === s.id).sort((a, b) => a.start - b.start));
}

/** The numbered transcript, one recording after another, numbered as `orderedWords`. */
export function numberedTranscript(project: Pick<Project, "sources" | "transcript">): string {
  const sources = [...project.sources].sort((a, b) => a.order - b.order);
  const all = orderedWords(project);
  const lines: string[] = [];
  let index = 0;
  for (const [n, source] of sources.entries()) {
    const words = all.filter((w) => w.sourceId === source.id);
    lines.push(`## Recording ${n + 1} of ${sources.length}: ${source.name} (${seconds(source.media.duration)})`);
    if (words.length === 0) {
      lines.push("(no speech)");
      continue;
    }
    let line: string[] = [];
    words.forEach((w, i) => {
      const previous = words[i - 1];
      const gap = previous ? w.start - previous.end : 0;
      if (previous && gap >= LINE_GAP) {
        lines.push(line.join(" "));
        if (gap >= PAUSE_GAP) lines.push(`(pause ${seconds(gap)})`);
        line = [];
      }
      if (line.length === 0) line.push(`@${seconds(w.start)}`);
      line.push(`[${index++}]${w.text}`);
    });
    lines.push(line.join(" "));
  }
  return lines.join("\n");
}

/** The user turn: the brief, then the transcript. */
export function analysisPrompt(project: Pick<Project, "sources" | "transcript" | "brief" | "language">): string {
  const brief = project.brief.trim();
  return [
    brief ? `The user's brief:\n${brief}` : "The user gave no brief: make a clean, tight cut.",
    `Transcript language: ${project.language}.`,
    "",
    numberedTranscript(project),
  ].join("\n");
}
