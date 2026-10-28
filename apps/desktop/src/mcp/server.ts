// ClipCat's external MCP server: the tools Claude Code, Codex or the Claude
// desktop app use to drive the editor from outside it. Reads come straight
// from the project store; every change goes through the same applyEdit path
// as the transcript editor, with the same revision check, so an outside
// agent and the person at the window can't overwrite each other's edits.
// Words are addressed by their index in the numbered transcript, the same
// numbering ClipCat's own AI editor reads.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { EditOp, type Project, SOUND_EFFECTS, type TimelineFormat, buildTimeline, isWordKept, orderedWords } from "@clipcat/core";
import type { JobEventValue, ProjectSummaryValue } from "@clipcat/ipc";
import { numberedTranscript } from "../ai/prompt";

export type ExportFormat = "16:9" | "9:16";

export type McpDeps = {
  version: string;
  list: () => Promise<ProjectSummaryValue[]>;
  get: (id: string) => Promise<Project>;
  /** One edit, checked against `revision`; resolves with the saved project. */
  edit: (id: string, revision: number, op: EditOp) => Promise<Project>;
  analyze: (id: string, brief: string) => Promise<void>;
  request: (id: string, request: string) => Promise<void>;
  writeup: (id: string) => Promise<void>;
  shorts: (id: string, count: number, seconds: 30 | 60 | 90) => Promise<void>;
  exportVideo: (id: string, format: ExportFormat, path: string) => Promise<void>;
  importFiles: (files: string[], projectId: string | null) => Promise<Project>;
  /** Writes the edit as a timeline file for another editor. */
  exportTimeline: (id: string, format: TimelineFormat, path: string) => Promise<void>;
  /** The latest state of recent jobs, newest first. */
  jobs: (projectId: string | null) => JobEventValue[];
};

const INSTRUCTIONS = `ClipCat is a video editor for talking-head recordings. It cuts by editing the transcript: removing words removes that stretch of video. Nothing here deletes footage; every cut can be restored or undone.

Typical flow: list_projects, then get_transcript for the project you want. The transcript numbers every word [n]; words already cut are shown ~like this~. Use those numbers with cut_words, or with edit_project for punch-ins (the app calls them zooms), b-roll, slides and sound effects. ClipCat's own AI editor can also propose cuts (find_cuts), which you then accept or reject with decide_proposals.

Every change takes the project's revision from your last read. If someone else changed the project since, the change is refused: read it again and retry.`;

const ProjectId = z.string().regex(/^[a-zA-Z0-9-]+$/).describe("The project's id, from list_projects.");
const Revision = z.number().int().nonnegative().describe("The revision you last read, from get_project or get_transcript.");

const json = (value: unknown): CallToolResult => ({ content: [{ type: "text", text: JSON.stringify(value, null, 1) }] });
const text = (value: string): CallToolResult => ({ content: [{ type: "text", text: value }] });

/** Runs a tool body, turning a thrown error into a tool error the agent can read and act on. */
async function guard(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (e) {
    const message = e instanceof z.ZodError ? z.prettifyError(e) : e instanceof Error ? e.message : String(e);
    return { content: [{ type: "text", text: message }], isError: true };
  }
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Word id → its index in the numbered transcript. */
function indexer(project: Project): { words: ReturnType<typeof orderedWords>; index: Map<string, number> } {
  const words = orderedWords(project);
  return { words, index: new Map(words.map((w, i) => [w.id, i])) };
}

/** A run of word indices, as "12-30" or "12". */
function spans(indices: number[]): string {
  const sorted = [...indices].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i]!;
    while (i + 1 < sorted.length && sorted[i + 1] === sorted[i]! + 1) i++;
    out.push(start === sorted[i] ? `${start}` : `${start}-${sorted[i]}`);
  }
  return out.join(", ");
}

export function projectSummary(project: Project) {
  const { index } = indexer(project);
  const counts: Record<string, Record<string, number>> = {};
  for (const p of project.proposals) {
    const byStatus = (counts[p.type] ??= {});
    byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
  }
  return {
    id: project.id,
    name: project.name,
    revision: project.revision,
    updatedAt: project.updatedAt,
    suggestedTitle: project.suggestedTitle || null,
    brief: project.brief || null,
    recordings: [...project.sources]
      .sort((a, b) => a.order - b.order)
      .map((s) => ({ id: s.id, name: s.name, seconds: round(s.media.duration), prepared: s.prep !== null, transcribed: s.transcription !== null })),
    words: project.transcript.length,
    editedSeconds: round(buildTimeline(project).duration),
    speed: project.speed,
    aspectRatio: project.aspectRatio,
    captions: project.captions,
    proposals: counts,
    media: project.assets.map((a) => ({ id: a.id, name: a.name, kind: a.kind, description: a.kind === "slide" ? (a.slide?.brief ?? "") : a.description })),
    music: project.music ? { name: project.music.name, volume: project.music.volume, duck: project.music.duck } : null,
    chapters: (project.writeup?.chapters ?? []).map((c) => ({ word: index.get(c.wordId) ?? null, title: c.title })),
    description: project.writeup?.description || null,
    article: project.writeup?.article.title || (project.writeup?.article.markdown ? "(untitled)" : null),
    thumbnail: project.thumbnail ? { text: project.thumbnail.text, background: project.thumbnail.background } : null,
    shorts: project.shorts,
    origin: project.origin ? { projectId: project.origin.projectId, name: project.origin.name } : null,
    lastExport: project.lastExport,
  };
}

// Ops that name words take word numbers here instead of ids: `from`/`to`
// (inclusive) for the ones over a stretch, `word` for the ones on one word.
const SPAN_OPS = new Set(["words", "punch", "overlay", "slide"]);
const WORD_OPS = new Set(["sound", "chapter", "remove-chapter"]);

/** The agent's op, with word numbers turned into the word ids applyEdit takes, then checked against EditOp. */
export function resolveOp(project: Project, raw: Record<string, unknown>): EditOp {
  const { words } = indexer(project);
  const at = (n: unknown, name: string) => {
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n >= words.length) {
      throw new Error(`${name} must be a word number from 0 to ${words.length - 1}`);
    }
    return n;
  };
  const { from, to, word, ...rest } = raw;
  const op: Record<string, unknown> = { ...rest };
  if (SPAN_OPS.has(String(raw.type)) && from !== undefined) {
    const a = at(from, "from");
    const b = at(to ?? from, "to");
    if (b < a) throw new Error("to must not come before from");
    op.wordIds = words.slice(a, b + 1).map((w) => w.id);
  }
  if (WORD_OPS.has(String(raw.type)) && word !== undefined) op.wordId = words[at(word, "word")]!.id;
  return EditOp.parse(op);
}

/** The tools, on a new server; one server per connected agent. */
export function createMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer({ name: "clipcat", title: "ClipCat", version: deps.version }, { instructions: INSTRUCTIONS });
  const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const change = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

  server.registerTool(
    "list_projects",
    { title: "List projects", description: "Every ClipCat project, newest first: its id, name, length in seconds and how many recordings it has.", annotations: read },
    () => guard(async () => json(await deps.list())),
  );

  server.registerTool(
    "get_project",
    {
      title: "Get a project",
      description: "One project's state: its revision, recordings, edited length, caption style, the AI editor's proposals by type and status, b-roll media (with ids for edit_project), music, chapters, write-up and last export.",
      inputSchema: { projectId: ProjectId },
      annotations: read,
    },
    ({ projectId }) => guard(async () => json(projectSummary(await deps.get(projectId)))),
  );

  server.registerTool(
    "get_transcript",
    {
      title: "Read the transcript",
      description:
        "The project's transcript with every word numbered [n], recording by recording, with @seconds at the start of each line and long pauses marked. Words the edit removes are shown ~like this~. Starts with the revision to pass to edits.",
      inputSchema: { projectId: ProjectId },
      annotations: read,
    },
    ({ projectId }) =>
      guard(async () => {
        const project = await deps.get(projectId);
        if (project.transcript.length === 0) return text(`Revision ${project.revision}. No transcript yet: the recordings are still being transcribed, or have no speech. Check list_jobs.`);
        const body = numberedTranscript(project, (w) => !isWordKept(project.segments, w));
        return text(`Revision ${project.revision}. ${project.transcript.length} words, ${round(buildTimeline(project).duration)} s after edits.\n\n${body}`);
      }),
  );

  server.registerTool(
    "list_proposals",
    {
      title: "List proposals",
      description:
        "The edits ClipCat's AI editor or its silence finder proposed: cuts (silence, retake, cleanup, tighten), punch-ins, b-roll (visual) and sound effects, each with its id, the words it covers and why. Accept or reject them with decide_proposals.",
      inputSchema: {
        projectId: ProjectId,
        status: z.enum(["pending", "accepted", "rejected", "all"]).default("pending").describe("Which ones to list."),
      },
      annotations: read,
    },
    ({ projectId, status }) =>
      guard(async () => {
        const project = await deps.get(projectId);
        const { index } = indexer(project);
        const list = project.proposals
          .filter((p) => status === "all" || p.status === status)
          .map((p) => ({
            id: p.id,
            type: p.type,
            status: p.status,
            words: spans(p.wordIds.map((id) => index.get(id)).filter((n): n is number => n !== undefined)) || null,
            ...(p.keepWordIds.length ? { keeps: spans(p.keepWordIds.map((id) => index.get(id)).filter((n): n is number => n !== undefined)) } : {}),
            cutSeconds: round(p.cuts.reduce((n, [a, b]) => n + (b - a), 0)),
            reason: p.reason,
            confidence: p.confidence,
            ...(p.punch ? { punch: p.punch.style } : {}),
            ...(p.sound ? { sound: p.sound.effect } : {}),
            ...(p.overlay ? { media: project.assets.find((a) => a.id === p.overlay!.assetId)?.name ?? p.overlay.assetId } : {}),
          }));
        return json({ revision: project.revision, proposals: list });
      }),
  );

  server.registerTool(
    "list_jobs",
    {
      title: "List jobs",
      description: "What ClipCat is doing or has just done: preparing and transcribing recordings, AI passes and exports, with their state and progress. Newest first.",
      inputSchema: { projectId: ProjectId.optional().describe("Only this project's jobs.") },
      annotations: { ...read, idempotentHint: false },
    },
    ({ projectId }) => guard(async () => json(deps.jobs(projectId ?? null))),
  );

  server.registerTool(
    "cut_words",
    {
      title: "Cut or restore words",
      description: "Cuts words from..to (inclusive, numbered as in get_transcript) out of the video, or with restore: true puts them back. The cut runs from the middle of the pause before to the middle of the pause after, so the speech either side keeps its breath. One undo step.",
      inputSchema: {
        projectId: ProjectId,
        revision: Revision,
        from: z.number().int().nonnegative(),
        to: z.number().int().nonnegative(),
        restore: z.boolean().default(false),
      },
      annotations: change,
    },
    ({ projectId, revision, from, to, restore }) =>
      guard(async () => {
        const project = await deps.get(projectId);
        const op = resolveOp(project, { type: "words", from, to, included: restore });
        const next = await deps.edit(projectId, revision, op);
        return text(`${restore ? "Restored" : "Cut"} words ${from}-${to}. Revision ${next.revision}; ${round(buildTimeline(next).duration)} s after edits.`);
      }),
  );

  server.registerTool(
    "decide_proposals",
    {
      title: "Accept or reject proposals",
      description: "Accepts or rejects proposals by id (from list_proposals), or puts them back to pending. Accepting a cut removes its words; accepting a punch-in, b-roll or sound effect adds it. One undo step.",
      inputSchema: {
        projectId: ProjectId,
        revision: Revision,
        ids: z.array(z.string()).min(1).max(10_000),
        status: z.enum(["accepted", "rejected", "pending"]),
      },
      annotations: change,
    },
    ({ projectId, revision, ids, status }) =>
      guard(async () => {
        const next = await deps.edit(projectId, revision, { type: "decide", ids, status });
        return text(`Marked ${ids.length} ${ids.length === 1 ? "proposal" : "proposals"} ${status}. Revision ${next.revision}; ${round(buildTimeline(next).duration)} s after edits.`);
      }),
  );

  server.registerTool(
    "edit_project",
    {
      title: "Edit the project",
      description: `Any other change, as one op object with a "type". Ops over a stretch of words take from/to word numbers; ops on one word take word.
- {type:"punch", from, to, style:"cut"|"zoom-in"|"slow-zoom"}: zoom in on those words
- {type:"overlay", from, to, assetId, placement:"full"|"pip"}: b-roll from the project's media (ids in get_project)
- {type:"slide", from, to, brief, look:"paper"|"ink"|"overlay"}: a motion slide ClipCat's AI editor designs from the brief
- {type:"sound", word, effect}: a sound effect on that word; effects: ${SOUND_EFFECTS.map((e) => e.id).join(", ")}
- {type:"chapter", word, title} / {type:"remove-chapter", word}
- {type:"captions", captions:{enabled, mode:"word"|"sentence", font, size, color:"#RRGGBB", effect:"none"|"shadow", case:"regular"|"upper"|"lower", background:"none"|"rounded", position:0..1}} (any subset)
- {type:"speed", speed:0.5..2} / {type:"aspect", aspectRatio:"16:9"|"9:16"|"1:1"}
- {type:"music", volume?:0..1, duck?:boolean} / {type:"remove-music"}
- {type:"writeup", description?, articleTitle?, article?}
- {type:"thumbnail", text?, textColor?:"paper"|"ink"|"tape", background?:"frame"|"blur"|"paper"|"ink"|"tape", textSide?:"left"|"right", behind?:boolean}
- {type:"undo"} / {type:"redo"}
A mistake in the op comes back as an error saying what to fix.`,
      inputSchema: { projectId: ProjectId, revision: Revision, op: z.record(z.string(), z.unknown()).describe("The op, as listed above.") },
      annotations: change,
    },
    ({ projectId, revision, op }) =>
      guard(async () => {
        const project = await deps.get(projectId);
        const next = await deps.edit(projectId, revision, resolveOp(project, op));
        return text(`Done. Revision ${next.revision}; ${round(buildTimeline(next).duration)} s after edits.`);
      }),
  );

  server.registerTool(
    "find_cuts",
    {
      title: "Ask ClipCat's AI editor for cuts",
      description:
        "Queues a pass by the AI editor chosen in ClipCat (the user's Claude Code, Codex or Claude API key). With a brief, it proposes retake, cleanup and tighten cuts, punch-ins, b-roll and sound effects for the whole video; with a request (\"cut the part about pricing\") it proposes just that. Proposals arrive pending: see list_jobs, then list_proposals.",
      inputSchema: {
        projectId: ProjectId,
        brief: z.string().max(4000).optional().describe("What the video is for and what to keep; saved for later passes."),
        request: z.string().trim().min(1).max(1000).optional().describe("One specific change to propose."),
      },
      annotations: { ...change, openWorldHint: true },
    },
    ({ projectId, brief, request }) =>
      guard(async () => {
        if (request) await deps.request(projectId, request);
        else await deps.analyze(projectId, brief ?? (await deps.get(projectId)).brief);
        return text("Queued. Watch list_jobs for it to finish, then read list_proposals.");
      }),
  );

  server.registerTool(
    "write_up",
    {
      title: "Write chapters, description and article",
      description: "Queues ClipCat's AI editor to write chapters, a description and an article from the edited video. They show in get_project when done.",
      inputSchema: { projectId: ProjectId },
      annotations: { ...change, openWorldHint: true },
    },
    ({ projectId }) =>
      guard(async () => {
        await deps.writeup(projectId);
        return text("Queued. Watch list_jobs for it to finish.");
      }),
  );

  server.registerTool(
    "make_shorts",
    {
      title: "Make shorts",
      description: "Queues ClipCat's AI editor to pick up to count stretches that work as vertical shorts, each saved as its own project (listed under shorts in get_project).",
      inputSchema: { projectId: ProjectId, count: z.number().int().min(1).max(10).default(3), seconds: z.union([z.literal(30), z.literal(60), z.literal(90)]).default(60) },
      annotations: { ...change, openWorldHint: true },
    },
    ({ projectId, count, seconds }) =>
      guard(async () => {
        await deps.shorts(projectId, count, seconds);
        return text("Queued. Watch list_jobs for it to finish.");
      }),
  );

  server.registerTool(
    "export_video",
    {
      title: "Export the video",
      description: "Queues rendering the edited video to an MP4 at path (absolute; an existing file there is replaced), 16:9 or 9:16, with captions, b-roll, slides, sounds and music. Captions are also written beside it as an .srt. Watch list_jobs for progress.",
      inputSchema: {
        projectId: ProjectId,
        format: z.enum(["16:9", "9:16"]),
        path: z.string().min(1).max(4096).regex(/\.mp4$/i, "path must end in .mp4"),
      },
      annotations: { ...change, destructiveHint: true },
    },
    ({ projectId, format, path }) =>
      guard(async () => {
        await deps.exportVideo(projectId, format, path);
        return text(`Queued the ${format} export to ${path}.`);
      }),
  );

  server.registerTool(
    "export_timeline",
    {
      title: "Export a timeline for another editor",
      description:
        "Writes the edit (the kept stretches of the original recordings, at normal speed, with chapters as markers) to path as a timeline: fcpxml for Final Cut Pro or DaVinci Resolve (.fcpxml), premiere for Premiere Pro (Final Cut 7 XML, .xml), or edl (CMX 3600, .edl). Captions, punch-ins, b-roll and sounds stay in ClipCat.",
      inputSchema: {
        projectId: ProjectId,
        format: z.enum(["fcpxml", "premiere", "edl"]),
        path: z.string().min(1).max(4096).describe("Absolute path; an existing file there is replaced."),
      },
      annotations: { ...change, destructiveHint: true, idempotentHint: true },
    },
    ({ projectId, format, path }) =>
      guard(async () => {
        await deps.exportTimeline(projectId, format, path);
        return text(`Wrote the ${format} timeline to ${path}.`);
      }),
  );

  server.registerTool(
    "import_videos",
    {
      title: "Import recordings",
      description: "Adds video or audio files (absolute paths) to a project, or to a new one when projectId is left out. ClipCat prepares and transcribes them; watch list_jobs, then read get_transcript.",
      inputSchema: { files: z.array(z.string().min(1).max(4096)).min(1).max(200), projectId: ProjectId.optional() },
      annotations: change,
    },
    ({ files, projectId }) =>
      guard(async () => {
        const project = await deps.importFiles(files, projectId ?? null);
        return json({ projectId: project.id, name: project.name, revision: project.revision });
      }),
  );

  return server;
}
