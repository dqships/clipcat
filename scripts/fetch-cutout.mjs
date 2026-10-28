// Fetches the subject cutout model into vendor/models/isnet-small.onnx: the
// quantized ISNet that IMG.LY ships inside @imgly/background-removal-node
// (AGPL-3.0, fine for a personal tool). The package comes from the npm
// registry, pinned by its integrity hash; the model is put back together from
// the package's chunks and checked against its own sha256.
//
//   npm run fetch:cutout

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const PACKAGE = "https://registry.npmjs.org/@imgly/background-removal-node/-/background-removal-node-1.4.5.tgz";
const INTEGRITY = "sha512-/s9K88qhKy1jPhrSkBxurUqCVqJ8KHWCc+5yWdppdC4fuSrGC8mK8WQtmULs2ASEr8naY1qpvZu0EL5jr2Hqtg==";
const MODEL = "/models/small";
const MODEL_SHA256 = "7001d60734fdc112dd9c062635fb59cd401fb82a9d4213134bce4dbd655c803a";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "vendor", "models", "isnet-small.onnx");

if (existsSync(out) && !process.argv.includes("--force")) {
  console.log("✓ models/isnet-small.onnx already present (use --force to fetch again)");
  process.exit(0);
}

/** The files in a tar archive, by name. */
function untar(tar) {
  const files = new Map();
  for (let at = 0; at + 512 <= tar.length; ) {
    const header = tar.subarray(at, at + 512);
    if (header.every((b) => b === 0)) break;
    const field = (from, length) => header.subarray(from, from + length).toString("utf8").replace(/\0.*$/s, "");
    const name = (field(345, 155) ? `${field(345, 155)}/` : "") + field(0, 100);
    const size = Number.parseInt(field(124, 12).trim() || "0", 8);
    files.set(name, tar.subarray(at + 512, at + 512 + size));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

console.log(`Fetching ${PACKAGE}`);
const response = await fetch(PACKAGE);
if (!response.ok) throw new Error(`${PACKAGE}: ${response.status} ${response.statusText}`);
const tgz = Buffer.from(await response.arrayBuffer());
const [algorithm, expected] = INTEGRITY.split("-");
const actual = createHash(algorithm).update(tgz).digest("base64");
if (actual !== expected) throw new Error(`The package's ${algorithm} is ${actual}, expected ${expected}`);

const files = untar(gunzipSync(tgz));
const resources = JSON.parse(files.get("package/dist/resources.json").toString("utf8"));
const chunks = resources[MODEL]?.chunks;
if (!chunks) throw new Error(`The package has no ${MODEL}`);
const model = Buffer.concat(
  chunks.map(({ hash }) => {
    const chunk = files.get(`package/dist/${hash}`);
    if (!chunk) throw new Error(`The package is missing a chunk of ${MODEL}: ${hash}`);
    return chunk;
  }),
);
const sha = createHash("sha256").update(model).digest("hex");
if (sha !== MODEL_SHA256) throw new Error(`The model's sha256 is ${sha}, expected ${MODEL_SHA256}`);

await mkdir(dirname(out), { recursive: true });
await writeFile(`${out}.partial`, model);
await rename(`${out}.partial`, out);
console.log(`✓ models/isnet-small.onnx (${(model.length / 1e6).toFixed(1)} MB)`);
