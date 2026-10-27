// Fails when app styles or components use a raw value instead of a design
// token (DESIGN.md: "Never hardcode a color, font size or spacing value").
// Scans apps/ui/src. Allowed raw values: 0, 1px hairlines, percentages, and
// unitless numbers inside calc(). Add a token to DESIGN.md and
// design/tokens.css instead of adding an exception here.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const scanned = [join(root, "apps", "ui", "src")];

const RULES = [
  { name: "hex color", re: /#[0-9a-fA-F]{3,8}\b/g },
  { name: "rgb/hsl color", re: /\b(?:rgba?|hsla?|oklch|oklab)\(/g },
  { name: "pixel value", re: /(?<![\w-])(?!1px\b)\d*\.?\d+px\b/g },
  { name: "rem/em size", re: /(?<![\w-])\d*\.?\d+r?em\b/g },
  { name: "duration", re: /(?<![\w-])\d*\.?\d+m?s\b(?![\w-])/g },
  { name: "cubic-bezier easing", re: /cubic-bezier\(/g },
];

const files = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(css|tsx?)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });

const problems = [];
for (const file of scanned.flatMap(files)) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    // Comments may talk about values; SVG geometry in viewBox/coordinates is unitless and not matched.
    const code = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
    for (const { name, re } of RULES) {
      for (const match of code.matchAll(re)) {
        problems.push(`${relative(root, file)}:${i + 1}  ${name} "${match[0]}"`);
      }
    }
  });
}

if (problems.length) {
  console.error(`Raw values found; use tokens from design/tokens.css:\n${problems.join("\n")}`);
  process.exit(1);
}
console.log(`tokens ok (${scanned.flatMap(files).length} files)`);
