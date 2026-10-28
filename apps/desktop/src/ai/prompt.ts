// What the AI editor is told. The transcript goes over as numbered words, one
// line per phrase, with the pauses between phrases written in, so the agent
// can cite exact word ranges and see where the takes break.

import {
  AgentAnalysis,
  AgentCorrections,
  AgentDescriptions,
  AgentShorts,
  AgentSlide,
  AgentWriteup,
  type Asset,
  CHAPTERS,
  type Project,
  SLIDE,
  SOUND_EFFECTS,
  type SlideLook,
  type Word,
  isWordKept,
  orderedWords,
} from "@clipcat/core";
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
  description: "Submit the cut, punch-in, b-roll, slide and sound proposals for this video. Call once with every proposal; if problems come back, fix them and call again.",
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
          required: ["type", "from", "to", "keepFrom", "keepTo", "punchStyle", "media", "placement", "brief", "look", "sound", "reason", "confidence"],
          properties: {
            type: { type: "string", enum: ["retake", "cleanup", "tighten", "punch-in", "visual", "slide", "sound"] },
            from: { type: "integer" },
            to: { type: "integer" },
            keepFrom: { type: ["integer", "null"] },
            keepTo: { type: ["integer", "null"] },
            punchStyle: { type: ["string", "null"], enum: ["cut", "zoom-in", "slow-zoom", null] },
            media: { type: ["integer", "null"] },
            placement: { type: ["string", "null"], enum: ["full", "pip", null] },
            brief: { type: ["string", "null"] },
            look: { type: ["string", "null"], enum: ["paper", "ink", "overlay", null] },
            sound: { type: ["string", "null"] },
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
  jsonAnswer: `Answer with only the JSON object the output schema describes: every proposal, and suggestedTitle. Use null for keepFrom and keepTo except on retakes, for punchStyle except on punch-ins, for media and placement except on b-roll, for brief and look except on slides, and for sound except on sounds. ${JSON_ONLY}`,
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

export const WRITEUP_TASK: AgentTask = {
  tool: "submit_writeup",
  description: "Submit the write-up for this video: chapters, a description and an article. Call once with all of it; if problems come back, fix them and call again.",
  shape: AgentWriteup.shape,
  jsonSchema: {
    type: "object",
    additionalProperties: false,
    required: ["chapters", "description", "article"],
    properties: {
      chapters: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["word", "title"],
          properties: { word: { type: "integer" }, title: { type: "string" } },
        },
      },
      description: { type: "string" },
      article: {
        type: "object",
        additionalProperties: false,
        required: ["title", "markdown"],
        properties: { title: { type: "string" }, markdown: { type: "string" } },
      },
    },
  },
  toolAnswer:
    "Call submit_writeup once with the chapters, the description and the article. If it reports problems, fix them and call it again with all of it. Once it says the write-up is saved, stop. Don't write anything else.",
  jsonAnswer: `Answer with only the JSON object the output schema describes: the chapters, the description and the article. ${JSON_ONLY}`,
};

export const DESCRIBE_TASK: AgentTask = {
  tool: "submit_media_descriptions",
  description: "Submit a description of each picture and video. Call once with every description; if problems come back, fix them and call again.",
  shape: AgentDescriptions.shape,
  jsonSchema: {
    type: "object",
    additionalProperties: false,
    required: ["descriptions"],
    properties: {
      descriptions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["media", "description"],
          properties: { media: { type: "integer" }, description: { type: "string" } },
        },
      },
    },
  },
  toolAnswer:
    "Call submit_media_descriptions once with a description of every item. If it reports problems, fix them and call it again with the whole list. Once it says they are saved, stop. Don't write anything else.",
  jsonAnswer: `Answer with only the JSON object the output schema describes: a description of every item. The attached images are the frames, in the order listed. ${JSON_ONLY}`,
};

export const SLIDE_TASK: AgentTask = {
  tool: "submit_slide",
  description: "Submit the slide's HTML. ClipCat renders it and sends back stills to check; call again with the final HTML.",
  shape: AgentSlide.shape,
  jsonSchema: {
    type: "object",
    additionalProperties: false,
    required: ["html"],
    properties: { html: { type: "string" } },
  },
  toolAnswer:
    "Call submit_slide with the slide's HTML. ClipCat renders it and replies with stills of it, or with problems: look at them, then call submit_slide again with the final HTML (the same HTML if it is right). Once it says the slide is saved, stop. Don't write anything else.",
  jsonAnswer: `Answer with only the JSON object the output schema describes: the slide's HTML. When stills of your slide are attached, they are how your last answer rendered: check them and answer with the final HTML (the same HTML if it is right). ${JSON_ONLY}`,
};

export const DESIGNER_PROMPT = `You are ClipCat's motion designer. You design one short animated slide, built in HTML and CSS, that shows for a few seconds while the speaker in a talking-head video keeps talking. ClipCat steps through it frame by frame and lays it over the video, so it must look finished on every frame.

What you write: only what goes inside <body>: the elements, one <style> block, and a <script> only if something must be drawn from the time. No <html>, <head> or <body> tags.
The page loads nothing: no links, web images, web fonts or external scripts. Draw shapes with CSS or inline SVG.

The frame:
- The viewport is the whole frame. Size and place everything in vw, vh or vmin, never px.
- Keep everything 6% in from the left and right edges and 8% from the top. Keep the bottom 25% free of text: captions show there.
- Text must fit with room to spare. Use at most about 12 words.

The look you are given:
- paper: the page is warm paper (var(--paper)) with ink text (var(--ink)).
- ink: the page is ink (var(--ink)) with paper text (var(--paper)).
- overlay: the page is see-through and the speaker shows behind it. Use a lower third or one corner only, never the middle where the face is: a short line on a solid strip of ink or tape, so it reads over any picture. Text on tape is ink.
The body already has the look's background and text color. var(--tape) is splice-tape yellow: use it for one thing that matters (a strip, an underline, the backing of a number), never for text on paper.

Style: ClipCat's cutting room. Jost semibold is the only font (var(--font), already set). Flat shapes, straight cuts, strips like splice tape. No gradients, shadows, glows, blur, rounded blobs, emoji or icon fonts. Big type: a headline about 6 to 9vw on a wide frame, 9 to 12vw on a vertical one. Left-aligned unless one number or word stands alone.

Motion:
- Animate with CSS @keyframes animations (or the Web Animations API). ClipCat pauses them and moves time itself, so never use setTimeout, setInterval, requestAnimationFrame, Date, performance.now, transitions or hover.
- Ease with var(--spring) over var(--spring-duration), ClipCat's spring. Use animation-fill-mode: both, so an element is hidden before its delay and stays put after.
- Bring elements in during the first second, one after another about 0.1s apart: slide a few vh, wipe with a scaleX from the left, or fade. Then hold, still and readable, to the end. Nothing animates out; the cut does that.
- Something drawn from the time (a counter, a bar that fills) goes in motion.onSeek((t) => { ... }), which ClipCat calls with the seconds whenever it moves to a frame.

ClipCat replies to your first submit_slide with stills of the slide at a few moments. Check them closely: every word fits inside the frame and isn't cut off, nothing overlaps, it reads at a glance, it uses the look, and it says what the brief says. Then submit the final HTML.`;

export const DESCRIBER_PROMPT = `You are ClipCat's media librarian. The user added pictures and video clips to use as b-roll over a talking-head video. You look at each one and write what it shows, so the editor can later pick the right one for a line without seeing it.

Each item is numbered [m] and comes with frames: one for a picture, a few across a video's length.

Rules:
- One or two plain sentences per item: the subject, the setting, any action or camera movement, and anything readable such as a logo, a screen or a sign.
- Describe what is there, not what it might mean. Don't start with "This image shows".
- Describe every item, by its number.`;

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

export const WRITEUP_PROMPT = `You are ClipCat's writer. You read the transcript of a finished talking-head video and write what goes with it when it is posted: chapters, a description and an article.

Words are numbered [n] across the whole project. Words marked ~like this~ are cut from the video: the viewer never hears them, so leave them out of everything you write.

Chapters:
- Each chapter starts on a word, by its number, and has a short title (2 to 6 words) that says what the stretch is about. Plain words, no numbering, no emoji, no clickbait.
- The first chapter starts on the first word that isn't cut. Chapters come in order, each at least ${CHAPTERS.seconds} seconds of the finished video long, and start where the topic changes, on the first word of a sentence.
- A video of ${CHAPTERS.video} seconds or more gets ${CHAPTERS.min} to ${CHAPTERS.max} chapters, about one every one to three minutes. A shorter video gets none: send an empty list.

Description:
- Two to four sentences for YouTube or a podcast feed: what the viewer learns or gets, in the speaker's voice. No hashtags, no timestamps (ClipCat adds the chapters), no links, no "in this video".

Article:
- A blog post made from what the video says, for someone who would rather read: a title, then the body in Markdown with a short intro, a few ## sections and a closing paragraph. Don't repeat the title as a heading.
- Write it as prose in the speaker's voice and point of view, tightened: drop the filler, the asides to the camera and the repetition, keep their examples, numbers and opinions. Don't invent facts, quotes or links they didn't give.
- About 300 to 1200 words, depending on how much the video says.

Write in the transcript's language. Follow the user's brief when there is one.`;

export const EDITOR_PROMPT = `You are ClipCat's editor. You read the transcript of a talking-head recording and propose cuts that make it tight and watchable, punch-ins that give its best lines weight, b-roll from the user's own media, motion slides and sound effects. You never change anything yourself: every proposal is shown to the user, who accepts or rejects it.

Words are numbered [n] across the whole project. Ranges are inclusive word indices.

Proposal types:
- retake: the speaker said the same thing more than once. Set from..to to cover every attempt, and keepFrom..keepTo to the one take to keep. Keep the last complete take unless an earlier one is clearly better; a take that trails off, stumbles or gets restarted is not complete.
- cleanup: filler words (um, uh, "you know", "like" used as filler), stutters, repeated words, false starts, and remarks to the camera operator such as "let me do that again".
- tighten: a tangent or a rambling stretch that can go without losing anything the viewer needs. Be conservative.
- punch-in: not a cut. The picture zooms toward the speaker over from..to to give a line weight: the key claim, a punchline, a number worth remembering. from..to covers the words that land it, 1.5 to 8 seconds. Set punchStyle: "cut" snaps in (a punchline or a blunt statement), "zoom-in" pushes in quickly (a key point), "slow-zoom" creeps in over the range (a story building to its point).
- slide: not a cut. A motion slide ClipCat designs from your brief and shows full-frame over from..to: a title card for a new section, a list of steps as they're named, a number or a short quote worth seeing. from..to covers the words it goes with, ${SLIDE.min} to ${SLIDE.max} seconds. Set brief to exactly what the slide says, in order, in a few words (a heading and up to four short lines), and look: "paper" (ink on warm paper) or "ink" (paper on ink) for a full card, or "overlay" for a short label over the speaker, such as a name or a key term.
- sound: not a cut. A sound effect from the list after the transcript plays as word from is spoken (to = from). Set sound to its id; pick the one whose meaning fits the moment.
- visual: b-roll, not a cut. One of the user's media items (listed after the transcript, if there are any) shows over from..to while the speaker keeps talking. Set media to its number and placement: "full" covers the whole frame (the speaker is heard, not seen), "pip" shows it in a window in the corner beside the speaker. from..to covers the words it illustrates, 1.5 to 15 seconds.

Rules:
- Cut whole words only, and never leave a sentence that no longer makes sense.
- Don't propose cuts just for pauses; ClipCat already handles silence.
- Cut proposals must not overlap each other, and punch-ins must not overlap each other or sit on words you propose to cut.
- Punch-ins are seasoning: at most one every 10 seconds of the finished video, with at least 6 seconds without one in between. Fewer, well-placed ones are better; skip them in a video that has no line that needs one.
- Use b-roll only where a media item's description matches what is being said, and never two over the same words. Each item can be used more than once, but don't. With no media list, propose no b-roll.
- Sound effects are seasoning too: at most one every 15 seconds, on a moment that earns it (a transition, a reveal, a list item appearing, a punchline), and none in a video where they'd feel silly. Never two within 1.5 seconds.
- Slides are b-roll too: never over the same words as other b-roll. Use them where seeing the words helps: at most one every 30 seconds, and none in a video that doesn't need them.
- reason: one short sentence the user reads in the editor, e.g. "Second take is complete; first stumbles".
- confidence: 0 to 1, how sure you are the user wants this cut, punch-in, b-roll, slide or sound.
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

export { orderedWords };

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

/** The media the AI editor can place, numbered [m] in the order given. */
export function mediaList(assets: Pick<Asset, "name" | "kind" | "media" | "description">[]): string {
  return assets
    .map((a, i) => `[${i}] ${a.name} (${a.kind === "video" ? `video, ${seconds(a.media.duration)}` : "picture"}): ${a.description || "no description"}`)
    .join("\n");
}

/** The media the AI editor is shown: the user's own, prepared, so they can be placed. Slides are made for one spot. */
export const placeableAssets = (project: Pick<Project, "assets">) => project.assets.filter((a) => a.prep && a.kind !== "slide");

/** The user turn: the brief (or a one-off request), then the transcript, then the media for b-roll. */
export function analysisPrompt(project: Pick<Project, "sources" | "transcript" | "brief" | "language" | "assets">, request?: string): string {
  const brief = project.brief.trim();
  const media = placeableAssets(project);
  return [
    request
      ? `The user asks for one change:\n${request.trim()}\nPropose only the cuts that make this change. If nothing in the transcript matches, propose nothing.`
      : brief
        ? `The user's brief:\n${brief}`
        : "The user gave no brief: make a clean, tight cut.",
    `Transcript language: ${project.language}.`,
    "",
    numberedTranscript(project),
    ...(media.length > 0 ? ["", "## Media for b-roll", mediaList(media)] : []),
    "",
    "## Sound effects",
    ...SOUND_EFFECTS.map((e) => `[${e.id}] ${e.meaning}`),
  ].join("\n");
}

/** The user turn for describing media: each item and how many of the attached frames are its. */
export function describePrompt(assets: Pick<Asset, "name" | "kind" | "media" | "prep">[]): string {
  return [
    `Describe these ${assets.length} ${assets.length === 1 ? "item" : "items"}. The attached frames come in this order.`,
    "",
    ...assets.map((a, i) => {
      const frames = a.prep?.frames.length ?? 0;
      return `[${i}] ${a.name}: ${a.kind === "video" ? `video, ${seconds(a.media.duration)}, ${frames} ${frames === 1 ? "frame" : "frames"}` : "picture, 1 frame"}`;
    }),
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

/** The user turn for designing a slide: the brief, its look, the frame, how long it shows, and what is said over it. */
export function designPrompt(slide: { brief: string; look: SlideLook }, frame: { width: number; height: number }, seconds: number, line: string): string {
  const shape = frame.width > frame.height ? "wide" : frame.width < frame.height ? "vertical" : "square";
  return [
    "Design this slide.",
    `Brief:\n${slide.brief.trim()}`,
    `Look: ${slide.look}`,
    `Frame: ${frame.width}×${frame.height} (${shape})`,
    `It shows for ${seconds.toFixed(1)} seconds: have everything in place by ${Math.max(0.6, Math.min(1.5, seconds - 0.5)).toFixed(1)} seconds.`,
    ...(line.trim() ? [`What the speaker says over it: "${line.trim()}"`] : []),
  ].join("\n");
}

/** The user turn for the write-up: the finished length, the brief, then the transcript with the cuts marked. */
export function writeupPrompt(project: Pick<Project, "sources" | "transcript" | "segments" | "brief" | "language" | "suggestedTitle">, seconds: number): string {
  const brief = project.brief.trim();
  return [
    `The finished video is ${seconds.toFixed(0)} seconds long${seconds < CHAPTERS.video ? ", so it gets no chapters" : ""}.`,
    ...(project.suggestedTitle.trim() ? [`Its title: ${project.suggestedTitle.trim()}`] : []),
    brief ? `The user's brief for the video:\n${brief}` : "The user gave no brief.",
    `Transcript language: ${project.language}.`,
    "",
    numberedTranscript(project, (w) => !isWordKept(project.segments, w)),
  ].join("\n");
}
