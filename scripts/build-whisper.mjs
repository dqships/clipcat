// Builds whisper.cpp's `whisper-cli` from a pinned commit into
// vendor/bin/<platform>-<arch>/. Needs git, cmake and a C++ compiler
// (Xcode command line tools on macOS, Visual Studio Build Tools on Windows).
// Statically linked; on Apple Silicon the Metal shaders are embedded, so the
// binary stands alone inside the app. Intel Macs run it on the CPU (AVX2 and
// Accelerate): ggml's Metal kernels are written for Apple GPUs.
//
//   npm run build:whisper

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TAG = "v1.9.4"; // also WHISPER_RELEASE in apps/desktop/src/tools.ts
// The commit the v1.9.4 tag points at (not the annotated tag object, 7d75b14…).
const COMMIT = "927cfce34f31707e17f2bff35c349632fb9e2c3a";
const REPO = "https://github.com/ggml-org/whisper.cpp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = `${process.platform}-${process.arch}`;
const exe = process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli";
const out = join(root, "vendor", "bin", target, exe);
const src = join(root, "vendor", "src", `whisper.cpp-${TAG}`);

if (existsSync(out) && !process.argv.includes("--force")) {
  console.log(`✓ ${target}/${exe} already built (use --force to rebuild)`);
  process.exit(0);
}

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit" });

if (!existsSync(join(src, "CMakeLists.txt"))) {
  rmSync(src, { recursive: true, force: true });
  mkdirSync(src, { recursive: true });
  run("git", ["init", "-q"], src);
  run("git", ["fetch", "-q", "--depth", "1", REPO, COMMIT], src);
  run("git", ["checkout", "-q", "FETCH_HEAD"], src);
}
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: src, encoding: "utf8" }).trim();
if (head !== COMMIT) throw new Error(`whisper.cpp checkout is at ${head}, expected ${COMMIT}`);

const build = join(src, "build");
run(
  "cmake",
  [
    "-S", src,
    "-B", build,
    "-DCMAKE_BUILD_TYPE=Release",
    "-DBUILD_SHARED_LIBS=OFF",
    "-DWHISPER_BUILD_TESTS=OFF",
    "-DWHISPER_BUILD_SERVER=OFF",
    // Portable CPU code: the app runs on machines other than the build machine.
    "-DGGML_NATIVE=OFF",
    // ggml's own thread pool instead of OpenMP, which would need vcomp140.dll / libomp beside the binary.
    "-DGGML_OPENMP=OFF",
    ...(process.platform === "darwin" ? ["-DCMAKE_OSX_DEPLOYMENT_TARGET=14.0"] : []),
    ...(target === "darwin-arm64" ? ["-DGGML_METAL=ON", "-DGGML_METAL_EMBED_LIBRARY=ON"] : []),
    ...(target === "darwin-x64" ? ["-DGGML_METAL=OFF"] : []),
    ...(process.platform === "win32" ? ["-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded"] : []),
  ],
  root,
);
run("cmake", ["--build", build, "--config", "Release", "--target", "whisper-cli", "-j"], root);

const built = [join(build, "bin", exe), join(build, "bin", "Release", exe)].find(existsSync);
if (!built) throw new Error(`Build finished but ${exe} wasn't found under ${build}/bin`);
mkdirSync(dirname(out), { recursive: true });
copyFileSync(built, out);
console.log(`✓ built ${target}/${exe} from whisper.cpp ${TAG}`);
