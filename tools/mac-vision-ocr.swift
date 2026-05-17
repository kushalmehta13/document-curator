import Foundation
import Vision
import AppKit

struct OCRPage: Codable {
    let path: String
    let text: String
    let lines: [OCRLine]
    let error: String?
}

struct OCRLine: Codable {
    let text: String
    let confidence: Float
    let x: Double
    let y: Double
    let w: Double
    let h: Double
}

func loadCGImage(_ path: String) -> CGImage? {
    let url = URL(fileURLWithPath: path)
    guard let img = NSImage(contentsOf: url) else { return nil }
    var rect = NSRect(x: 0, y: 0, width: img.size.width, height: img.size.height)
    return img.cgImage(forProposedRect: &rect, context: nil, hints: nil)
}

func recognize(_ path: String, languages: [String]) -> OCRPage {
    guard let cg = loadCGImage(path) else {
        return OCRPage(path: path, text: "", lines: [], error: "cannot_load_image")
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    if !languages.isEmpty { request.recognitionLanguages = languages }
    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    do {
        try handler.perform([request])
    } catch {
        return OCRPage(path: path, text: "", lines: [], error: "vision_error: \(error.localizedDescription)")
    }
    let observations = request.results ?? []
    var allText: [String] = []
    var lines: [OCRLine] = []
    for obs in observations {
        guard let cand = obs.topCandidates(1).first else { continue }
        let s = cand.string
        if s.isEmpty { continue }
        allText.append(s)
        let bb = obs.boundingBox
        lines.append(OCRLine(
            text: s,
            confidence: cand.confidence,
            x: Double(bb.origin.x),
            y: Double(bb.origin.y),
            w: Double(bb.size.width),
            h: Double(bb.size.height)
        ))
    }
    return OCRPage(path: path, text: allText.joined(separator: "\n"), lines: lines, error: nil)
}

let args = CommandLine.arguments.dropFirst()
var paths: [String] = []
var languages: [String] = []
var i = args.startIndex
let argList = Array(args)
var idx = 0
while idx < argList.count {
    let a = argList[idx]
    if a == "--lang" || a == "-l" {
        idx += 1
        if idx < argList.count {
            languages = argList[idx].split(separator: ",").map { String($0) }
        }
    } else {
        paths.append(a)
    }
    idx += 1
}

if paths.isEmpty {
    let msg = "usage: mac-vision-ocr [--lang en-US,fr-FR] <image-path> [<image-path> ...]\n"
    FileHandle.standardError.write(msg.data(using: .utf8)!)
    exit(2)
}

var results: [OCRPage] = []
for p in paths { results.append(recognize(p, languages: languages)) }

let encoder = JSONEncoder()
encoder.outputFormatting = []
do {
    let data = try encoder.encode(results)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
} catch {
    FileHandle.standardError.write("encode_error\n".data(using: .utf8)!)
    exit(3)
}
