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

    /// The chosen size (3840×2160 or 1920×1080) at the highest frame rate that
    /// size really has. Never a smaller picture under the bigger name.
    static func pickHighest(_ formats: [FormatInfo], width: Int, height: Int, wantStabilization: Bool) -> Pick? {
        let same = formats.filter { $0.width == width && $0.height == height }
        if let top = same.map(\.maxFPS).max(), top >= 1 {
            return pick(formats, width: width, height: height, fps: max(1, Int(top.rounded())), wantStabilization: wantStabilization)
        }
        return pick(formats, width: width, height: height, fps: 1000, wantStabilization: wantStabilization)
    }

    /// The best format for the quality and frame rate Chris picked.
    /// Order: exact size and frame rate first; then stabilization support; then
    /// video range; then no HDR (Meta wants plain SDR H.264); then the lowest
    /// index (Apple lists the plainest format first).
    static func pick(_ formats: [FormatInfo], width: Int, height: Int, fps: Int, wantStabilization: Bool) -> Pick? {
        guard !formats.isEmpty else { return nil }
        func score(_ f: FormatInfo) -> [Int] {
            [f.stabilization || !wantStabilization ? 1 : 0, f.videoRange ? 1 : 0, f.hdr ? 0 : 1, -f.index]
        }
        func best(_ list: [FormatInfo]) -> FormatInfo? {
            list.max { score($0).lexicographicallyPrecedes(score($1)) }
        }
        let exact = formats.filter { $0.width == width && $0.height == height && $0.maxFPS + 0.01 >= Double(fps) }
        if let f = best(exact) {
            return Pick(index: f.index, width: f.width, height: f.height, fps: fps, shortfall: nil)
        }
        // Right size, slower frame rate.
        let sameSize = formats.filter { $0.width == width && $0.height == height }
        if let top = sameSize.map({ $0.maxFPS }).max(), let f = best(sameSize.filter { $0.maxFPS == top }) {
            let got = Int(top.rounded(.down))
            return Pick(index: f.index, width: f.width, height: f.height, fps: got,
                        shortfall: "This camera films \(width == 3840 ? "4K" : "1080p") at \(got) frames a second, not \(fps).")
        }
        // Smaller 16:9 size: the biggest one that reaches the frame rate.
        let wide = formats.filter { abs(Double($0.width) / Double(max(1, $0.height)) - 16.0 / 9.0) < 0.01 && $0.width < width }
        let fast = wide.filter { $0.maxFPS + 0.01 >= Double(fps) }
        let pool = fast.isEmpty ? wide : fast
        if let topW = pool.map({ $0.width }).max(), let f = best(pool.filter { $0.width == topW }) {
            let gotFPS = min(fps, Int(f.maxFPS.rounded(.down)))
            return Pick(index: f.index, width: f.width, height: f.height, fps: gotFPS,
                        shortfall: "This camera tops out at \(f.width)×\(f.height). It is not 4K.")
        }
        return nil
    }

    /// Our bitrate pick, in bits a second. Meta does not publish a bitrate; it
    /// re-encodes every upload. So we record well above Apple's default and give
    /// Meta (and the editor) a clean master to start from.
    static func bitrate(width: Int, fps: Int, hevc: Bool) -> Int {
        let base: Int
        switch width {
        case 3840...: base = fps > 30 ? 75_000_000 : 50_000_000
        case 1920...: base = fps > 30 ? 30_000_000 : 20_000_000
        default: base = fps > 30 ? 16_000_000 : 10_000_000
        }
        // HEVC holds the same picture in about two thirds of the bits.
        return hevc ? base * 2 / 3 : base
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
