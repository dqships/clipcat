/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Adapted from Diffusion Studio's editor (apps/desktop/forge.config.ts).

// Plain CommonJS so Forge loads it without a TypeScript loader.

const { MakerDMG } = require("@electron-forge/maker-dmg");
const { MakerSquirrel } = require("@electron-forge/maker-squirrel");
const { MakerZIP } = require("@electron-forge/maker-zip");
const { cpSync, existsSync, mkdirSync, rmSync } = require("node:fs");
const { join } = require("node:path");

const ICON = join(__dirname, "..", "..", "brand", "icon", "icon");
const STAGE = join(__dirname, ".stage");

const sign = windowsSign();

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
    osxSign: process.env.SKIP_SIGN ? undefined : {},
    osxNotarize:
      process.env.APPLE_ID && process.env.APPLE_PASSWORD && process.env.APPLE_TEAM_ID
        ? { appleId: process.env.APPLE_ID, appleIdPassword: process.env.APPLE_PASSWORD, teamId: process.env.APPLE_TEAM_ID }
        : undefined,
    windowsSign: sign,
  },
  makers: [
    new MakerZIP({}, ["darwin"]),
    new MakerDMG({ name: `ClipCat-${process.arch}`, icon: `${ICON}.icns` }),
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
  },
};

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
