// The AI jobs: cut proposals for the whole video, cuts for one request ("cut
// the part about pricing"), transcript corrections, shorts (each saved as its
// own vertical project), descriptions of the user's b-roll media, and motion
// slides' designs. The agent reads the numbered transcript (or looks at the
// media's frames) and answers through its task's submit tool (or JSON).
// Every answer is checked against the real words: a first answer with
// problems goes back once with the list, after which whatever checked out is
// saved. Cuts arrive as pending proposals for the user to decide. A slide's
// design is rendered and the stills go back to the agent to check before it
// is saved.

import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  AI_TYPES,
  AgentAnalysis,
  AgentCorrections,
  AgentDescriptions,
  AgentShorts,
  AgentWriteup,
  AgentSlide,
  type Asset,
  type Project,
  type Proposal,
  type ShortPlan,
  applyCorrections,
  sameSpot,
  replacePending,
  shortProject,
  type SlideLook,
  slideSize,
  soundIds,
  spaceProposedPunches,
  unusedSlides,
  validateCorrections,
  validateDescriptions,
  validateProposals,
  validateShorts,
  validateWriteup,
  buildTimeline,
  type Writeup,
} from "@clipcat/core";
import type { JobContext, JobQueue } from "../jobs/queue";
import type { ProjectStore } from "../store/projects";
import {
  ANALYSIS_TASK,
  type AgentTask,
  CORRECTIONS_TASK,
  CORRECTOR_PROMPT,
  DESCRIBER_PROMPT,
  DESCRIBE_TASK,
  DESIGNER_PROMPT,
  EDITOR_PROMPT,
  SLIDE_TASK,
  SHORTS_PROMPT,
  SHORTS_TASK,
  WRITEUP_PROMPT,
  WRITEUP_TASK,
  analysisPrompt,
  correctionsPrompt,
  describePrompt,
  designPrompt,
  orderedWords,
  placeableAssets,
  shortsPrompt,
  writeupPrompt,
} from "./prompt";
import { slideProblems } from "../slides/page";

/** What a submit tells the agent, whether that ends the run, and pictures to show with it (JPEG paths). */
export type SubmitReply = { text: string; done: boolean; images?: string[] };

export type AgentRun = {
  task: AgentTask;
  /** The system prompt, without the task's answer instructions (each agent adds its own). */
  system: string;
  prompt: string;
  /** JPEGs to show the agent with the prompt (absolute paths), for tasks that look at pictures. */
  images?: string[];
  /** Called with the agent's raw answer. */
  submit: (input: unknown) => Promise<SubmitReply>;
  /** A short line for the progress UI ("Claude is reading the transcript"). */
  activity: (label: string) => void;
  signal: AbortSignal;
};

/** An AI provider that can run one task: Claude Code, Codex, and the API later. */
export type Agent = { label: string; run: (run: AgentRun) => Promise<void> };

export type AnalysisDeps = {
  store: ProjectStore;
  queue: JobQueue;
  /** The agent to use, or an error saying why there is none (not installed, signed out). */
  agent: () => Promise<Agent>;
  /** The user's names and terms, for corrections. */
  dictionary: () => Promise<string[]>;
  changed: (project: Project) => void;
  /** Renders slides for checking their design; without it, slides aren't designed. */
  slides?: SlideStudio;
  /** Deletes the files of a slide nothing shows any more. */
  forget?: (projectId: string, assetId: string) => void;
};

/** Renders a draft slide's stills at `times` (seconds) into `files`; resolves with how long its animations run and the errors its page reported. */
export type SlideStudio = {
  stills: (
    draft: { html: string; look: SlideLook },
    frame: { width: number; height: number },
    times: number[],
    files: string[],
  ) => Promise<{ duration: number; errors: string[] }>;
};

/** How many answers the agent gets: the first, and one retry with the problems listed. */
const ATTEMPTS = 2;

const shortId = () => randomUUID().slice(0, 8);

/** Media described per run: three frames each keeps a run well inside what an agent takes in at once. */
const DESCRIBE_BATCH = 20;

/** Answers a slide design gets: the first, the one after seeing its stills, and one more if that one had problems. */
const DESIGN_ATTEMPTS = 3;

/**
 * What checking one answer found: the result to save, or problems to send
 * back, with pictures of it. `review` asks the agent to look at the pictures
 * and answer again before anything is saved.
 */
type Checked<T> = {
  result: T;
  problems: string[];
  summary: string;
  saved: string;
  images?: string[];
  /** Sent back instead of saving a first answer with no problems, so the agent checks its work. */
  review?: string;
  /** What to resend when there are problems: the whole list (the default) or the whole answer. */
  whole?: "list" | "answer";
};

export class AnalysisRunner {
  constructor(private readonly deps: AnalysisDeps) {}

  /** Saves the brief and queues an analysis after whatever the project is already doing. */
  async analyze(projectId: string, brief: string): Promise<void> {
    const project = await this.deps.store.update(projectId, null, (p) => {
      p.brief = brief;
    });
    this.deps.changed(project);
    this.deps.queue.add(projectId, "analyze", "Suggesting an edit", (ctx) => this.run(projectId, ctx)).catch(() => {});
  }

  /** Queues cuts for one request, added to the proposals already waiting. */
  request(projectId: string, request: string): void {
    this.deps.queue.add(projectId, "analyze", "Following your request", (ctx) => this.run(projectId, ctx, request)).catch(() => {});
  }

  /** Queues a pass that fixes misheard names and terms in the transcript. */
  correct(projectId: string): void {
    this.deps.queue.add(projectId, "correct", "Checking the transcript", (ctx) => this.runCorrections(projectId, ctx)).catch(() => {});
  }

  /** Queues a pass that describes the media nobody has described yet, for placing b-roll. */
  describe(projectId: string): void {
    this.deps.queue.add(projectId, "describe", "Looking at your media", (ctx) => this.runDescribe(projectId, ctx)).catch(() => {});
  }

  /** Queues a pass that picks up to `count` shorts of about `seconds` each and makes a project of each. */
  shorts(projectId: string, count: number, seconds: number): void {
    this.deps.queue.add(projectId, "shorts", "Finding shorts", (ctx) => this.runShorts(projectId, ctx, { count, seconds })).catch(() => {});
  }

  /** Queues a pass that writes the chapters, the description and the article. */
  writeup(projectId: string): void {
    this.deps.queue.add(projectId, "writeup", "Writing chapters and an article", (ctx) => this.runWriteup(projectId, ctx)).catch(() => {});
  }

  /**
   * Queues designing a slide, unless it is already queued. Asked again while
   * its job runs (the brief changed), it looks once more when the job ends.
   */
  design(projectId: string, asset: Pick<Asset, "id" | "name">): void {
    const key = `${projectId}/${asset.id}`;
    if (!this.deps.slides) return;
    if (this.designing.has(key)) {
      this.redesign.add(key);
      return;
    }
    this.designing.add(key);
    this.deps.queue
      .add(projectId, "design", `Designing “${asset.name}”`, (ctx) => this.runDesign(projectId, asset.id, ctx))
      .catch(() => {})
      .finally(() => {
        this.designing.delete(key);
        if (this.redesign.delete(key)) this.designMissing(projectId).catch(() => {});
      });
  }

  /** Queues designing every slide in the project that has no design yet. */
  async designMissing(projectId: string): Promise<void> {
    const project = await this.deps.store.get(projectId);
    for (const a of project.assets) if (a.slide && !a.slide.html) this.design(projectId, a);
  }

  private readonly designing = new Set<string>();
  private readonly redesign = new Set<string>();

  /**
   * Runs `task` with the user's agent: each answer is checked, the first one
   * with problems goes back with them (or, when the check asks for it, with
   * pictures to review), and the last checked result is returned.
   */
  private async ask<T>(
    ctx: JobContext,
    run: { task: AgentTask; system: string; prompt: string; images?: string[] },
    check: (input: unknown) => Checked<T> | { invalid: string[] } | Promise<Checked<T> | { invalid: string[] }>,
    allowed = ATTEMPTS,
  ): Promise<{ result: T; attempts: number; agent: string }> {
    const agent = await this.deps.agent();
    ctx.progress(null, `Starting ${agent.label}`);
    let attempts = 0;
    let saved: { result: T } | null = null;
    const submit = async (input: unknown): Promise<SubmitReply> => {
      attempts++;
      const last = attempts >= allowed;
      const checked = await check(input);
      if ("invalid" in checked) {
        return last
          ? { text: "The answer still doesn't match the schema, so nothing was saved. Stop here.", done: true }
          : { text: `The answer doesn't match the schema:\n${checked.invalid.join("\n")}\nFix it and answer again.`, done: false };
      }
      if (checked.problems.length > 0 && !last) {
        return { text: `${checked.summary}\n${checked.problems.join("\n")}\nFix them and answer again with the whole ${checked.whole ?? (checked.review ? "answer" : "list")}.`, done: false, images: checked.images };
      }
      if (checked.review && !last) return { text: checked.review, done: false, images: checked.images };
      saved = { result: checked.result };
      return { text: `${checked.saved} Stop here.`, done: true };
    };
    await agent.run({ ...run, submit, activity: (label) => ctx.progress(null, label), signal: ctx.signal });
    if (ctx.signal.aborted) throw new Error("cancelled");
    const done = saved as { result: T } | null;
    if (!done) throw new Error(`${agent.label} finished without suggesting anything. Try again.`);
    return { result: done.result, attempts, agent: agent.label };
  }

  async run(projectId: string, ctx: JobContext, request?: string): Promise<void> {
    const project = await this.deps.store.get(projectId);
    const words = orderedWords(project);
    if (words.length === 0) throw new Error("The transcript isn't ready yet. Wait for transcription to finish, then try again.");

    const { result, attempts, agent } = await this.ask<{ proposals: Proposal[]; slides: Asset[]; title: string }>(
      ctx,
      { task: ANALYSIS_TASK, system: EDITOR_PROMPT, prompt: analysisPrompt(project, request) },
      (input) => {
        const parsed = AgentAnalysis.safeParse(input);
        if (!parsed.success) return { invalid: parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`) };
        const valid = validateProposals(parsed.data, words, project.sources, () => `a${shortId()}`, placeableAssets(project), soundIds);
        // Spaced against the punch-ins already accepted; pending ones are being replaced.
        const spaced = spaceProposedPunches(project, valid.proposals, words);
        const { proposals } = spaced;
        const errors = [...valid.errors, ...spaced.errors];
        return {
          result: { proposals, slides: valid.slides, title: parsed.data.suggestedTitle ?? "" },
          problems: errors,
          summary: `${errors.length} of ${parsed.data.proposals.length} proposals have problems:`,
          saved: `Saved ${proposals.length} ${proposals.length === 1 ? "proposal" : "proposals"}.`,
        };
      },
    );

    let gone: string[] = [];
    const updated = await this.deps.store.update(projectId, null, (p) => {
      // Words the user has since removed from the project can't be cut.
      const known = new Set(p.transcript.map((w) => w.id));
      const fresh = result.proposals.filter((x) => x.wordIds.every((id) => known.has(id)));
      p.proposals = request ? addRequested(p.proposals, fresh) : replacePending(p.proposals, fresh, (x) => AI_TYPES.includes(x.type));
      // New slides join for the proposals that stayed; slides only a replaced proposal showed go.
      const shown = new Set(p.proposals.map((x) => x.overlay?.assetId));
      p.assets.push(...result.slides.filter((a) => shown.has(a.id)));
      const unused = unusedSlides(p.assets, p.proposals);
      p.assets = p.assets.filter((a) => !unused.has(a.id));
      gone = [...unused];
      if (result.title && !request) p.suggestedTitle = result.title;
    });
    for (const id of gone) this.deps.forget?.(projectId, id);
    await this.deps.store.log(projectId, { type: request ? "requested" : "analyzed", agent, proposals: result.proposals.length, attempts });
    this.deps.changed(updated);
    await this.designMissing(projectId);
  }

  async runCorrections(projectId: string, ctx: JobContext): Promise<void> {
    const project = await this.deps.store.get(projectId);
    const words = orderedWords(project);
    if (words.length === 0) throw new Error("The transcript isn't ready yet. Wait for transcription to finish, then try again.");
    const dictionary = await this.deps.dictionary();

    const { result, attempts, agent } = await this.ask<Map<string, string>>(
      ctx,
      { task: CORRECTIONS_TASK, system: CORRECTOR_PROMPT, prompt: correctionsPrompt(project, dictionary) },
      (input) => {
        const parsed = AgentCorrections.safeParse(input);
        if (!parsed.success) return { invalid: parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`) };
        const { fixes, errors } = validateCorrections(parsed.data, words);
        return {
          result: fixes,
          problems: errors,
          summary: `${errors.length} of ${parsed.data.corrections.length} corrections have problems:`,
          saved: `Saved ${fixes.size} ${fixes.size === 1 ? "correction" : "corrections"}.`,
        };
      },
    );

    const updated = await this.deps.store.update(projectId, null, (p) => {
      p.transcript = applyCorrections(p.transcript, result);
    });
    await this.deps.store.log(projectId, { type: "corrected", agent, corrections: result.size, attempts });
    this.deps.changed(updated);
  }

  async runDescribe(projectId: string, ctx: JobContext): Promise<void> {
    const project = await this.deps.store.get(projectId);
    const assets = project.assets.filter((a) => a.prep && !a.description).slice(0, DESCRIBE_BATCH);
    if (assets.length === 0) return;
    const dir = this.deps.store.dir(projectId);
    const images = assets.flatMap((a) => a.prep!.frames.map((f) => join(dir, f)));

    const { result, attempts, agent } = await this.ask<Map<string, string>>(
      ctx,
      { task: DESCRIBE_TASK, system: DESCRIBER_PROMPT, prompt: describePrompt(assets), images },
      (input) => {
        const parsed = AgentDescriptions.safeParse(input);
        if (!parsed.success) return { invalid: parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`) };
        const { descriptions, errors } = validateDescriptions(parsed.data, assets);
        return {
          result: descriptions,
          problems: errors,
          summary: `${errors.length} problems with the descriptions:`,
          saved: `Saved ${descriptions.size} ${descriptions.size === 1 ? "description" : "descriptions"}.`,
        };
      },
    );

    const updated = await this.deps.store.update(projectId, null, (p) => {
      // One the user wrote in the meantime stays.
      for (const a of p.assets) if (!a.description) a.description = result.get(a.id) ?? "";
    });
    await this.deps.store.log(projectId, { type: "described", agent, media: result.size, attempts });
    this.deps.changed(updated);
    // More than one batch's worth goes on in another run.
    if (updated.assets.some((a) => a.prep && !a.description && !result.has(a.id)) && assets.length === DESCRIBE_BATCH) this.describe(projectId);
  }

  async runDesign(projectId: string, assetId: string, ctx: JobContext): Promise<void> {
    const studio = this.deps.slides;
    const project = await this.deps.store.get(projectId);
    const asset = project.assets.find((a) => a.id === assetId);
    if (!studio || !asset?.slide || asset.slide.html) return; // removed, or designed, while queued
    const brief = asset.slide;
    const frame = slideSize(project.aspectRatio);
    const seconds = asset.media.duration;
    const proposal = project.proposals.find((p) => p.overlay?.assetId === assetId);
    const said = new Set(proposal?.wordIds ?? []);
    const line = orderedWords(project)
      .filter((w) => said.has(w.id))
      .map((w) => w.text)
      .join(" ");
    const rel = slideStills(assetId);
    const dir = this.deps.store.dir(projectId);
    await mkdir(join(dir, "media", "assets", assetId), { recursive: true });
    // Early in the entrance, halfway, and the last frame.
    const times = [Math.min(0.4, seconds / 4), seconds / 2, Math.max(0, seconds - 1 / 30)];
    let reviewed = false;

    const { result, attempts, agent } = await this.ask<{ html: string } | null>(
      ctx,
      { task: SLIDE_TASK, system: DESIGNER_PROMPT, prompt: designPrompt(brief, frame, seconds, line) },
      async (input) => {
        const parsed = AgentSlide.safeParse(input);
        if (!parsed.success) return { invalid: parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`) };
        const { html } = parsed.data;
        const problems = slideProblems(html);
        ctx.progress(null, "Rendering the slide");
        const files = rel.map((f) => join(dir, f));
        let images: string[] | undefined;
        try {
          const rendered = await studio.stills({ html, look: brief.look }, frame, times, files);
          images = files;
          problems.push(...rendered.errors.map((e) => `The page reported an error: ${e}`));
          if (rendered.duration === 0) problems.push("Nothing moves: bring the elements in with CSS animations.");
          else if (rendered.duration > seconds - 0.2) {
            problems.push(`The animations run for ${rendered.duration.toFixed(1)}s, but the slide only shows for ${seconds.toFixed(1)}s: have everything in place well before the end.`);
          }
        } catch (e) {
          problems.push(`The slide didn't render: ${e instanceof Error ? e.message : String(e)}`);
        }
        const review = reviewed
          ? undefined
          : `Here is your slide at ${times.map((t) => `${t.toFixed(1)}s`).join(", ")}${brief.look === "overlay" ? " (over grey, where the video will be)" : ""}. Check that every word fits inside the frame, nothing overlaps or is cut off, it reads at a glance, and it says what the brief says. Then call submit_slide again with the final HTML: improved if anything is off, the same if it's right.`;
        if (images) reviewed = true;
        // A slide that doesn't render isn't saved, even as the last answer.
        return { result: images ? { html } : null, problems, summary: "The slide has problems:", saved: images ? "Saved the slide." : "Nothing was saved.", images, review };
      },
      DESIGN_ATTEMPTS,
    );

    if (!result) throw new Error(`${agent}'s slide didn't render, so it wasn't saved`);
    const updated = await this.deps.store.update(projectId, null, (p) => {
      // A slide removed or briefed again while it was being designed gets another design (see below).
      const a = p.assets.find((x) => x.id === assetId);
      if (!a?.slide || a.slide.html || a.slide.brief !== brief.brief || a.slide.look !== brief.look) return;
      a.slide.html = result.html;
      a.media = { ...a.media, width: frame.width, height: frame.height };
      a.prep = { preview: rel[1]!, frames: rel };
    });
    await this.deps.store.log(projectId, { type: "designed", agent, slide: assetId, attempts });
    this.deps.changed(updated);
    if (updated.assets.some((a) => a.id === assetId && a.slide && !a.slide.html)) this.design(projectId, asset);
  }

  async runShorts(projectId: string, ctx: JobContext, limits: { count: number; seconds: number }): Promise<void> {
    const project = await this.deps.store.get(projectId);
    const words = orderedWords(project);
    if (words.length === 0) throw new Error("The transcript isn't ready yet. Wait for transcription to finish, then try again.");

    const { result, attempts, agent } = await this.ask<ShortPlan[]>(
      ctx,
      { task: SHORTS_TASK, system: SHORTS_PROMPT, prompt: shortsPrompt(project, limits) },
      (input) => {
        const parsed = AgentShorts.safeParse(input);
        if (!parsed.success) return { invalid: parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`) };
        const { shorts, errors } = validateShorts(parsed.data, words, project.sources, project.segments, limits);
        return {
          result: shorts,
          problems: errors,
          summary: `${errors.length} of ${parsed.data.shorts.length} shorts have problems:`,
          saved: `Saved ${shorts.length} ${shorts.length === 1 ? "short" : "shorts"}.`,
        };
      },
    );

    ctx.progress(null, "Making the shorts");
    const made: Project["shorts"] = [];
    for (const plan of result) {
      const short = shortProject(project, plan, { id: randomUUID(), now: new Date().toISOString(), segmentId: shortId });
      await this.deps.store.createFrom(short, projectId);
      made.push({ id: short.id, title: plan.title, seconds: plan.seconds });
    }
    const updated = await this.deps.store.update(projectId, null, (p) => {
      p.shorts = [...p.shorts, ...made];
    });
    await this.deps.store.log(projectId, { type: "shorts", agent, shorts: made.map((m) => m.id), attempts });
    this.deps.changed(updated);
  }

  async runWriteup(projectId: string, ctx: JobContext): Promise<void> {
    const project = await this.deps.store.get(projectId);
    const words = orderedWords(project);
    if (words.length === 0) throw new Error("The transcript isn't ready yet. Wait for transcription to finish, then try again.");
    const timeline = buildTimeline(project);

    const { result, attempts, agent } = await this.ask<Writeup>(
      ctx,
      { task: WRITEUP_TASK, system: WRITEUP_PROMPT, prompt: writeupPrompt(project, timeline.duration) },
      (input) => {
        const parsed = AgentWriteup.safeParse(input);
        if (!parsed.success) return { invalid: parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`) };
        const { writeup, errors } = validateWriteup(parsed.data, words, project, timeline);
        return {
          result: writeup,
          problems: errors,
          summary: `The write-up has ${errors.length} ${errors.length === 1 ? "problem" : "problems"}:`,
          saved: `Saved ${writeup.chapters.length} ${writeup.chapters.length === 1 ? "chapter" : "chapters"}, the description and the article.`,
          whole: "answer",
        };
      },
    );
    const updated = await this.deps.store.update(projectId, null, (p) => {
      p.writeup = result;
    });
    await this.deps.store.log(projectId, { type: "writeup", agent, chapters: result.chapters.length, attempts });
    this.deps.changed(updated);
  }
}

/** A slide's stills, relative to the project folder: what the agent checks, the media list's thumbnail and the frames. */
export const slideStills = (assetId: string) => [1, 2, 3].map((n) => `media/assets/${assetId}/still-${n}.jpg`);

/**
 * Proposals from a request join the ones waiting. A pending AI proposal they
 * overlap is replaced; decided ones stay, since the user asked for this one.
 */
export function addRequested(current: Proposal[], fresh: Proposal[]): Proposal[] {
  const replaced = (p: Proposal) =>
    p.status === "pending" && AI_TYPES.includes(p.type) && fresh.some((f) => sameSpot(f, p));
  return [...current.filter((p) => !replaced(p)), ...fresh];
}
