// Vercel "Ignored Build Step" (vercel.json → ignoreCommand). Runs from apps/site/.
// Exit 0 skips the deployment; exit 1 builds it.
// Skips previews on agent branches, and builds only when something the site is made from
// changed since this branch's last deployment. When in doubt, it builds.
import { execFileSync } from "node:child_process";

// Everything the site build reads. Paths are relative to apps/site/.
// The site installs from the repo root (npm workspaces), so the root package files count too.
// If the site starts reading another file outside apps/site/, add it here.
const watched = [
  ".",
  "../../package.json",
  "../../package-lock.json",
];

const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });

function build(reason) {
  console.log(`Building: ${reason}`);
  process.exit(1);
}

// Agent branches are checked locally and deploy once they merge to main,
// so their previews would only add a second copy of every change to function storage.
const branch = process.env.VERCEL_GIT_COMMIT_REF ?? "";
const agentBranchPrefixes = ["claude/", "codex/"];
if (process.env.VERCEL_ENV === "preview" && agentBranchPrefixes.some(prefix => branch.startsWith(prefix))) {
  console.log(`Skipping: no previews for agent branch ${branch}.`);
  process.exit(0);
}

const base = process.env.VERCEL_GIT_PREVIOUS_SHA;
if (!base) build("no earlier deployment on this branch to compare with.");

try {
  git("cat-file", "-e", `${base}^{commit}`);
} catch {
  // Vercel clones shallowly; fetch the last deployed commit if it isn't in the clone.
  try {
    git("fetch", "--quiet", "--depth=1", "origin", base);
  } catch {
    build(`can't find the last deployed commit ${base}.`);
  }
}

let changed;
try {
  changed = git("diff", "--name-only", base, "HEAD", "--", ...watched).trim();
} catch {
  build(`couldn't compare with ${base}.`);
}

if (!changed) {
  console.log(`Skipping: nothing the site uses changed since ${base.slice(0, 7)}.`);
  process.exit(0);
}
build(`site files changed since ${base.slice(0, 7)}:\n${changed.split("\n").slice(0, 20).join("\n")}`);
