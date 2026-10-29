// Copies the built UI (apps/ui/dist) next to the main bundle, where the app://
// protocol serves it from and where packaging picks it up.
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, "..", "..", "ui", "dist");
const to = join(here, "..", "ui");
if (!["index.html", "help.html"].every((page) => existsSync(join(from, page)))) throw new Error(`No built UI at ${from}; run the ui build first.`);
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log(`staged UI → ${to}`);
