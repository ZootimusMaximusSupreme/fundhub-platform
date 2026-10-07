import Foundation

/// What the words are doing.
enum RollMode: String, Equatable {
    case paused
    case countdown
    case rolling
    /// Scroll mode: drag or flick the words by hand; a tap rolls on from there.
    case scroll
    /// Bullets mode: a cue waits for a tap or the remote.
    case holding
    /// The last word has rolled.
    case ended
}

/// The touch rules (owner, 2026-10-06), the same as the web teleprompter:
/// one tap pauses, a tap again rolls on, a double tap is scroll mode (a double
/// tap again leaves it). A tap acts at once — no waiting to see if a second
/// tap comes — and the double tap sets the mode from what it was before the
/// first tap, so a pause never lags and a double tap never leaves it half-done.
struct TapRules: Equatable {
    enum Act: Equatable {
        case pause
        case resume
        case releaseCue
        case scrollOn
        case scrollOff
        case none
    }

    /// Two taps closer than this are one double tap.
    static let doubleWindow: TimeInterval = 0.5

    struct Tap: Equatable { var at: TimeInterval; var modeBefore: RollMode }

    /// The last two single taps. On a double tap, UIKit may also report the
    /// second tap as a single tap, in either order; keeping two covers both.
    private(set) var taps: [Tap] = []
    /// A single tap reported just AFTER the double tap is that same finger: ignore it.
    private(set) var ignoreUntil: TimeInterval = -1

    /// One finger tap at time t while the words are in `mode`.
    mutating func singleTap(at t: TimeInterval, mode: RollMode) -> Act {
        if t <= ignoreUntil { return .none }
        taps.append(Tap(at: t, modeBefore: mode))
        if taps.count > 2 { taps.removeFirst(taps.count - 2) }
        switch mode {
        case .rolling, .countdown: return .pause
        case .paused, .scroll: return .resume
        case .holding: return .releaseCue
        case .ended: return .none
        }
    }

    /// The second tap of a double tap: the mode it must become, from the mode
    /// before the FIRST tap of the pair.
    mutating func doubleTap(at t: TimeInterval) -> Act {
        let pair = taps.filter { t - $0.at <= Self.doubleWindow }
        taps.removeAll()
        ignoreUntil = t + 0.15
        guard let first = pair.first else { return .scrollOn }
        return first.modeBefore == .scroll ? .scrollOff : .scrollOn
    }
}

/// Thumb drag on the glass. Positive screen movement is the thumb moving down.
/// Positive result raises the text offset, so the words move up.
/// A rig that flips the words upside down uses the opposite offset so the
/// thumb still does the same thing on the glass.
enum PrompterDrag {
    static func offsetDelta(screenFingerDy: Double, flippedVertically: Bool) -> Double {
        flippedVertically ? -screenFingerDy : screenFingerDy
    }
}
