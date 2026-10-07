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
/// takes to read the line. Pure, so it can be tested without a screen.
struct ScrollTrack: Equatable {
    struct Key: Equatable { var t: Double; var y: Double }
    private(set) var keys: [Key] = []

    /// wordY: the middle of each word's line, in content points.
    init(clock: PromptClock, wordY: [Double]) {
        var lastY: Double? = nil
        for (i, w) in clock.words.enumerated() where i < wordY.count {
            let y = wordY[i]
            if lastY == nil || abs(y - lastY!) > 0.5 {
                keys.append(Key(t: w.start, y: y))
                lastY = y
            }
        }
        if let lastWord = clock.words.last, let y = lastY {
            keys.append(Key(t: lastWord.start + lastWord.duration, y: y))
        }
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
}
