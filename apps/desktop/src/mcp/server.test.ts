import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { type EditOp, SOUND_EFFECTS, applyEdit, initialSegments } from "@clipcat/core";
import { counter, source, words } from "@clipcat/core/fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectStore } from "../store/projects";
import { type McpDeps, createMcpServer } from "./server";

let root: string;
let store: ProjectStore;
let projectId: string;
let client: Client;
let deps: McpDeps;

const textOf = (r: Awaited<ReturnType<Client["callTool"]>>) => (r.content as { text: string }[])[0]!.text;
const call = async (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "clipcat-mcp-server-"));
  store = new ProjectStore(root);
  const created = await store.create("Launch video");
  projectId = created.id;
  await store.update(projectId, null, (p) => {
    p.sources = [source("a", 10)];
    p.transcript = words("a", "so um this is the launch video");
    p.segments = initialSegments("a", 10, counter("s"));
    p.proposals = [
      { id: "p1", type: "cleanup", sourceId: "a", cuts: [[0.5, 1.2]], wordIds: ["a-w1"], keepWordIds: [], reason: "Filler", confidence: 0.9, status: "pending", punch: null, overlay: null, sound: null, music: null },
    ];
  });
  deps = {
    version: "0.1.0",
    list: () => store.list(),
    get: (id) => store.get(id),
    edit: (id, revision, op: EditOp) => store.update(id, revision, (p) => applyEdit(p, op, () => `g${randomUUID().slice(0, 8)}`)),
    analyze: vi.fn(async () => {}),
    request: vi.fn(async () => {}),
    writeup: vi.fn(async () => {}),
    shorts: vi.fn(async () => {}),
    exportVideo: vi.fn(async () => {}),
    importFiles: vi.fn(async () => store.get(projectId)),
    addMusic: vi.fn(async () => store.get(projectId)),
    exportTimeline: vi.fn(async () => {}),
    jobs: () => [{ projectId, jobId: "job-1", kind: "export", label: "Exporting 16:9", state: "running", fraction: 0.5 }],
  };
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer(deps).connect(a);
  client = new Client({ name: "test", version: "1" });
  await client.connect(b);
});
afterEach(async () => {
  await client.close();
  await rm(root, { recursive: true, force: true });
});

describe("ClipCat's MCP server", () => {
  it("lists its tools, read-only ones marked", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["list_projects", "get_transcript", "cut_words", "decide_proposals", "edit_project", "export_video"]));
    expect(tools.find((t) => t.name === "get_transcript")!.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "cut_words")!.annotations?.readOnlyHint).toBe(false);
    expect(tools.every((t) => t.description)).toBe(true);
  });

  it("has every tool and sound effect in the help page for agents", async () => {
    const guide = await readFile(join(__dirname, "..", "..", "..", "..", "docs", "agents.md"), "utf8");
    const { tools } = await client.listTools();
    for (const tool of tools) expect(guide, `docs/agents.md doesn't mention ${tool.name}`).toContain(`**${tool.name}**`);
    for (const effect of SOUND_EFFECTS) expect(guide, `docs/agents.md doesn't list the ${effect.id} effect`).toMatch(new RegExp(`\\b${effect.id}\\b`));
  });

  it("reads projects and the numbered transcript", async () => {
    expect(JSON.parse(textOf(await call("list_projects")))[0].name).toBe("Launch video");
    const summary = JSON.parse(textOf(await call("get_project", { projectId })));
    expect(summary).toMatchObject({ revision: 1, words: 7, proposals: { cleanup: { pending: 1 } } });
    expect(textOf(await call("get_transcript", { projectId }))).toMatch(/^Revision 1\. 7 words[\s\S]*\[0\]so \[1\]um \[2\]this/);
  });

  it("cuts words by number, shows them cut, and restores them", async () => {
    expect(textOf(await call("cut_words", { projectId, revision: 1, from: 1, to: 1 }))).toMatch(/Cut words 1-1\. Revision 2/);
    expect(textOf(await call("get_transcript", { projectId }))).toContain("[1]~um~");
    await call("cut_words", { projectId, revision: 2, from: 1, to: 1, restore: true });
    expect(textOf(await call("get_transcript", { projectId }))).toContain("[1]um");
  });

  it("refuses an edit based on an old revision", async () => {
    await call("cut_words", { projectId, revision: 1, from: 0, to: 0 });
    const stale = await call("cut_words", { projectId, revision: 1, from: 2, to: 2 });
    expect(stale.isError).toBe(true);
    expect(textOf(stale)).toMatch(/changed since revision 1/);
  });

  it("lists and decides proposals", async () => {
    const listed = JSON.parse(textOf(await call("list_proposals", { projectId })));
    expect(listed.proposals).toEqual([expect.objectContaining({ id: "p1", type: "cleanup", words: "1", reason: "Filler" })]);
    await call("decide_proposals", { projectId, revision: 1, ids: ["p1"], status: "accepted" });
    expect((await store.get(projectId)).proposals[0]!.status).toBe("accepted");
  });

  it("takes any edit op with word numbers, and explains a bad one", async () => {
    await call("edit_project", { projectId, revision: 1, op: { type: "punch", from: 4, to: 6, style: "zoom-in" } });
    await call("edit_project", { projectId, revision: 2, op: { type: "sound", word: 5, effect: "ding" } });
    const p = await store.get(projectId);
    expect(p.proposals.filter((x) => x.punch).length).toBe(1);
    expect(p.proposals.find((x) => x.sound)?.sound?.effect).toBe("ding");
    const bad = await call("edit_project", { projectId, revision: 3, op: { type: "punch", from: 0, to: 99, style: "zoom-in" } });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toMatch(/word number from 0 to 6/);
    const unknown = await call("edit_project", { projectId, revision: 3, op: { type: "explode" } });
    expect(unknown.isError).toBe(true);
  });

  it("queues the app's own jobs", async () => {
    await call("find_cuts", { projectId, brief: "tight" });
    expect(deps.analyze).toHaveBeenCalledWith(projectId, "tight");
    await call("find_cuts", { projectId, request: "cut the intro" });
    expect(deps.request).toHaveBeenCalledWith(projectId, "cut the intro");
    await call("export_video", { projectId, format: "9:16", path: "/tmp/out.mp4" });
    expect(deps.exportVideo).toHaveBeenCalledWith(projectId, "9:16", "/tmp/out.mp4");
    expect((await call("export_video", { projectId, format: "9:16", path: "/tmp/out.mov" })).isError).toBe(true);
    expect(JSON.parse(textOf(await call("list_jobs", { projectId })))[0].state).toBe("running");
    await call("export_timeline", { projectId, format: "fcpxml", path: "/tmp/cut.fcpxml" });
    expect(deps.exportTimeline).toHaveBeenCalledWith(projectId, "fcpxml", "/tmp/cut.fcpxml");
  });
});
