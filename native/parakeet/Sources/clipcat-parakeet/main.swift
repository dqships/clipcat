// clipcat-parakeet: speech to word timings with Parakeet TDT 0.6B v3.
//
//   clipcat-parakeet --version
//   clipcat-parakeet download --models <dir>
//   clipcat-parakeet transcribe --models <dir> --input <16 kHz wav> --output <json>
//
// Progress goes to stdout, one "phase=<name> progress=<0..1>" line at a time.
// The output is {"model", "text", "words": [{"text", "start", "end"}]}, times
// in seconds. Errors go to stderr with a non-zero exit.

import CoreML
import FluidAudio
import Foundation

setvbuf(stdout, nil, _IOLBF, 0)

let version = "clipcat-parakeet 1 (FluidAudio 0.15.6, Parakeet TDT 0.6B v3)"
let modelName = "parakeet-tdt-0.6b-v3"

struct Word: Encodable {
    let text: String
    let start: Double
    let end: Double
}

struct Output: Encodable {
    let model: String
    let text: String
    let words: [Word]
}

struct UsageError: Error, CustomStringConvertible {
    let description: String
}

func value(_ flag: String, in args: [String]) throws -> String {
    guard let i = args.firstIndex(of: flag), i + 1 < args.count else {
        throw UsageError(description: "missing \(flag)")
    }
    return args[i + 1]
}

func report(_ phase: String, _ fraction: Double) {
    print("phase=\(phase) progress=\(String(format: "%.4f", min(1, max(0, fraction))))")
}

/// Downloads the models into `dir` once (later runs find them there) and loads them,
/// on the Neural Engine by default or on the CPU alone with `cpuOnly`.
/// FluidAudio keeps each model in a folder named after its Hugging Face repo.
func loadModels(_ dir: URL, cpuOnly: Bool = false) async throws -> AsrModels {
    let repo = dir.appendingPathComponent("parakeet-tdt-0.6b-v3-coreml", isDirectory: true)
    var configuration: MLModelConfiguration? = nil
    if cpuOnly {
        let cpu = MLModelConfiguration()
        cpu.computeUnits = .cpuOnly
        configuration = cpu
    }
    return try await AsrModels.downloadAndLoad(
        to: repo, configuration: configuration, version: .v3,
        encoderComputeUnits: cpuOnly ? .cpuOnly : nil,
        progressHandler: { progress in
            switch progress.phase {
            case .compiling: report("compiling", progress.fractionCompleted)
            default: report("downloading", progress.fractionCompleted)
            }
        })
}

func transcribe(models dir: URL, input: URL, output: URL) async throws {
    do {
        try await transcribe(models: dir, input: input, output: output, cpuOnly: false)
    } catch {
        // Machines without a usable Neural Engine (virtual Macs among them) fail the
        // first prediction; the CPU is slower but always there.
        FileHandle.standardError.write(Data("clipcat-parakeet: retrying on the CPU: \(error.localizedDescription)\n".utf8))
        try await transcribe(models: dir, input: input, output: output, cpuOnly: true)
    }
}

func transcribe(models dir: URL, input: URL, output: URL, cpuOnly: Bool) async throws {
    let models = try await loadModels(dir, cpuOnly: cpuOnly)
    // v3 long-form audio drifts with the mel-context seams; silence-aligned chunks avoid it.
    let asr = AsrManager(config: ASRConfig(melChunkContext: false))
    try await asr.loadModels(models)
    let progress = Task {
        do {
            for try await fraction in await asr.transcriptionProgressStream {
                report("transcribing", fraction)
            }
        } catch {}
    }
    var state = TdtDecoderState.make(decoderLayers: await asr.decoderLayerCount)
    let result = try await asr.transcribe(input, decoderState: &state)
    progress.cancel()
    report("transcribing", 1)

    let words = buildWordTimings(from: result.tokenTimings ?? []).map {
        Word(text: $0.word, start: $0.startTime, end: max($0.startTime, $0.endTime))
    }
    let data = try JSONEncoder().encode(Output(model: modelName, text: result.text, words: words))
    try data.write(to: output, options: .atomic)
}

let args = Array(CommandLine.arguments.dropFirst())
do {
    switch args.first {
    case "--version":
        print(version)
    case "download":
        let dir = URL(fileURLWithPath: try value("--models", in: args), isDirectory: true)
        _ = try await loadModels(dir)
        report("ready", 1)
    case "transcribe":
        try await transcribe(
            models: URL(fileURLWithPath: try value("--models", in: args), isDirectory: true),
            input: URL(fileURLWithPath: try value("--input", in: args)),
            output: URL(fileURLWithPath: try value("--output", in: args))
        )
    default:
        throw UsageError(description: "usage: clipcat-parakeet --version | download --models <dir> | transcribe --models <dir> --input <wav> --output <json>")
    }
} catch {
    FileHandle.standardError.write(Data("clipcat-parakeet: \(error.localizedDescription) (\(error))\n".utf8))
    exit(1)
}
