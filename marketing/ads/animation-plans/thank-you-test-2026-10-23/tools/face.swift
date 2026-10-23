import Foundation
import Vision
import CoreGraphics
import ImageIO
let dir = CommandLine.arguments[1]
let files = try FileManager.default.contentsOfDirectory(atPath: dir).filter { $0.hasSuffix(".png") }.sorted()
for f in files {
    let url = URL(fileURLWithPath: dir + "/" + f) as CFURL
    guard let src = CGImageSourceCreateWithURL(url, nil), let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { continue }
    let req = VNDetectFaceRectanglesRequest()
    try? VNImageRequestHandler(cgImage: img, options: [:]).perform([req])
    let W = CGFloat(img.width), H = CGFloat(img.height)
    if let r = req.results?.first {
        let b = r.boundingBox
        print("\(f) \(Int(b.minX*W)) \(Int(b.maxX*W)) \(Int((1-b.maxY)*H)) \(Int((1-b.minY)*H))")
    } else { print("\(f) none") }
}
