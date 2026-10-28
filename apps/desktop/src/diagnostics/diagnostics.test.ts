import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { diagnosticsZip, projectShape } from "./bundle";
import { MainLog } from "./log";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "clipcat-diag-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("MainLog", () => {
  it("appends lines and keeps one older file once it fills up", () => {
    const log = new MainLog(join(dir, "logs", "main.log"), 200);
    log.write("warn", "first", { a: 1 });
    expect(readFileSync(log.path, "utf8")).toMatch(/^\S+ WARN first \{ a: 1 \}\n$/);
    for (let i = 0; i < 2; i++) log.write("error", "x".repeat(60));
    expect(readFileSync(log.oldPath, "utf8")).toContain("WARN first");
    expect(readFileSync(log.path, "utf8").length).toBeLessThanOrEqual(200);
  });

  it("copies console warnings and errors, and records unhandled rejections", () => {
    const log = new MainLog(join(dir, "main.log"));
    const out = { warn: vi.fn(), error: vi.fn() };
    const handlers = new Map<string, (...a: unknown[]) => void>();
    const target = { on: (event: string, h: (...a: unknown[]) => void) => handlers.set(event, h) } as unknown as NodeJS.Process;
    log.capture(target, out);
    out.error("boom");
    handlers.get("unhandledRejection")?.(new Error("nobody caught me"));
    handlers.get("uncaughtExceptionMonitor")?.(new Error("fatal"), "uncaughtException");
    const text = readFileSync(log.path, "utf8");
    expect(text).toContain("ERROR boom");
    expect(text).toContain("unhandled rejection: Error: nobody caught me");
    expect(text).toContain("uncaughtException: Error: fatal");
  });
});

describe("diagnosticsZip", () => {
  it("keeps a project's shape and drops its words", () => {
    const shape = projectShape({
      id: "p1",
      sources: [{ id: "s1", name: "talk.mp4", path: "/Users/dq/Movies/talk.mp4", media: { duration: 3 } }],
      transcript: [{ text: "secret plans" }],
      proposals: [{ type: "silence", status: "pending" }, { type: "silence", status: "pending" }, { type: "retake", status: "accepted" }],
      writeup: { article: "private" },
    });
    expect(JSON.stringify(shape)).not.toMatch(/secret|private|\/Users/);
    expect(shape).toMatchObject({ words: 1, proposals: { "silence:pending": 2, "retake:accepted": 1 } });
  });

  it("bundles logs, jobs, project shapes and events, and the newest crash dumps, with the home folder hidden", async () => {
    const home = join(dir, "home");
    const logs = join(dir, "logs");
    mkdirSync(logs);
    writeFileSync(join(logs, "main.log"), `ERROR failed reading ${home}/Movies/a.mp4\n`);
    const projects = join(dir, "projects");
    mkdirSync(join(projects, "p1"), { recursive: true });
    writeFileSync(join(projects, "p1", "project.json"), JSON.stringify({ id: "p1", transcript: [{ text: "hello" }] }));
    writeFileSync(join(projects, "p1", "events.jsonl"), Array.from({ length: 600 }, (_, i) => `{"n":${i}}`).join("\n"));
    mkdirSync(join(projects, "broken"));
    writeFileSync(join(projects, "broken", "project.json"), "{ not json");
    const crashes = join(dir, "Crashpad", "completed");
    mkdirSync(crashes, { recursive: true });
    writeFileSync(join(crashes, "a.dmp"), "dump");

    const zip = await diagnosticsZip({
      about: { versions: { app: "0.1.0" } },
      logs: [join(logs, "main.old.log"), join(logs, "main.log")],
      jobs: [{ kind: "export", state: "failed" }],
      projectsDir: projects,
      crashDir: join(dir, "Crashpad"),
      home,
    });
    const files = unzipSync(zip);
    const read = (name: string) => strFromU8(files[name]!);
    expect(Object.keys(files).sort()).toEqual(
      ["about.json", "crashes/a.dmp", "crashes/list.json", "jobs.json", "logs/main.log", "projects/p1/events.jsonl", "projects/p1/shape.json"].sort(),
    );
    expect(read("logs/main.log")).toBe("ERROR failed reading ~/Movies/a.mp4\n");
    expect(read("projects/p1/shape.json")).not.toContain("hello");
    expect(read("projects/p1/events.jsonl").trim().split("\n")).toHaveLength(500);
    const about = JSON.parse(read("about.json"));
    expect(about.versions.app).toBe("0.1.0");
    expect(about.problems.join("\n")).toMatch(/main\.old\.log/);
    expect(about.problems.join("\n")).toMatch(/project broken/);
  });
});
