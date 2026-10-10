import Foundation

/// v1's reading clock (tools/teleprompter/index.html, kept by the web v2):
/// 60/wpm seconds a word, 35% longer at a sentence end, 15% longer at a comma,
/// and a pause (default 0.8 s) at each blank line between paragraphs.
struct PromptClock: Equatable {
    static let minWPM = 80
    static let maxWPM = 260
    static let defaultWPM = 150

    struct Word: Equatable {
        var text: String
        var paragraph: Int
        /// When this word starts, in seconds from the top.
        var start: Double
        var duration: Double
    }

    private(set) var words: [Word] = []
    /// Index of the last word of each paragraph (for cue holds).
    private(set) var paragraphEnds: [Int] = []
    private(set) var total: Double = 0

    init(paragraphs: [Paragraph], wpm: Int, pauseSeconds: Double) {
        let base = 60.0 / Double(Self.clampWPM(wpm))
        var t = 0.0
        for (pi, p) in paragraphs.enumerated() {
            let tokens = p.text.split(whereSeparator: { $0 == " " || $0 == "\n" || $0 == "\t" }).map(String.init)
            for tok in tokens {
                let d = base * Self.weight(tok)
                words.append(Word(text: tok, paragraph: pi, start: t, duration: d))
                t += d
            }
            paragraphEnds.append(words.count - 1)
            if pi < paragraphs.count - 1 { t += max(0, pauseSeconds) }
        }
        total = t
    }

    static func clampWPM(_ wpm: Int) -> Int { min(maxWPM, max(minWPM, wpm)) }

    /// 1.35 at a sentence end, 1.15 at a comma, else 1.
    static func weight(_ token: String) -> Double {
        let stripped = token.trimmingCharacters(in: CharacterSet(charactersIn: "\"'”’)]"))
        guard let last = stripped.last else { return 1 }
        if ".!?".contains(last) { return 1.35 }
        if ",;:—–".contains(last) { return 1.15 }
        return 1
    }

    /// The word being read at time t (the last word that has started).
    func wordIndex(at t: Double) -> Int {
        guard !words.isEmpty else { return 0 }
        var lo = 0, hi = words.count - 1
        if t <= words[0].start { return 0 }
        while lo < hi {
            let mid = (lo + hi + 1) / 2
            if words[mid].start <= t { lo = mid } else { hi = mid - 1 }
        }
        return lo
    }

    func startOf(word i: Int) -> Double {
        guard !words.isEmpty else { return 0 }
        return words[min(max(0, i), words.count - 1)].start
    }

    /// When the paragraph's last word finishes (a cue holds here).
    func endOf(paragraph p: Int) -> Double? {
        guard p >= 0, p < paragraphEnds.count else { return nil }
        let w = paragraphEnds[p]
        guard w >= 0, w < words.count else { return nil }
        return words[w].start + words[w].duration
    }

    /// Seconds left from t, as "1:05".
    static func clock(_ seconds: Double) -> String {
        let s = max(0, Int(seconds.rounded()))
        return "\(s / 60):" + String(format: "%02d", s % 60)
    }
}

/// Smooth scrolling between lines: one keyframe per line (the first word on
/// that line), y moves straight from one line to the next over the time it
/// takes to read the line. A step into a new paragraph is a blank. If that
/// blank would move faster than the words, playback spends more real time on
/// it so the speed stays the same. A blank that is already slower stays
/// slower (more time to breathe). Pure, so it can be tested without a screen.
struct ScrollTrack: Equatable {
    struct Key: Equatable {
        var t: Double
        var y: Double
        /// The step that lands on this key is empty space between paragraphs.
        var blank: Bool = false
    }
    private(set) var keys: [Key] = []
    /// Pixels per second of the steps that are real words. 0 when there is no such step.
    private(set) var pace: Double = 0
    private var clockTotal: Double = 0

    /// wordY: the middle of each word's line, in content points.
    init(clock: PromptClock, wordY: [Double]) {
        clockTotal = clock.total
        var lastY: Double? = nil
        var lastParagraph: Int? = nil
        for (i, w) in clock.words.enumerated() where i < wordY.count {
            let y = wordY[i]
            if lastY == nil || abs(y - lastY!) > 0.5 {
                let blank = lastParagraph != nil && w.paragraph != lastParagraph
                keys.append(Key(t: w.start, y: y, blank: blank))
                lastY = y
            }
            lastParagraph = w.paragraph
        }
        if let lastWord = clock.words.last, let y = lastY {
            keys.append(Key(t: lastWord.start + lastWord.duration, y: y, blank: false))
        }
        pace = Self.readingPace(keys)
    }

    /// How far the reading clock moves for `wall` seconds of real time.
    /// A fast blank moves the clock slower, so the words do not race the gap.
    func advance(from t: Double, wall: Double) -> Double {
        guard wall > 0 else { return 0 }
        guard keys.count >= 2 else { return wall }
        let end = keys[keys.count - 1].t
        var cur = min(max(t, keys[0].t), end)
        if cur >= end { return 0 }
        var left = wall
        var steps = 0
        while left > 1e-8 && cur < end - 1e-9 && steps < keys.count + 2 {
            steps += 1
            guard let i = segmentIndex(containing: cur) else { break }
            let b = keys[i + 1]
            let full = b.t - keys[i].t
            if full <= 1e-8 { cur = b.t; continue }
            let speed = (b.y - keys[i].y) / full
            let scale = clockPerWall(blank: b.blank, speed: speed)
            let remain = b.t - cur
            let wallNeeded = remain / scale
            if wallNeeded <= left + 1e-9 {
                cur = b.t
                left -= wallNeeded
            } else {
                cur += left * scale
                left = 0
            }
        }
        return max(0, cur - t)
    }

    /// Real seconds from t to the end, counting the extra breath on a fast gap.
    func wallRemaining(from t: Double) -> Double {
        guard keys.count >= 2 else { return max(0, clockTotal - t) }
        let end = keys[keys.count - 1].t
        var cur = min(max(t, keys[0].t), end)
        var wall = 0.0
        var steps = 0
        while cur < end - 1e-9 && steps < keys.count + 2 {
            steps += 1
            guard let i = segmentIndex(containing: cur) else { break }
            let b = keys[i + 1]
            let full = b.t - keys[i].t
            if full <= 1e-8 { cur = b.t; continue }
            let speed = (b.y - keys[i].y) / full
            wall += (b.t - cur) / clockPerWall(blank: b.blank, speed: speed)
            cur = b.t
        }
        return wall
    }

    func y(at t: Double) -> Double {
        guard let first = keys.first else { return 0 }
        if t <= first.t { return first.y }
        for k in 1..<keys.count where t < keys[k].t {
            let a = keys[k - 1], b = keys[k]
            let f = (t - a.t) / max(0.0001, b.t - a.t)
            return a.y + (b.y - a.y) * f
        }
        return keys.last!.y
    }

    /// The time for a reading-line position (after a drag): the inverse of y(at:).
    func t(at y: Double) -> Double {
        guard let first = keys.first else { return 0 }
        if y <= first.y { return first.t }
        for k in 1..<keys.count where y < keys[k].y {
            let a = keys[k - 1], b = keys[k]
            let f = (y - a.y) / max(0.0001, b.y - a.y)
            return a.t + (b.t - a.t) * f
        }
        return keys.last!.t
    }

    /// Clock seconds gained per real second. Less than 1 on a gap that would race.
    private func clockPerWall(blank: Bool, speed: Double) -> Double {
        if blank && speed > pace && pace > 0 { return pace / speed }
        return 1
    }

    private func segmentIndex(containing t: Double) -> Int? {
        guard keys.count >= 2 else { return nil }
        if t >= keys[keys.count - 1].t { return nil }
        if t <= keys[0].t { return 0 }
        for k in 1..<keys.count where t < keys[k].t { return k - 1 }
        return keys.count - 2
    }

    private static func readingPace(_ keys: [Key]) -> Double {
        var dySum = 0.0
        var dtSum = 0.0
        for i in 1..<keys.count {
            if keys[i].blank { continue }
            let dy = keys[i].y - keys[i - 1].y
            let dt = keys[i].t - keys[i - 1].t
            if dy > 0.5 && dt > 1e-6 {
                dySum += dy
                dtSum += dt
            }
        }
        return dtSum > 0 ? dySum / dtSum : 0
    }
}
