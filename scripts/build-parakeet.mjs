// Builds `clipcat-parakeet` (native/parakeet, a Swift helper that runs
// Parakeet TDT 0.6B v3 with FluidAudio) into vendor/bin/darwin-arm64/.
// Apple Silicon only, and needs Xcode 16 or its command line tools (Swift 6).
// FluidAudio is pinned in native/parakeet/Package.swift and links statically,
// so the binary stands alone inside the app. The model itself downloads on
// first use, into the app's models folder.
//
//   npm run build:parakeet

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = join(root, "native", "parakeet");
const out = join(root, "vendor", "bin", "darwin-arm64", "clipcat-parakeet");

if (process.platform !== "darwin" || process.arch !== "arm64") {
  console.log("Parakeet is for Apple Silicon Macs; skipping (whisper-cli transcribes here).");
  process.exit(0);
}
if (existsSync(out) && !process.argv.includes("--force")) {
  console.log("✓ darwin-arm64/clipcat-parakeet already built (use --force to rebuild)");
  process.exit(0);
}

const swift = ["build", "-c", "release", "--package-path", pkg, "--arch", "arm64"];
execFileSync("swift", swift, { stdio: "inherit" });
const bin = execFileSync("swift", [...swift, "--show-bin-path"], { encoding: "utf8" }).trim();
const built = join(bin, "clipcat-parakeet");
if (!existsSync(built)) throw new Error(`Build finished but clipcat-parakeet wasn't found in ${bin}`);
mkdirSync(dirname(out), { recursive: true });
copyFileSync(built, out);
const version = execFileSync(out, ["--version"], { encoding: "utf8" }).trim();
console.log(`✓ built darwin-arm64/clipcat-parakeet: ${version}`);
