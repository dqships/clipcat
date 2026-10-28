// Builds `clipcat-recorder` (native/recorder, a Swift helper that records the
// screen with ScreenCaptureKit) into vendor/bin/darwin-<arch>/. macOS only,
// and needs Xcode 16 or its command line tools (Swift 6). Recording itself
// needs macOS 15; on older systems, and on Windows, ClipCat records the
// screen through Chromium instead.
//
//   npm run build:recorder

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = join(root, "native", "recorder");
const arch = process.arch;
const out = join(root, "vendor", "bin", `darwin-${arch}`, "clipcat-recorder");

if (process.platform !== "darwin") {
  console.log("The ScreenCaptureKit recorder is for macOS; skipping (Chromium records the screen here).");
  process.exit(0);
}
if (existsSync(out) && !process.argv.includes("--force")) {
  console.log(`✓ darwin-${arch}/clipcat-recorder already built (use --force to rebuild)`);
  process.exit(0);
}

const swift = ["build", "-c", "release", "--package-path", pkg, "--arch", arch === "arm64" ? "arm64" : "x86_64"];
execFileSync("swift", swift, { stdio: "inherit" });
const bin = execFileSync("swift", [...swift, "--show-bin-path"], { encoding: "utf8" }).trim();
const built = join(bin, "clipcat-recorder");
if (!existsSync(built)) throw new Error(`Build finished but clipcat-recorder wasn't found in ${bin}`);
mkdirSync(dirname(out), { recursive: true });
copyFileSync(built, out);
const version = execFileSync(out, ["--version"], { encoding: "utf8" }).trim();
console.log(`✓ built darwin-${arch}/clipcat-recorder: ${version}`);
