// Mounts a built Mac DMG and checks what its window shows: only ClipCat and the Applications link,
// inside the window, with the volume's hidden files (.background, .VolumeIcon.icns, ...) placed below
// it so they stay out of view even when Finder shows hidden files.
// Usage (macOS): node scripts/check-dmg.mjs apps/desktop/out/make/ClipCat-arm64.dmg

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dmg = process.argv[2];
if (!dmg || !existsSync(dmg)) throw new Error(`No DMG at ${dmg}`);

const mount = mkdtempSync(join(tmpdir(), "clipcat-dmg-"));
execFileSync("hdiutil", ["attach", "-nobrowse", "-readonly", "-noautoopen", "-mountpoint", mount, dmg], { stdio: "inherit" });
const problems = [];
try {
  const entries = readdirSync(mount).sort();
  console.log("Volume holds:", entries.join(", "));

  const shown = entries.filter((name) => !name.startsWith("."));
  if (shown.join(",") !== "Applications,ClipCat.app") problems.push(`visible items are ${shown.join(", ")}, not Applications and ClipCat.app`);
  const link = join(mount, "Applications");
  if (!lstatSync(link).isSymbolicLink() || readlinkSync(link) !== "/Applications") problems.push("Applications is not a link to /Applications");

  const store = readFileSync(join(mount, ".DS_Store"));
  // The window's bounds live in the bwsp property list as "{{x, y}, {width, height}}".
  const bounds = store.toString("latin1").match(/\{\{-?\d+, -?\d+\}, \{(\d+), (\d+)\}\}/);
  if (!bounds) throw new Error("No window bounds in .DS_Store");
  const [width, height] = [Number(bounds[1]), Number(bounds[2])];
  console.log(`Window: ${width} x ${height}`);

  // An icon's spot is an Iloc record: name length, UTF-16 name, "Iloc", "blob", 16, then x and y.
  const iloc = (name) => {
    const utf16 = Buffer.from(name, "utf16le").swap16();
    const head = Buffer.alloc(4);
    head.writeUInt32BE(name.length);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(16);
    const at = store.indexOf(Buffer.concat([head, utf16, Buffer.from("Ilocblob", "latin1"), tail]));
    if (at < 0) return undefined;
    const pos = at + 4 + utf16.length + 12;
    return { x: store.readUInt32BE(pos), y: store.readUInt32BE(pos + 4) };
  };

  for (const name of entries) {
    const spot = iloc(name);
    console.log(`  ${name}: ${spot ? `${spot.x}, ${spot.y}` : "no position"}`);
    // Finder never shows .DS_Store itself.
    if (name === ".DS_Store") continue;
    const inside = spot && spot.x >= 0 && spot.x <= width && spot.y >= 0 && spot.y <= height;
    if (name.startsWith(".") && (!spot || inside)) problems.push(`${name} would show in the window`);
    if (!name.startsWith(".") && !inside) problems.push(`${name} is not placed inside the window`);
  }

  if (!readdirSync(join(mount, ".background")).some((f) => /\.(png|tiff)$/.test(f))) problems.push("no background image");
} finally {
  execFileSync("hdiutil", ["detach", mount], { stdio: "inherit" });
  rmSync(mount, { recursive: true, force: true });
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("The DMG window shows ClipCat and Applications only.");
