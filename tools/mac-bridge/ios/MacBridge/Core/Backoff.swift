import Foundation

/// Reconnect wait: 1s, 2s, 4s, 8s, 16s, then 30s every time. Reset on a good connect.
struct Backoff {
    let base: TimeInterval
    let cap: TimeInterval
    private(set) var attempt = 0

    init(base: TimeInterval = 1, cap: TimeInterval = 30) {
        self.base = base
        self.cap = cap
    }

    mutating func next() -> TimeInterval {
        let delay = min(cap, base * pow(2, Double(attempt)))
        if delay < cap { attempt += 1 }
        return delay
    }

    mutating func reset() {
        attempt = 0
    }
}
