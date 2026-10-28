// clipcat-recorder: records a display with ScreenCaptureKit.
//
//   clipcat-recorder --version
//   clipcat-recorder access              prints "granted" or "denied" (asks once)
//   clipcat-recorder displays            prints [{"id","width","height","main"}]
//   clipcat-recorder record --display <id> --out <file.mov> [--mic] [--mic-name <name>]
//                    [--system-audio] [--exclude-pid <pid>]
//
// While recording it prints "started" once the first frames are written, then
// reads stdin: a line "stop" (or the end of stdin) finishes the file, after
// which it prints "done" and exits 0. Errors go to stderr with a non-zero exit.

import AVFoundation
import CoreGraphics
import Foundation
import ScreenCaptureKit

setvbuf(stdout, nil, _IOLBF, 0)

let version = "clipcat-recorder 1 (ScreenCaptureKit)"

struct UsageError: Error, CustomStringConvertible {
    let description: String
}

func value(_ flag: String, in args: [String]) -> String? {
    guard let i = args.firstIndex(of: flag), i + 1 < args.count else { return nil }
    return args[i + 1]
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("clipcat-recorder: \(message)\n".utf8))
    exit(1)
}

struct DisplayInfo: Encodable {
    let id: UInt32
    let width: Int
    let height: Int
    let main: Bool
}

/// The display's size in pixels, which is what the recording should be on a Retina screen.
func pixelSize(_ display: SCDisplay) -> (Int, Int) {
    if let mode = CGDisplayCopyDisplayMode(display.displayID) {
        return (mode.pixelWidth, mode.pixelHeight)
    }
    return (display.width, display.height)
}

/// The microphone a browser-style label names ("MacBook Air Microphone (Built-in)"):
/// Chromium shows macOS's device name with a suffix, so the longest name the label starts with wins.
func microphoneID(named label: String) -> String? {
    let devices = AVCaptureDevice.DiscoverySession(deviceTypes: [.microphone, .external], mediaType: .audio, position: .unspecified).devices
    return devices
        .filter { label.hasPrefix($0.localizedName) }
        .max { $0.localizedName.count < $1.localizedName.count }?
        .uniqueID
}

func listDisplays() async throws {
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    let list = content.displays.map { d -> DisplayInfo in
        let (w, h) = pixelSize(d)
        return DisplayInfo(id: d.displayID, width: w, height: h, main: d.displayID == CGMainDisplayID())
    }
    let data = try JSONEncoder().encode(list)
    print(String(decoding: data, as: UTF8.self))
}

@available(macOS 15.0, *)
final class Recording: NSObject, SCStreamDelegate, SCRecordingOutputDelegate {
    private var stream: SCStream?
    private var finished: CheckedContinuation<Void, Error>?

    func start(display: SCDisplay, exclude: [SCRunningApplication], out: URL, mic: Bool, micDevice: String?, systemAudio: Bool) async throws {
        let filter = SCContentFilter(display: display, excludingApplications: exclude, exceptingWindows: [])
        let config = SCStreamConfiguration()
        var (w, h) = pixelSize(display)
        // 4K is plenty for a screen recording, and keeps the files and the editing light.
        let scale = min(1.0, 3840.0 / Double(max(w, h)))
        w = Int(Double(w) * scale) & ~1
        h = Int(Double(h) * scale) & ~1
        config.width = w
        config.height = h
        config.minimumFrameInterval = CMTime(value: 1, timescale: 30)
        config.showsCursor = true
        config.queueDepth = 6
        config.capturesAudio = systemAudio
        config.excludesCurrentProcessAudio = true
        config.captureMicrophone = mic
        if let micDevice { config.microphoneCaptureDeviceID = micDevice }

        let output = SCRecordingOutputConfiguration()
        output.outputURL = out
        output.outputFileType = .mov
        output.videoCodecType = .h264
        let recording = SCRecordingOutput(configuration: output, delegate: self)

        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        try stream.addRecordingOutput(recording)
        try await stream.startCapture()
        self.stream = stream
    }

    /// Stops capturing and waits for the movie file to be finished.
    func stop() async throws {
        guard let stream else { return }
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
            self.finished = c
            Task {
                do {
                    try await stream.stopCapture()
                } catch {
                    self.resume(error)
                }
            }
        }
    }

    /// Ends a stop() that is waiting. An error with nobody waiting means the recording broke mid-way: give up.
    private func resume(_ error: Error?) {
        guard let c = finished else {
            if error != nil { exit(1) }
            return
        }
        finished = nil
        if let error { c.resume(throwing: error) } else { c.resume() }
    }

    func recordingOutputDidStartRecording(_ recordingOutput: SCRecordingOutput) {
        print("started")
    }

    func recordingOutput(_ recordingOutput: SCRecordingOutput, didFailWithError error: Error) {
        FileHandle.standardError.write(Data("clipcat-recorder: \(error.localizedDescription)\n".utf8))
        resume(error)
    }

    func recordingOutputDidFinishRecording(_ recordingOutput: SCRecordingOutput) {
        resume(nil)
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        FileHandle.standardError.write(Data("clipcat-recorder: capture stopped: \(error.localizedDescription)\n".utf8))
        resume(error)
    }
}

/// Resolves once stdin says "stop" or closes (the app quit or cancelled).
func waitForStop() async {
    await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
        DispatchQueue.global().async {
            while let line = readLine() {
                if line.trimmingCharacters(in: .whitespaces) == "stop" { break }
            }
            c.resume()
        }
    }
}

func record(_ args: [String]) async throws {
    guard #available(macOS 15.0, *) else {
        throw UsageError(description: "recording needs macOS 15 or newer")
    }
    guard let out = value("--out", in: args) else { throw UsageError(description: "missing --out") }
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    let wanted = value("--display", in: args).flatMap(UInt32.init) ?? CGMainDisplayID()
    guard let display = content.displays.first(where: { $0.displayID == wanted }) ?? content.displays.first else {
        throw UsageError(description: "no display to record")
    }
    let excludePid = value("--exclude-pid", in: args).flatMap(Int32.init)
    let exclude = content.applications.filter { $0.processID == excludePid }
    let recording = Recording()
    try await recording.start(
        display: display, exclude: exclude, out: URL(fileURLWithPath: out),
        mic: args.contains("--mic"), micDevice: value("--mic-name", in: args).flatMap(microphoneID(named:)),
        systemAudio: args.contains("--system-audio"))
    await waitForStop()
    try await recording.stop()
    print("done")
}

let args = Array(CommandLine.arguments.dropFirst())
let command = args.first ?? "--help"

Task {
    do {
        switch command {
        case "--version":
            print(version)
        case "access":
            // Asks the first time; macOS shows its own prompt and remembers the answer.
            print(CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess() ? "granted" : "denied")
        case "displays":
            try await listDisplays()
        case "record":
            try await record(args)
        default:
            throw UsageError(description: "usage: clipcat-recorder --version | access | displays | record --display <id> --out <file>")
        }
        exit(0)
    } catch {
        fail("\(error)")
    }
}

RunLoop.main.run()
