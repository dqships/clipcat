// Downloads static ffmpeg and ffprobe builds into vendor/ffmpeg/<platform>-<arch>/,
// checking each against a pinned sha256 before it is unpacked.
//
//   npm run fetch:ffmpeg                    this machine's platform
//   npm run fetch:ffmpeg -- darwin-arm64 win32-x64
//
// Builds come from the ffmpeg-static project (ffmpeg 6.1.1, GPL, with libass
// and VideoToolbox on macOS). ClipCat is a personal tool, so the GPL build is
// fine (see the build plan). To move to another build, change RELEASE and the
// pins together.

import { createHash } from "node:crypto";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const RELEASE = "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1";

/** sha256 of each .gz asset in RELEASE. */
const PINS = {
  "darwin-arm64": {
    ffmpeg: "8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa",
    ffprobe: "d986a8ec7b030899fe66a8a288ed809a3543338705a3ce178cfb85869c5d80be",
  },
  "darwin-x64": {
    ffmpeg: "929b375c1182d956c51f7ac25e0b2b0411fb01f6f407aa15c9758efeb4242106",
    ffprobe: "d4da574d6e2e197bd259b47d69cf262df9e312af24ad960444f6d806d3d4c186",
  },
  "win32-x64": {
    ffmpeg: "8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77",
    ffprobe: "f309e6223ad89d2fe54bccd420a7709b66fd27540674e92309578ed491a43c8d",
  },
};

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const targets = process.argv.slice(2);
if (targets.length === 0) targets.push(`${process.platform}-${process.arch}`);

for (const target of targets) {
  const pins = PINS[target];
  if (!pins) throw new Error(`No ffmpeg build pinned for ${target}. Known: ${Object.keys(PINS).join(", ")}`);
  const dir = join(root, "vendor", "ffmpeg", target);
  await mkdir(dir, { recursive: true });

  for (const [name, sha] of Object.entries(pins)) {
    const file = join(dir, target.startsWith("win32") ? `${name}.exe` : name);
    if (existsSync(file)) {
      console.log(`✓ ${target}/${name} already present`);
      continue;
    }
    const url = `${RELEASE}/${name}-${target}.gz`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    const gz = Buffer.from(await response.arrayBuffer());
    const actual = createHash("sha256").update(gz).digest("hex");
    if (actual !== sha) throw new Error(`${url}: sha256 ${actual} does not match the pin ${sha}`);
    const temp = `${file}.part`;
    await writeFile(temp, gunzipSync(gz));
    await chmod(temp, 0o755);
    await rename(temp, file);
    console.log(`✓ ${target}/${name} (${(gz.length / 1e6).toFixed(1)} MB, sha256 ok)`);
  }
}
