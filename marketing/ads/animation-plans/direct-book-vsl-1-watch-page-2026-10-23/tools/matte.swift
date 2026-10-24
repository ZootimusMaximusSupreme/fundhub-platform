import Foundation
import AVFoundation
import Vision
import CoreImage
import CoreVideo

// usage: matte <video> <out_dir> "start,end;start,end"
// Writes one 8-bit gray PNG per frame (person = white) for frames inside the ranges, named m_%05d.png (frame index at 30 fps).
let a = CommandLine.arguments
let url = URL(fileURLWithPath: a[1])
let outDir = a[2]
let ranges: [(Double, Double)] = a[3].split(separator: ";").map { r in
    let p = r.split(separator: ",").map { Double($0)! }
    return (p[0], p[1])
}
try FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)
let asset = AVAsset(url: url)
let track = asset.tracks(withMediaType: .video)[0]
let reader = try AVAssetReader(asset: asset)
let out = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
reader.add(out)
reader.startReading()
let W = Int(track.naturalSize.width), H = Int(track.naturalSize.height)
let ci = CIContext()
let gray = CGColorSpaceCreateDeviceGray()
let seq = VNSequenceRequestHandler()
var done = 0
while let sb = out.copyNextSampleBuffer() {
    let t = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sb))
    let idx = Int((t * 30).rounded())
    guard ranges.contains(where: { t >= $0.0 - 0.05 && t <= $0.1 + 0.05 }) else { continue }
    guard let pb = CMSampleBufferGetImageBuffer(sb) else { continue }
    let req = VNGeneratePersonSegmentationRequest()
    req.qualityLevel = .accurate
    req.outputPixelFormat = kCVPixelFormatType_OneComponent8
    try seq.perform([req], on: pb)
    guard let mask = req.results?.first?.pixelBuffer else { continue }
    var img = CIImage(cvPixelBuffer: mask)
    img = img.transformed(by: CGAffineTransform(scaleX: CGFloat(W) / img.extent.width, y: CGFloat(H) / img.extent.height))
    let dest = URL(fileURLWithPath: String(format: "%@/m_%05d.png", outDir, idx))
    try ci.writePNGRepresentation(of: img, to: dest, format: .L8, colorSpace: gray)
    done += 1
}
print("masks written: \(done)")
