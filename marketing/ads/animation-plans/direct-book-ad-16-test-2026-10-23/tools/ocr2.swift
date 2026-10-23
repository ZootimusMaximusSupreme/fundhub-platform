import Foundation
import Vision
import CoreGraphics
import ImageIO

// usage: ocr <dir> -> prints one JSON line per frame: {"i":N,"text":"...","words":[{"w":"..","x0":..,"x1":..}],"hl":[x0,x1]|null}
let dir = CommandLine.arguments[1]
let fm = FileManager.default
let files = try fm.contentsOfDirectory(atPath: dir).filter { $0.hasSuffix(".png") }.sorted()

func loadImage(_ path: String) -> CGImage? {
    let url = URL(fileURLWithPath: path) as CFURL
    guard let src = CGImageSourceCreateWithURL(url, nil) else { return nil }
    return CGImageSourceCreateImageAtIndex(src, 0, nil)
}

// find the blue highlight box: pixels with strong blue, low red
func highlight(_ img: CGImage) -> (Int, Int, Int, Int)? {
    let w = img.width, h = img.height
    var data = [UInt8](repeating: 0, count: w * h * 4)
    let cs = CGColorSpaceCreateDeviceRGB()
    guard let ctx = CGContext(data: &data, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
    var colCount = [Int](repeating: 0, count: w)
    var rowCount = [Int](repeating: 0, count: h)
    for y in 0..<h {
        for x in 0..<w {
            let o = (y * w + x) * 4
            let r = Int(data[o]), g = Int(data[o+1]), b = Int(data[o+2])
            if b > 170 && r < 90 && g < 150 && b - r > 110 { colCount[x] += 1; rowCount[y] += 1 }
        }
    }
    var xs: [Int] = []
    for x in 0..<w where colCount[x] > 18 { xs.append(x) }
    var ys: [Int] = []
    for y in 0..<h where rowCount[y] > 25 { ys.append(y) }
    if xs.count < 20 || ys.count < 10 { return nil }
    return (xs.first!, xs.last!, ys.first!, ys.last!)
}

for (n, f) in files.enumerated() {
    let path = dir + "/" + f
    guard let img = loadImage(path) else { continue }
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.usesLanguageCorrection = false
    let handler = VNImageRequestHandler(cgImage: img, options: [:])
    try? handler.perform([req])
    var text = ""
    var words: [[String: Any]] = []
    if let obs = req.results {
        for o in obs {
            guard let cand = o.topCandidates(1).first else { continue }
            let s = cand.string
            text += (text.isEmpty ? "" : " ") + s
            // per-word boxes
            var idx = s.startIndex
            while idx < s.endIndex {
                while idx < s.endIndex && s[idx] == " " { idx = s.index(after: idx) }
                if idx >= s.endIndex { break }
                var e = idx
                while e < s.endIndex && s[e] != " " { e = s.index(after: e) }
                let r = idx..<e
                if let box = try? cand.boundingBox(for: r) {
                    let b = box.boundingBox
                    words.append(["w": String(s[r]), "x0": Int(b.minX * CGFloat(img.width)), "x1": Int(b.maxX * CGFloat(img.width)), "y0": Int((1 - b.maxY) * CGFloat(img.height)), "y1": Int((1 - b.minY) * CGFloat(img.height))])
                }
                idx = e
            }
        }
    }
    var hl: Any = NSNull()
    if let h = highlight(img) { hl = [h.0, h.1, h.2, h.3] }
    let obj: [String: Any] = ["i": n + 1, "text": text, "words": words, "hl": hl]
    if let d = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: d, encoding: .utf8) { print(s) }
}
