import XCTest
@testable import MacBridge

final class BackoffTests: XCTestCase {
    func testSequenceDoublesFromOneAndCapsAtThirty() {
        var b = Backoff()
        let seq = (0..<9).map { _ in b.next() }
        XCTAssertEqual(seq, [1, 2, 4, 8, 16, 30, 30, 30, 30])
    }

    func testResetStartsOverAtOne() {
        var b = Backoff()
        _ = b.next(); _ = b.next(); _ = b.next()
        b.reset()
        XCTAssertEqual(b.next(), 1)
        XCTAssertEqual(b.next(), 2)
    }

    func testStaysAtCapForever() {
        var b = Backoff()
        for _ in 0..<1000 { _ = b.next() }
        XCTAssertEqual(b.next(), 30)
    }
}
