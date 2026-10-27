// What the AI editor is told. The transcript goes over as numbered words, one
// line per phrase, with the pauses between phrases written in, so the agent
// can cite exact word ranges and see where the takes break.

import { AgentAnalysis, AgentCorrections, AgentShorts, type Project, type Word, isWordKept } from "@clipcat/core";
import type { z } from "zod";

/** A gap between words at least this long starts a new line. */
const LINE_GAP = 0.6;
/** A gap at least this long is written out as a pause. */
const PAUSE_GAP = 1;

/**
 * One kind of job an agent does: the tool a tool-calling agent (Claude Code)
 * answers through, the strict JSON Schema an agent held to an output schema
 * (Codex) answers in, and how each is told to answer.
 */
export type AgentTask = {
  tool: string;
  description: string;
  /** The tool's input, as a zod object shape. */
  shape: z.ZodRawShape;
  /** The same answer in OpenAI's strict form: every property required, nothing extra, null for absent. */
  jsonSchema: Record<string, unknown>;
  /** The last paragraph of the system prompt for each kind of agent. */
  toolAnswer: string;
  jsonAnswer: string;
};

const JSON_ONLY = "Don't run commands or read files; everything you need is below.";

export const ANALYSIS_TASK: AgentTask = {
  tool: "submit_analysis",
  description: "Submit the cut proposals for this video. Call once with every proposal; if problems come back, fix them and call again.",
  shape: AgentAnalysis.shape,
  jsonSchema: {
    type: "object",
    additionalProperties: false,
    required: ["proposals", "suggestedTitle"],
    properties: {
      proposals: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["type", "from", "to", "keepFrom", "keepTo", "reason", "confidence"],
          properties: {
            type: { type: "string", enum: ["retake", "cleanup", "tighten"] },
            from: { type: "integer" },
            to: { type: "integer" },
            keepFrom: { type: ["integer", "null"] },
            keepTo: { type: ["integer", "null"] },
            reason: { type: "string" },
            confidence: { type: "number" },
          },
        },
      },
      suggestedTitle: { type: "string" },
    },
  },
  toolAnswer:
    "Call submit_analysis once with every proposal. If it reports problems, fix them and call it again with the whole analysis. Once it says the analysis is saved, stop. Don't write anything else.",
  jsonAnswer: `Answer with only the JSON object the output schema describes: every proposal, and suggestedTitle. Use null for keepFrom and keepTo except on retakes. ${JSON_ONLY}`,
};

export const CORRECTIONS_TASK: AgentTask = {
  tool: "submit_corrections",
  description: "Submit the transcript corrections. Call once with every correction; if problems come back, fix them and call again.",
  shape: AgentCorrections.shape,
  jsonSchema: {
    type: "object",
    additionalProperties: false,
    required: ["corrections"],
    properties: {
      corrections: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["index", "text"],
          properties: { index: { type: "integer" }, text: { type: "string" } },
        },
      },
    },
  },
  toolAnswer:
    "Call submit_corrections once with every correction (an empty list if there is nothing to fix). If it reports problems, fix them and call it again with the whole list. Once it says they are saved, stop. Don't write anything else.",
  jsonAnswer: `Answer with only the JSON object the output schema describes: every correction, or an empty list if there is nothing to fix. ${JSON_ONLY}`,
};

export const SHORTS_TASK: AgentTask = {
  tool: "submit_shorts",
  description: "Submit the shorts cut from this video. Call once with every short; if problems come back, fix them and call again.",
  shape: AgentShorts.shape,
  jsonSchema: {
    type: "object",
    additionalProperties: false,
    required: ["shorts"],
    properties: {
      shorts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "reason", "ranges"],
          properties: {
            title: { type: "string" },
            reason: { type: "string" },
            ranges: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["from", "to"],
                properties: { from: { type: "integer" }, to: { type: "integer" } },
              },
            },
          },
        },
      },
    },
  },
  toolAnswer:
    "Call submit_shorts once with every short. If it reports problems, fix them and call it again with the whole list. Once it says the shorts are saved, stop. Don't write anything else.",
  jsonAnswer: `Answer with only the JSON object the output schema describes: every short. ${JSON_ONLY}`,
};

export const SHORTS_PROMPT = `You are ClipCat's shorts editor. You read the transcript of a long talking-head video and pick the stretches that work on their own as vertical shorts for TikTok, Reels and YouTube Shorts. Each short you pick becomes its own project the user can edit further.

Words are numbered [n] across the whole project. Ranges are inclusive word indices. Words marked ~like this~ are already cut from the long video and stay cut in a short.

What makes a good short:
- It opens with a hook: a bold claim, a question, a surprising number or a strong opinion, in the first sentence. Never open on "so", "and" or a reference to something said earlier.
- It makes one point and pays it off before it ends. It ends on a complete sentence.
- Someone who hasn't seen the long video understands it.

Rules:
- A short is one range, or up to four ranges played in order when skipping a stretch in the middle makes it tighter. Ranges start and end on sentence boundaries, stay inside one recording each, and come in transcript order.
- Respect the length you are given, counting only words that aren't already cut.
- Different shorts should make different points. Pick the strongest first.
- title: a short, plain title for the short, the way you'd post it.
- reason: one sentence the user reads: the hook and why it stands alone.
- Follow the user's brief when there is one.`;

export const EDITOR_PROMPT = `You are ClipCat's editor. You read the transcript of a talking-head recording and propose cuts that make it tight and watchable. You never change anything yourself: every proposal is shown to the user, who accepts or rejects it.

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
- Follow the user's brief when there is one.`;

export const CORRECTOR_PROMPT = `You are ClipCat's transcript checker. Speech recognition wrote the transcript below, and it sometimes mishears names, product names, jargon and words that sound alike. You fix those, and nothing else: every correction is applied to the word's text only, so its timing stays.

Words are numbered [n] across the whole project.

Rules:
- Correct a word only when you are confident it was misheard: from the context, or because the user's list of names and terms gives the right spelling.
- One word per correction: give the word's index and its corrected text, with any punctuation the word had.
- Never rephrase, fix grammar, change a speaker's word choice or remove filler words.
- Keep the transcript's capitalization style, except for names.`;

const seconds = (t: number) => `${t.toFixed(1)}s`;

/** Every word, recording by recording in project order: the numbering the agent cites. */
export function orderedWords(project: Pick<Project, "sources" | "transcript">): Word[] {
  return [...project.sources]
    .sort((a, b) => a.order - b.order)
    .flatMap((s) => project.transcript.filter((w) => w.sourceId === s.id).sort((a, b) => a.start - b.start));
}

/**
 * The numbered transcript, one recording after another, numbered as
 * `orderedWords`. With `cut`, words the edit removes are marked ~so~.
 */
export function numberedTranscript(project: Pick<Project, "sources" | "transcript">, cut?: (w: Word) => boolean): string {
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
      line.push(cut?.(w) ? `[${index++}]~${w.text}~` : `[${index++}]${w.text}`);
    });
    lines.push(line.join(" "));
  }
  return lines.join("\n");
}

/** The user turn: the brief (or a one-off request), then the transcript. */
export function analysisPrompt(project: Pick<Project, "sources" | "transcript" | "brief" | "language">, request?: string): string {
  const brief = project.brief.trim();
  return [
    request
      ? `The user asks for one change:\n${request.trim()}\nPropose only the cuts that make this change. If nothing in the transcript matches, propose nothing.`
      : brief
        ? `The user's brief:\n${brief}`
        : "The user gave no brief: make a clean, tight cut.",
    `Transcript language: ${project.language}.`,
    "",
    numberedTranscript(project),
  ].join("\n");
}

/** The user turn for corrections: the names and terms to know, then the transcript. */
export function correctionsPrompt(project: Pick<Project, "sources" | "transcript" | "language">, dictionary: string[]): string {
  const terms = dictionary.map((t) => t.trim()).filter(Boolean);
  return [
    terms.length > 0 ? `Names and terms that appear in the user's videos, spelled correctly:\n${terms.join(", ")}` : "The user listed no names or terms.",
    `Transcript language: ${project.language}.`,
    "",
    numberedTranscript(project),
  ].join("\n");
}

/** The user turn for shorts: how many and how long, the brief, then the transcript with the cuts marked. */
export function shortsPrompt(
  project: Pick<Project, "sources" | "transcript" | "segments" | "brief" | "language">,
  limits: { count: number; seconds: number },
): string {
  const brief = project.brief.trim();
  return [
    `Pick up to ${limits.count} ${limits.count === 1 ? "short" : "shorts"}, each ${Math.min(15, limits.seconds / 2)} to ${limits.seconds} seconds long. Fewer is fine when the video doesn't have that many strong moments.`,
    brief ? `The user's brief for the video:\n${brief}` : "The user gave no brief.",
    `Transcript language: ${project.language}.`,
    "",
    numberedTranscript(project, (w) => !isWordKept(project.segments, w)),
  ].join("\n");
}
