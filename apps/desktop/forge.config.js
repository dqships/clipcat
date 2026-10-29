/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Adapted from Diffusion Studio's editor (apps/desktop/forge.config.ts).

// Plain CommonJS so Forge loads it without a TypeScript loader.

const { MakerDMG } = require("@electron-forge/maker-dmg");
const { MakerSquirrel } = require("@electron-forge/maker-squirrel");
const { MakerZIP } = require("@electron-forge/maker-zip");
const { FusesPlugin } = require("@electron-forge/plugin-fuses");
const { FuseV1Options, FuseVersion } = require("@electron/fuses");
const { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { basename, dirname, join } = require("node:path");

const ICON = join(__dirname, "..", "..", "brand", "icon", "icon");
const STAGE = join(__dirname, ".stage");

const sign = windowsSign();

/** Where released builds update from (see src/update.ts); the Mac zip's RELEASES.json points into it. */
const UPDATE_FEED = process.env.CLIPCAT_UPDATE_FEED || require("./package.json").clipcat?.updateFeed || undefined;

/** @type {import("@electron-forge/shared-types").ForgeConfig} */
const config = {
  packagerConfig: {
    name: "ClipCat",
    executableName: "ClipCat",
    appBundleId: "com.dqships.clipcat",
    appCategoryType: "public.app-category.video",
    icon: ICON,
    win32metadata: { CompanyName: "ClipCat", ProductName: "ClipCat", FileDescription: "ClipCat" },
    prune: true,
    // Only the bundled main/preload and the built UI ship; sources stay out.
    ignore: (/** @type {string} */ path) =>
      path !== "" &&
      path !== "/package.json" &&
      path !== "/dist" &&
      !path.startsWith("/dist/") &&
      path !== "/ui" &&
      !path.startsWith("/ui/"),
    // bin and models are staged by the prePackage hook; all end up in Resources (bin/, models/, fonts/, sfx/).
    extraResource: [join(STAGE, "bin"), join(STAGE, "models"), join(__dirname, "resources", "fonts"), join(__dirname, "resources", "sfx")],
    // macOS asks before the camera or microphone is used and shows these reasons.
    extendInfo: {
      NSCameraUsageDescription: "ClipCat records takes from your camera when you choose Camera in Record.",
      NSMicrophoneUsageDescription: "ClipCat records your voice with every take, and transcribes it.",
    },
    // Hardened runtime with @electron/osx-sign's default entitlements, which already allow the camera
    // and microphone (the bundled helpers in Resources/bin get the same). APPLE_SIGN_IDENTITY picks the
    // certificate when the keychain holds more than one Developer ID.
    // continueOnError: false, because packager otherwise hides a failed signing behind a warning and
    // the build only fails minutes later, when Apple's notary rejects every binary as unsigned.
    osxSign: process.env.SKIP_SIGN
      ? undefined
      : { continueOnError: false, ...(process.env.APPLE_SIGN_IDENTITY ? { identity: process.env.APPLE_SIGN_IDENTITY } : {}) },
    // Notarizing happens in the postPackage hook below, not here: packager gives up stapling after
    // about 7 seconds, and Apple's ticket server often throttles or drops the first tries.
    windowsSign: sign,
  },
  makers: [
    new MakerZIP(UPDATE_FEED ? { macUpdateManifestBaseUrl: UPDATE_FEED } : {}, ["darwin"]),
    new MakerDMG(dmgConfig()),
    new MakerSquirrel({
      name: "ClipCat",
      authors: "ClipCat",
      description: "Personal AI video editor for talking-head videos",
      exe: "ClipCat.exe",
      setupExe: `ClipCat-${process.arch}-Setup.exe`,
      setupIcon: `${ICON}.ico`,
      noMsi: true,
      windowsSign: sign,
    }),
  ],
  plugins: [
    new FusesPlugin({
      version: FuseVersion.V1,
      // Fuses are flipped in the binary, which breaks its ad-hoc signature; Apple Silicon refuses to run it unsigned.
      resetAdHocDarwinSignature: process.platform === "darwin" && process.arch === "arm64",
      // On: the MCP bridge (dist/mcp.cjs) is run by ClipCat's own executable as Node.
      [FuseV1Options.RunAsNode]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    }),
  ],
  hooks: {
    // Copies this platform's ffmpeg, ffprobe, whisper-cli, (Apple Silicon) clipcat-parakeet, (macOS) clipcat-recorder
    // and the cutout model from vendor/ into the stage folder, so packaging fails loudly instead of
    // shipping without them.
    prePackage: async (/** @type {unknown} */ _config, /** @type {string} */ platform, /** @type {string} */ arch) => {
      const from = join(__dirname, "..", "..", "vendor", "bin", `${platform}-${arch}`);
      const exe = platform === "win32" ? ".exe" : "";
      const parakeet = platform === "darwin" && arch === "arm64" ? ["clipcat-parakeet"] : [];
      const recorder = platform === "darwin" ? ["clipcat-recorder"] : [];
      for (const tool of ["ffmpeg", "ffprobe", "whisper-cli", ...parakeet, ...recorder]) {
        if (!existsSync(join(from, tool + exe))) {
          const build = (parakeet.length ? " && npm run build:parakeet" : "") + (recorder.length ? " && npm run build:recorder" : "");
          throw new Error(`No ${tool} for ${platform}-${arch} in vendor/bin. Run: npm run fetch:ffmpeg && npm run build:whisper${build}`);
        }
      }
      rmSync(join(STAGE, "bin"), { recursive: true, force: true });
      mkdirSync(STAGE, { recursive: true });
      cpSync(from, join(STAGE, "bin"), { recursive: true });

      const model = join(__dirname, "..", "..", "vendor", "models", "isnet-small.onnx");
      if (!existsSync(model)) throw new Error("No cutout model in vendor/models. Run: npm run fetch:cutout");
      rmSync(join(STAGE, "models"), { recursive: true, force: true });
      mkdirSync(join(STAGE, "models"), { recursive: true });
      cpSync(model, join(STAGE, "models", "isnet-small.onnx"));
    },
    // Only a signed app can be notarized, so an unsigned build (SKIP_SIGN, every pull request) skips it.
    // This runs before the makers, so the DMG and zip carry the stapled app.
    postPackage: async (/** @type {unknown} */ _config, /** @type {{ platform: string, outputPaths: string[] }} */ result) => {
      const { SKIP_SIGN, APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID } = process.env;
      if (result.platform !== "darwin" || SKIP_SIGN || !APPLE_ID || !APPLE_PASSWORD || !APPLE_TEAM_ID) return;
      for (const out of result.outputPaths) await notarize(join(out, "ClipCat.app"), { APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID });
    },
    // Both Mac builds publish to the same feed, so the Intel one's manifest is RELEASES-x64.json
    // (src/update.ts reads it there). The zip maker starts each manifest from the feed's
    // RELEASES.json, which is Apple Silicon's, so only this build's own zips are kept.
    postMake: async (/** @type {unknown} */ _config, /** @type {{ platform: string, arch: string, artifacts: string[] }[]} */ results) => {
      for (const result of results) {
        if (result.platform !== "darwin" || result.arch === "arm64") continue;
        result.artifacts = result.artifacts.map((file) => {
          if (basename(file) !== "RELEASES.json") return file;
          const manifest = JSON.parse(readFileSync(file, "utf8"));
          manifest.releases = (manifest.releases ?? []).filter((/** @type {{ updateTo?: { url?: string } }} */ r) =>
            r.updateTo?.url?.includes(`-darwin-${result.arch}-`),
          );
          const renamed = join(dirname(file), `RELEASES-${result.arch}.json`);
          writeFileSync(renamed, JSON.stringify(manifest));
          rmSync(file);
          return renamed;
        });
      }
      return results;
    },
  },
};

/**
 * The Mac installer window: electron-installer-dmg's stock background (white, black arrow) with
 * ClipCat and Applications at its stock spots. The volume's own files are hidden, but Finder still
 * shows them when hidden files are on, so they sit below the 658 x 498 window, out of view.
 * scripts/check-dmg.mjs checks the built image against this.
 */
function dmgConfig() {
  const hidden = [".background", ".VolumeIcon.icns", ".DS_Store", ".fseventsd", ".Trashes"];
  return {
    name: `ClipCat-${process.arch}`,
    icon: `${ICON}.icns`,
    contents: (/** @type {{ appPath: string }} */ opts) => [
      { type: "file", path: opts.appPath, x: 192, y: 344 },
      { type: "link", path: "/Applications", x: 448, y: 344 },
      ...hidden.map((name, i) => ({ type: "position", path: name, x: 110 * (i + 1), y: 700 })),
    ],
  };
}

/**
 * Sends the app to Apple's notary service, then staples the ticket to it. Apple's ticket server can
 * lag behind the notary service and answers THROTTLED with a retryAfter, so stapling keeps trying
 * for about seven minutes before the build fails.
 * @param {string} app
 * @param {{ APPLE_ID: string, APPLE_PASSWORD: string, APPLE_TEAM_ID: string }} auth
 */
async function notarize(app, auth) {
  const { execFileSync, spawnSync } = require("node:child_process");
  const { mkdtempSync } = require("node:fs");
  const { tmpdir } = require("node:os");
  const dir = mkdtempSync(join(tmpdir(), "clipcat-notarize-"));
  try {
    const zip = join(dir, "ClipCat.zip");
    execFileSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", basename(app), zip], { cwd: dirname(app) });
    const login = ["--apple-id", auth.APPLE_ID, "--password", auth.APPLE_PASSWORD, "--team-id", auth.APPLE_TEAM_ID];
    const submit = spawnSync("xcrun", ["notarytool", "submit", zip, ...login, "--wait", "--output-format", "json"], { encoding: "utf8" });
    /** @type {{ id?: string, status?: string }} */
    let status = {};
    try {
      status = JSON.parse(submit.stdout);
    } catch {}
    if (submit.status !== 0 || status.status !== "Accepted") {
      const log = status.id ? spawnSync("xcrun", ["notarytool", "log", status.id, ...login], { encoding: "utf8" }).stdout : "";
      throw new Error(`Notarizing ${app} failed (${status.status ?? "no status"}):\n${submit.stdout}${submit.stderr}\n${log}`);
    }
    console.log(`Notarized ${app} (${status.id}).`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // A staple can report success while validate still finds no ticket (exit 68), so both are retried together.
  for (let attempt = 1; ; attempt++) {
    const run = (/** @type {string} */ step) => spawnSync("xcrun", ["stapler", step, basename(app)], { cwd: dirname(app), encoding: "utf8" });
    const staple = run("staple");
    const result = staple.status === 0 ? run("validate") : staple;
    if (result.status === 0) break;
    const step = result === staple ? "Stapling" : "Validating the staple on";
    if (attempt === 10) throw new Error(`${step} ${app} failed after ${attempt} tries:\n${result.stdout}${result.stderr}`);
    const wait = Math.min(15 * attempt, 60);
    console.log(`${step} ${app} failed (exit ${result.status}), trying again in ${wait}s.`);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
  }
}

function windowsSign() {
  if (process.platform !== "win32" || process.env.SKIP_SIGN) return undefined;
  const { WINDOWS_SIGNTOOL_PATH: signToolPath, WINDOWS_SIGN_DLIB: dlib, WINDOWS_SIGN_METADATA: metadata } = process.env;
  if (!signToolPath || !dlib || !metadata) return undefined;
  return {
    signToolPath,
    automaticallySelectCertificate: false,
    signWithParams: ["/dlib", dlib, "/dmdf", metadata],
    timestampServer: "http://timestamp.acs.microsoft.com",
    hashes: ["sha256"],
  };
}

module.exports = config;
