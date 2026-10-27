// swift-tools-version: 6.0
// ClipCat's Parakeet helper: NVIDIA Parakeet TDT 0.6B v3 on the Neural Engine
// through FluidAudio, as a small command-line tool the app runs like whisper-cli.

import PackageDescription

let package = Package(
    name: "clipcat-parakeet",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/FluidInference/FluidAudio.git", exact: "0.15.6"),
    ],
    targets: [
        .executableTarget(
            name: "clipcat-parakeet",
            dependencies: [.product(name: "FluidAudio", package: "FluidAudio")]
        ),
    ],
    swiftLanguageModes: [.v5]
)
