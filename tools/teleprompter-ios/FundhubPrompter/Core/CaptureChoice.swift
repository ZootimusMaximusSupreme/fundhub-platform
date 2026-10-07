import Foundation

/// The camera choices, kept apart from AVFoundation so they can be tested on
/// any Mac. CameraController turns each AVCaptureDevice.Format into a
/// FormatInfo, asks pick(), and uses the one it names.
enum CaptureChoice {

    struct FormatInfo: Equatable {
        var index: Int
        var width: Int
        var height: Int
        var maxFPS: Double
        /// Supports the stabilization mode we want.
        var stabilization: Bool
        /// Full-range 4:2:0 ('420f') vs video-range ('420v'). Video range is what
        /// the camera app records and what video players expect.
        var videoRange: Bool
        var hdr: Bool
    }

    struct Pick: Equatable {
        var index: Int
        var width: Int
        var height: Int
        var fps: Int
        /// Plain words when the camera could not give what Chris picked
        /// ("This camera tops out at 1080p."). nil when it matches.
        var shortfall: String?
    }

    /// Front-camera filming rate. Apple's iPhone 17 Pro Max front camera films
    /// normal video at 60 fps (4K and 1080p). 120 fps is slow motion, not this mode.
    /// https://support.apple.com/en-us/125091
    static let filmingFPS = 60

    /// The chosen size (3840×2160 or 1920×1080) at 60 fps. Never a smaller
    /// picture under the bigger name, and never the slow-motion rate.
    static func pickHighest(_ formats: [FormatInfo], width: Int, height: Int, wantStabilization: Bool) -> Pick? {
        pick(formats, width: width, height: height, fps: filmingFPS, wantStabilization: wantStabilization)
    }

    /// Front camera: 1920×1080, 60 fps, then 30. Never a 4K format.
    /// A 30 fps 1080p picture is the planned fallback, not an error.
    static func pickFront1080(_ formats: [FormatInfo], wantStabilization: Bool) -> Pick? {
        guard let p = pick(formats, width: 1920, height: 1080, fps: filmingFPS, wantStabilization: wantStabilization) else { return nil }
        if p.width == 1920 && p.height == 1080 {
            return Pick(index: p.index, width: p.width, height: p.height, fps: p.fps, shortfall: nil)
        }
        return p
    }

    /// Back camera (the phone that sits and films him): best steady 1080p.
    /// Steady means a normal rate (not slow motion) that can hold still,
    /// then the higher of 60 or 30. Never 4K. This app has no proven 4K back recording.
    static func pickStable1080(_ formats: [FormatInfo], wantStabilization: Bool) -> Pick? {
        let hd = formats.filter { $0.width == 1920 && $0.height == 1080 }
        if hd.isEmpty {
            return pick(formats, width: 1920, height: 1080, fps: 30, wantStabilization: wantStabilization)
        }
        let normal = hd.filter { $0.maxFPS <= 60.5 }
        let pool = normal.isEmpty ? hd : normal
        func score(_ f: FormatInfo) -> [Int] {
            let stab = (f.stabilization || !wantStabilization) ? 1 : 0
            let fps = Int(min(60.0, f.maxFPS).rounded(.down))
            return [stab, fps, f.hdr ? 1 : 0, f.videoRange ? 1 : 0, -f.index]
        }
        guard let f = pool.max(by: { score($0).lexicographicallyPrecedes(score($1)) }) else { return nil }
        let run = f.maxFPS + 0.01 >= 60 ? 60 : max(1, Int(f.maxFPS.rounded(.down)))
        return Pick(index: f.index, width: f.width, height: f.height, fps: run, shortfall: nil)
    }

    /// Which lens. "back" is the sitting phone. Anything else is the front camera.
    static func pickForLens(_ formats: [FormatInfo], lens: String, wantStabilization: Bool) -> Pick? {
        if lens == "back" || lens == "environment" {
            return pickStable1080(formats, wantStabilization: wantStabilization)
        }
        return pickFront1080(formats, wantStabilization: wantStabilization)
    }

    /// The best format for the quality and frame rate Chris picked.
    /// Order: a normal-speed format (not slow motion); then stabilization;
    /// then Dolby Vision (HDR) when the camera has it; then video range;
    /// then the lowest index (Apple lists the plainest format first).
    static func pick(_ formats: [FormatInfo], width: Int, height: Int, fps: Int, wantStabilization: Bool) -> Pick? {
        guard !formats.isEmpty else { return nil }
        let asked = min(fps, filmingFPS)
        func score(_ f: FormatInfo) -> [Int] {
            let normalSpeed = f.maxFPS <= Double(asked) + 0.5 ? 1 : 0
            return [normalSpeed, f.stabilization || !wantStabilization ? 1 : 0, f.hdr ? 1 : 0, f.videoRange ? 1 : 0, -f.index]
        }
        func best(_ list: [FormatInfo]) -> FormatInfo? {
            list.max { score($0).lexicographicallyPrecedes(score($1)) }
        }
        let exact = formats.filter { $0.width == width && $0.height == height && $0.maxFPS + 0.01 >= Double(asked) }
        if let f = best(exact) {
            return Pick(index: f.index, width: f.width, height: f.height, fps: asked, shortfall: nil)
        }
        // Right size, slower frame rate.
        let sameSize = formats.filter { $0.width == width && $0.height == height }
        if let top = sameSize.map({ $0.maxFPS }).max(), let f = best(sameSize.filter { $0.maxFPS == top }) {
            let got = Int(top.rounded(.down))
            return Pick(index: f.index, width: f.width, height: f.height, fps: got,
                        shortfall: "This camera films \(width == 3840 ? "4K" : "1080p") at \(got) frames a second, not \(asked).")
        }
        // Smaller 16:9 size: the biggest one that reaches the frame rate.
        let wide = formats.filter { abs(Double($0.width) / Double(max(1, $0.height)) - 16.0 / 9.0) < 0.01 && $0.width < width }
        let fast = wide.filter { $0.maxFPS + 0.01 >= Double(asked) }
        let pool = fast.isEmpty ? wide : fast
        if let topW = pool.map({ $0.width }).max(), let f = best(pool.filter { $0.width == topW }) {
            let gotFPS = min(asked, Int(f.maxFPS.rounded(.down)))
            return Pick(index: f.index, width: f.width, height: f.height, fps: gotFPS,
                        shortfall: "This camera tops out at \(f.width)×\(f.height). It is not \(width >= 3840 && height >= 2160 ? "4K" : "1080p").")
        }
        return nil
    }

    /// The safe file name for a take ("/" and ":" are not allowed in file names).
    static func safeFileName(_ name: String) -> String {
        let bad = CharacterSet(charactersIn: "/:\\?%*|\"<>")
        return name.components(separatedBy: bad).joined(separator: "-")
    }

    /// The take name, or a fallback that still says which ad and which take,
    /// when the server could not build one (a part was missing).
    static func takeName(for s: Script, localExtra: Int = 0) -> String {
        if localExtra == 0, let n = s.takeFileName, !n.isEmpty { return n }
        let take = max(1, s.takeNo ?? 1) + localExtra
        if let n = ScriptText.takeFileName(offerWord: s.offerWord, adId: s.adId, angle: s.angleName ?? s.title, takeNo: take) {
            return n
        }
        let who = s.adId.map { "Ad \($0)" } ?? "No ad number"
        let angle = s.angleName ?? s.title ?? "No angle"
        return "\(who) — \(angle) Take \(take).mp4"
    }
}
