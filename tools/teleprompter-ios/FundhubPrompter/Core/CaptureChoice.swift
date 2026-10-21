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

    /// Long form (VSL, thank-you, testimonial): 4K at 60 fps (owner call 2026-10-21).
    static let longFormFPS = 60
    /// Ads: 1080p at the highest normal-speed rate the lens has, up to 120 fps
    /// (owner call 2026-10-21: "1080p max settings, like 120fps"). 240 is slow
    /// motion and is never used.
    static let adMaxFPS = 120
    /// Kept for older callers: the 60 fps long-form rate.
    static let filmingFPS = longFormFPS

    /// The chosen size (3840×2160 or 1920×1080) at 60 fps. Never a smaller
    /// picture under the bigger name, and never the slow-motion rate.
    static func pickHighest(_ formats: [FormatInfo], width: Int, height: Int, wantStabilization: Bool) -> Pick? {
        pick(formats, width: width, height: height, fps: longFormFPS, wantStabilization: wantStabilization)
    }

    /// Long form: 3840×2160 at 60 fps. A camera that cannot says so in red.
    static func pickLongForm(_ formats: [FormatInfo], wantStabilization: Bool) -> Pick? {
        pick(formats, width: 3840, height: 2160, fps: longFormFPS, wantStabilization: wantStabilization)
    }

    /// Ads: 1920×1080 at the fastest rate this lens films, capped at 120.
    /// The lens's own top rate is the goal, so a 60 fps lens is not a shortfall.
    static func pickAd(_ formats: [FormatInfo], wantStabilization: Bool) -> Pick? {
        let hd = formats.filter { $0.width == 1920 && $0.height == 1080 }
        guard let top = hd.map({ min(Double(adMaxFPS), $0.maxFPS) }).max(), top >= 1 else {
            return pick(formats, width: 1920, height: 1080, fps: longFormFPS, wantStabilization: wantStabilization)
        }
        let rate = Int((top + 0.01).rounded(.down))
        return pick(formats, width: 1920, height: 1080, fps: rate, wantStabilization: wantStabilization)
    }

    /// Kept for older callers: an ad pick.
    static func pickFront1080(_ formats: [FormatInfo], wantStabilization: Bool) -> Pick? {
        pickAd(formats, wantStabilization: wantStabilization)
    }

    /// Back camera kept for older callers: an ad pick.
    static func pickStable1080(_ formats: [FormatInfo], wantStabilization: Bool) -> Pick? {
        pickAd(formats, wantStabilization: wantStabilization)
    }

    /// The pick for this script. Both lenses follow the same rule.
    static func pickForLens(_ formats: [FormatInfo], lens: String, longForm: Bool = false, wantStabilization: Bool) -> Pick? {
        longForm ? pickLongForm(formats, wantStabilization: wantStabilization)
                 : pickAd(formats, wantStabilization: wantStabilization)
    }

    /// The best format for the quality and frame rate Chris picked.
    /// Order: a normal-speed format (not slow motion); then stabilization;
    /// then Dolby Vision (HDR) when the camera has it; then video range;
    /// then the lowest index (Apple lists the plainest format first).
    static func pick(_ formats: [FormatInfo], width: Int, height: Int, fps: Int, wantStabilization: Bool) -> Pick? {
        guard !formats.isEmpty else { return nil }
        let asked = fps
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
