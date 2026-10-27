// AI cut proposals. The agent reads the numbered transcript and answers with
// one `submit_analysis` call. Its answer is checked against the real words: a
// first answer with problems goes back to it once with the list, after which
// whatever checked out is saved as pending proposals for the user to decide.

import { randomUUID } from "node:crypto";
import { AI_TYPES, AgentAnalysis, type Project, type Proposal, replacePending, validateProposals } from "@clipcat/core";
import type { JobContext, JobQueue } from "../jobs/queue";
import type { ProjectStore } from "../store/projects";
import { SYSTEM_PROMPT, analysisPrompt, orderedWords } from "./prompt";

/** What a submit_analysis call tells the agent, and whether that ends the run. */
export type SubmitReply = { text: string; done: boolean };

export type AgentRun = {
  system: string;
  prompt: string;
  /** Called with the agent's raw submit_analysis input. */
  submit: (input: unknown) => Promise<SubmitReply>;
  /** A short line for the progress UI ("Claude is reading the transcript"). */
  activity: (label: string) => void;
  signal: AbortSignal;
};

/** An AI provider that can run one analysis: Claude Code now, Codex and the API later. */
export type Agent = { label: string; run: (run: AgentRun) => Promise<void> };

export type AnalysisDeps = {
  store: ProjectStore;
  queue: JobQueue;
  /** The agent to use, or an error saying why there is none (not installed, signed out). */
  agent: () => Promise<Agent>;
  changed: (project: Project) => void;
};

/** How many answers the agent gets: the first, and one retry with the problems listed. */
const ATTEMPTS = 2;

const shortId = () => randomUUID().slice(0, 8);

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

  async run(projectId: string, ctx: JobContext): Promise<void> {
    const project = await this.deps.store.get(projectId);
    const words = orderedWords(project);
    if (words.length === 0) throw new Error("There is no transcript to read yet");
    const agent = await this.deps.agent();
    ctx.progress(null, `Starting ${agent.label}`);

    let attempts = 0;
    let saved: { proposals: Proposal[]; title: string } | null = null;
    const submit = async (input: unknown): Promise<SubmitReply> => {
      attempts++;
      const parsed = AgentAnalysis.safeParse(input);
      if (!parsed.success) {
        const problems = parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`);
        return attempts < ATTEMPTS
          ? { text: `The analysis doesn't match the schema:\n${problems.join("\n")}\nFix it and call submit_analysis again.`, done: false }
          : { text: "The analysis still doesn't match the schema, so nothing was saved. Stop here.", done: true };
      }
      const { proposals, errors } = validateProposals(parsed.data, words, project.sources, () => `a${shortId()}`);
      if (errors.length > 0 && attempts < ATTEMPTS) {
        return {
          text: `${errors.length} of ${parsed.data.proposals.length} proposals have problems:\n${errors.join("\n")}\nFix them and call submit_analysis again with the whole analysis.`,
          done: false,
        };
      }
      saved = { proposals, title: parsed.data.suggestedTitle ?? "" };
      return { text: `Saved ${proposals.length} ${proposals.length === 1 ? "proposal" : "proposals"}. Stop here.`, done: true };
    };

    await agent.run({
      system: SYSTEM_PROMPT,
      prompt: analysisPrompt(project),
      submit,
      activity: (label) => ctx.progress(null, label),
      signal: ctx.signal,
    });
    if (ctx.signal.aborted) throw new Error("cancelled");
    const result = saved as { proposals: Proposal[]; title: string } | null;
    if (!result) throw new Error(`${agent.label} finished without proposing any cuts`);

    const updated = await this.deps.store.update(projectId, null, (p) => {
      // Words the user has since removed from the project can't be cut.
      const known = new Set(p.transcript.map((w) => w.id));
      const fresh = result.proposals.filter((x) => x.wordIds.every((id) => known.has(id)));
      p.proposals = replacePending(p.proposals, fresh, (x) => AI_TYPES.includes(x.type));
      if (result.title) p.suggestedTitle = result.title;
    });
    await this.deps.store.log(projectId, { type: "analyzed", agent: agent.label, proposals: result.proposals.length, attempts });
    this.deps.changed(updated);
  }
}
