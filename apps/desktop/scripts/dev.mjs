// Development: starts the Vite dev server, then Electron pointed at it.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const DEV_URL = "http://localhost:5173/";

const vite = spawn("npm", ["run", "dev", "--workspace=@clipcat/ui"], {
  cwd: join(here, "..", "..", ".."),
  stdio: "inherit",
  shell: process.platform === "win32",
});

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(DEV_URL)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Vite didn't start at ${DEV_URL}`);
}

await waitForServer();
const electron = spawn(require("electron"), [join(here, "..")], {
  stdio: "inherit",
  env: { ...process.env, CLIPCAT_DEV_URL: DEV_URL },
});
electron.on("close", (code) => {
  vite.kill();
  process.exit(code ?? 0);
});
