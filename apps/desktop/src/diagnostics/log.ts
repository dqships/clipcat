// The main process's own log: warnings, errors, crashed processes and failed
// jobs, appended to `<userData>/logs/main.log` as they happen so they survive
// a crash. One older file is kept when it passes its size limit.

import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { inspect } from "node:util";

const LIMIT = 1024 * 1024;

export class MainLog {
  private ready = false;

  constructor(
    readonly path: string,
    private readonly limit = LIMIT,
  ) {}

  /** The previous file, once the current one has filled up. */
  get oldPath(): string {
    return this.path.replace(/\.log$/, ".old.log");
  }

  write(level: "info" | "warn" | "error", ...parts: unknown[]): void {
    const text = parts.map((p) => (typeof p === "string" ? p : inspect(p, { depth: 4, breakLength: Infinity }))).join(" ");
    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${text.replace(/\n/g, "\n  ")}\n`;
    try {
      if (!this.ready) {
        mkdirSync(dirname(this.path), { recursive: true });
        this.ready = true;
      }
      if (existsSync(this.path) && statSync(this.path).size + line.length > this.limit) renameSync(this.path, this.oldPath);
      // Synchronous on purpose: the line has to be on disk if the next thing is a crash.
      appendFileSync(this.path, line);
    } catch {
      // Logging must never be the thing that breaks the app.
    }
  }

  /** Copies console warnings and errors into the log, and records what Node would otherwise only print. */
  capture(target: NodeJS.Process = process, out: Pick<Console, "warn" | "error"> = console): void {
    for (const level of ["warn", "error"] as const) {
      const original = out[level].bind(out);
      out[level] = (...args: unknown[]) => {
        this.write(level, ...args);
        original(...args);
      };
    }
    // The monitor sees an uncaught exception without changing what happens next.
    target.on("uncaughtExceptionMonitor", (error, origin) => this.write("error", `${origin}:`, error));
    target.on("unhandledRejection", (reason) => this.write("error", "unhandled rejection:", reason));
  }
}
