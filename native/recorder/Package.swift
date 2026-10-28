// swift-tools-version: 6.0
// ClipCat's screen recorder: ScreenCaptureKit writing the screen, the
// microphone and (optionally) the computer's sound straight to a movie file,
// as a small command-line tool the app runs. macOS 15 or newer for recording;
// it builds for 14 so `--version` and `displays` work everywhere.

import PackageDescription

let package = Package(
    name: "clipcat-recorder",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(name: "clipcat-recorder"),
    ],
    swiftLanguageModes: [.v5]
)
