// The AI jobs: cut proposals for the whole video, cuts for one request ("cut
// the part about pricing"), transcript corrections, and shorts (each saved as
// its own vertical project). The agent reads the
// numbered transcript and answers through its task's submit tool (or JSON).
// Every answer is checked against the real words: a first answer with
// problems goes back once with the list, after which whatever checked out is
// saved. Cuts arrive as pending proposals for the user to decide.

import { randomUUID } from "node:crypto";
import {
  AI_TYPES,
  AgentAnalysis,
  AgentCorrections,
  AgentShorts,
  type Project,
  type Proposal,
  type ShortPlan,
  applyCorrections,
  cutsOverlap,
  replacePending,
  shortProject,
  validateCorrections,
  validateProposals,
  validateShorts,
} from "@clipcat/core";
import type { JobContext, JobQueue } from "../jobs/queue";
import type { ProjectStore } from "../store/projects";
import {
  ANALYSIS_TASK,
  type AgentTask,
  CORRECTIONS_TASK,
  CORRECTOR_PROMPT,
  EDITOR_PROMPT,
  SHORTS_PROMPT,
  SHORTS_TASK,
  analysisPrompt,
  correctionsPrompt,
  orderedWords,
  shortsPrompt,
} from "./prompt";

/** What a submit tells the agent, and whether that ends the run. */
export type SubmitReply = { text: string; done: boolean };

export type AgentRun = {
  task: AgentTask;
  /** The system prompt, without the task's answer instructions (each agent adds its own). */
  system: string;
  prompt: string;
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
};

/** How many answers the agent gets: the first, and one retry with the problems listed. */
const ATTEMPTS = 2;

const shortId = () => randomUUID().slice(0, 8);

/** What checking one answer found: the result to save, or problems to send back. */
type Checked<T> = { result: T; problems: string[]; summary: string; saved: string };

export class AnalysisRunner {
  constructor(private readonly deps: AnalysisDeps) {}

  /** Saves the brief and queues an analysis after whatever the project is already doing. */
  async analyze(projectId: string, brief: string): Promise<void> {
    const project = await this.deps.store.update(projectId, null, (p) => {
      p.brief = brief;
    });
    this.deps.changed(project);
    this.deps.queue.add(projectId, "analyze", "Finding cuts", (ctx) => this.run(projectId, ctx)).catch(() => {});
  }

  /** Queues cuts for one request, added to the proposals already waiting. */
  request(projectId: string, request: string): void {
    this.deps.queue.add(projectId, "analyze", "Following your request", (ctx) => this.run(projectId, ctx, request)).catch(() => {});
  }

  /** Queues a pass that fixes misheard names and terms in the transcript. */
  correct(projectId: string): void {
    this.deps.queue.add(projectId, "correct", "Checking the transcript", (ctx) => this.runCorrections(projectId, ctx)).catch(() => {});
  }

  /** Queues a pass that picks up to `count` shorts of about `seconds` each and makes a project of each. */
  shorts(projectId: string, count: number, seconds: number): void {
    this.deps.queue.add(projectId, "shorts", "Finding shorts", (ctx) => this.runShorts(projectId, ctx, { count, seconds })).catch(() => {});
  }

  /**
   * Runs `task` with the user's agent: each answer is checked, the first one
   * with problems goes back with them, and the last checked result is returned.
   */
  private async ask<T>(
    ctx: JobContext,
    run: { task: AgentTask; system: string; prompt: string },
    check: (input: unknown) => Checked<T> | { invalid: string[] },
  ): Promise<{ result: T; attempts: number; agent: string }> {
    const agent = await this.deps.agent();
    ctx.progress(null, `Starting ${agent.label}`);
    let attempts = 0;
    let saved: { result: T } | null = null;
    const submit = async (input: unknown): Promise<SubmitReply> => {
      attempts++;
      const last = attempts >= ATTEMPTS;
      const checked = check(input);
      if ("invalid" in checked) {
        return last
          ? { text: "The answer still doesn't match the schema, so nothing was saved. Stop here.", done: true }
          : { text: `The answer doesn't match the schema:\n${checked.invalid.join("\n")}\nFix it and answer again.`, done: false };
      }
      if (checked.problems.length > 0 && !last) {
        return { text: `${checked.summary}\n${checked.problems.join("\n")}\nFix them and answer again with the whole list.`, done: false };
      }
      saved = { result: checked.result };
      return { text: `${checked.saved} Stop here.`, done: true };
    };
    await agent.run({ ...run, submit, activity: (label) => ctx.progress(null, label), signal: ctx.signal });
    if (ctx.signal.aborted) throw new Error("cancelled");
    const done = saved as { result: T } | null;
    if (!done) throw new Error(`${agent.label} finished without an answer`);
    return { result: done.result, attempts, agent: agent.label };
  }

  async run(projectId: string, ctx: JobContext, request?: string): Promise<void> {
    const project = await this.deps.store.get(projectId);
    const words = orderedWords(project);
    if (words.length === 0) throw new Error("There is no transcript to read yet");

    const { result, attempts, agent } = await this.ask<{ proposals: Proposal[]; title: string }>(
      ctx,
      { task: ANALYSIS_TASK, system: EDITOR_PROMPT, prompt: analysisPrompt(project, request) },
      (input) => {
        const parsed = AgentAnalysis.safeParse(input);
        if (!parsed.success) return { invalid: parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`) };
        const { proposals, errors } = validateProposals(parsed.data, words, project.sources, () => `a${shortId()}`);
        return {
          result: { proposals, title: parsed.data.suggestedTitle ?? "" },
          problems: errors,
          summary: `${errors.length} of ${parsed.data.proposals.length} proposals have problems:`,
          saved: `Saved ${proposals.length} ${proposals.length === 1 ? "proposal" : "proposals"}.`,
        };
      },
    );

    const updated = await this.deps.store.update(projectId, null, (p) => {
      // Words the user has since removed from the project can't be cut.
      const known = new Set(p.transcript.map((w) => w.id));
      const fresh = result.proposals.filter((x) => x.wordIds.every((id) => known.has(id)));
      p.proposals = request ? addRequested(p.proposals, fresh) : replacePending(p.proposals, fresh, (x) => AI_TYPES.includes(x.type));
      if (result.title && !request) p.suggestedTitle = result.title;
    });
    await this.deps.store.log(projectId, { type: request ? "requested" : "analyzed", agent, proposals: result.proposals.length, attempts });
    this.deps.changed(updated);
  }

  async runCorrections(projectId: string, ctx: JobContext): Promise<void> {
    const project = await this.deps.store.get(projectId);
    const words = orderedWords(project);
    if (words.length === 0) throw new Error("There is no transcript to check yet");
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

  async runShorts(projectId: string, ctx: JobContext, limits: { count: number; seconds: number }): Promise<void> {
    const project = await this.deps.store.get(projectId);
    const words = orderedWords(project);
    if (words.length === 0) throw new Error("There is no transcript to read yet");

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
}

/**
 * Proposals from a request join the ones waiting. A pending AI proposal they
 * overlap is replaced; decided ones stay, since the user asked for this one.
 */
export function addRequested(current: Proposal[], fresh: Proposal[]): Proposal[] {
  const replaced = (p: Proposal) =>
    p.status === "pending" && AI_TYPES.includes(p.type) && fresh.some((f) => f.sourceId === p.sourceId && cutsOverlap(f.cuts, p.cuts));
  return [...current.filter((p) => !replaced(p)), ...fresh];
}
