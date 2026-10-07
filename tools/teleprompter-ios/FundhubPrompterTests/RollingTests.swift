import XCTest
@testable import FundhubPrompter

final class PromptClockTests: XCTestCase {
    func testV1Clock() {
        let paras = [Paragraph(text: "One two three.", cue: false), Paragraph(text: "Four, five", cue: false)]
        let c = PromptClock(paragraphs: paras, wpm: 150, pauseSeconds: 0.8)
        let w = 60.0 / 150.0
        XCTAssertEqual(c.words.count, 5)
        XCTAssertEqual(c.words[2].duration, w * 1.35, accuracy: 1e-9, "a sentence end holds 35% longer")
        XCTAssertEqual(c.words[3].duration, w * 1.15, accuracy: 1e-9, "a comma holds 15% longer")
        XCTAssertEqual(c.words[3].start, w * 2 + w * 1.35 + 0.8, accuracy: 1e-9, "a blank line pauses 0.8 s")
        XCTAssertEqual(c.total, w * 2 + w * 1.35 + 0.8 + w * 1.15 + w, accuracy: 1e-9)
        XCTAssertEqual(c.wordIndex(at: 0), 0)
        XCTAssertEqual(c.wordIndex(at: c.words[3].start + 0.01), 3)
        XCTAssertEqual(c.endOf(paragraph: 0)!, w * 2 + w * 1.35, accuracy: 1e-9)
    }

    func testSpeedIsClamped() {
        XCTAssertEqual(PromptClock.clampWPM(10), 80)
        XCTAssertEqual(PromptClock.clampWPM(999), 260)
        XCTAssertEqual(PromptClock.clock(65), "1:05")
    }

    func testScrollTrackIsSmoothAndInverts() {
        let paras = [Paragraph(text: "a b c d", cue: false)]
        let c = PromptClock(paragraphs: paras, wpm: 80, pauseSeconds: 0)
        let line2 = c.words[2].start
        // Two words per line: line 1 at y=10, line 2 at y=50.
        let track = ScrollTrack(clock: c, wordY: [10, 10, 50, 50])
        XCTAssertEqual(track.keys.count, 3)
        XCTAssertEqual(track.y(at: 0), 10)
        XCTAssertEqual(track.y(at: line2 / 2), 30, accuracy: 1e-9, "half way through line 1, half way to line 2")
        XCTAssertEqual(track.y(at: 99), 50)
        XCTAssertEqual(track.t(at: 30), line2 / 2, accuracy: 1e-9)
    }
}

final class TapRulesTests: XCTestCase {
    func testOneTapPausesATapAgainResumes() {
        var r = TapRules()
        XCTAssertEqual(r.singleTap(at: 1, mode: .rolling), .pause)
        XCTAssertEqual(r.singleTap(at: 3, mode: .paused), .resume)
        XCTAssertEqual(r.singleTap(at: 5, mode: .holding), .releaseCue)
        XCTAssertEqual(r.singleTap(at: 7, mode: .ended), TapRules.Act.none)
    }

    func testDoubleTapIsScrollModeFromRolling() {
        var r = TapRules()
        _ = r.singleTap(at: 1.0, mode: .rolling)       // first tap paused at once
        _ = r.singleTap(at: 1.2, mode: .paused)        // UIKit may report the second tap too
        XCTAssertEqual(r.doubleTap(at: 1.2), .scrollOn)
    }

    func testDoubleTapReportedBeforeTheSecondSingle() {
        var r = TapRules()
        _ = r.singleTap(at: 1.0, mode: .paused)
        XCTAssertEqual(r.doubleTap(at: 1.2), .scrollOn)
        XCTAssertEqual(r.singleTap(at: 1.21, mode: .scroll), TapRules.Act.none, "the same finger must not act twice")
    }

    func testDoubleTapAgainLeavesScrollMode() {
        var r = TapRules()
        _ = r.singleTap(at: 5.0, mode: .scroll)
        _ = r.singleTap(at: 5.2, mode: .rolling)
        XCTAssertEqual(r.doubleTap(at: 5.2), .scrollOff)
    }
}

final class RemoteKeysTests: XCTestCase {
    func id(_ n: Int) -> String { RemoteKeys.id(hidUsage: n) }

    func testV1Keys() {
        XCTAssertEqual(RemoteKeys.action(for: id(RemoteKeys.space), learned: [:], atEnd: false), .play)
        XCTAssertEqual(RemoteKeys.action(for: id(RemoteKeys.pageDown), learned: [:], atEnd: false), .play)
        XCTAssertEqual(RemoteKeys.action(for: id(RemoteKeys.up), learned: [:], atEnd: false), .faster)
        XCTAssertEqual(RemoteKeys.action(for: id(RemoteKeys.left), learned: [:], atEnd: false), .slower)
        XCTAssertEqual(RemoteKeys.action(for: id(RemoteKeys.pageUp), learned: [:], atEnd: false), .restart)
        XCTAssertNil(RemoteKeys.action(for: id(0x04), learned: [:], atEnd: false))
    }

    func testAtTheEndPlayIsGotItAndRestartIsAnotherTake() {
        XCTAssertEqual(RemoteKeys.action(for: id(RemoteKeys.enter), learned: [:], atEnd: true), .gotIt)
        XCTAssertEqual(RemoteKeys.action(for: id(RemoteKeys.pageUp), learned: [:], atEnd: true), .anotherTake)
    }

    func testLearnedKeysWinAndMoveOffOtherSlots() {
        var learned = RemoteKeys.learn("hid:200", for: .faster, into: [:])
        XCTAssertEqual(RemoteKeys.action(for: "hid:200", learned: learned, atEnd: false), .faster)
        learned = RemoteKeys.learn("hid:200", for: .gotIt, into: learned)
        XCTAssertEqual(learned["faster"], [])
        XCTAssertEqual(RemoteKeys.action(for: "hid:200", learned: learned, atEnd: true), .gotIt)
        XCTAssertEqual(RemoteKeys.action(for: "hid:200", learned: learned, atEnd: false), .play, "Got it mid-script means play")
    }
}

final class CaptureChoiceTests: XCTestCase {
    func f(_ i: Int, _ w: Int, _ h: Int, _ fps: Double, stab: Bool = true, video: Bool = true, hdr: Bool = false) -> CaptureChoice.FormatInfo {
        .init(index: i, width: w, height: h, maxFPS: fps, stabilization: stab, videoRange: video, hdr: hdr)
    }

    func testPicks4K60WhenThePhoneHasIt() {
        let formats = [f(0, 1920, 1080, 60), f(1, 3840, 2160, 30), f(2, 3840, 2160, 60, video: false), f(3, 3840, 2160, 60)]
        let p = CaptureChoice.pick(formats, width: 3840, height: 2160, fps: 60, wantStabilization: true)!
        XCTAssertEqual(p.index, 3, "video range beats full range")
        XCTAssertEqual(p.fps, 60)
        XCTAssertNil(p.shortfall)
    }

    func testSaysSoWhenThereIsNo4K() {
        let formats = [f(0, 1280, 720, 60), f(1, 1920, 1080, 60), f(2, 1920, 1440, 30)]
        let p = CaptureChoice.pick(formats, width: 3840, height: 2160, fps: 30, wantStabilization: true)!
        XCTAssertEqual(p.width, 1920)
        XCTAssertEqual(p.height, 1080)
        XCTAssertEqual(p.shortfall, "This camera tops out at 1920×1080. It is not 4K.")
    }

    func testSlowerFrameRateIsNamed() {
        let p = CaptureChoice.pick([f(0, 3840, 2160, 30)], width: 3840, height: 2160, fps: 60, wantStabilization: false)!
        XCTAssertEqual(p.fps, 30)
        XCTAssertNotNil(p.shortfall)
    }

    func testPrefersStabilizationAndNoHDR() {
        let formats = [f(0, 1920, 1080, 30, stab: false), f(1, 1920, 1080, 30, hdr: true), f(2, 1920, 1080, 30)]
        XCTAssertEqual(CaptureChoice.pick(formats, width: 1920, height: 1080, fps: 30, wantStabilization: true)?.index, 2)
    }

    func testBitrate() {
        XCTAssertEqual(CaptureChoice.bitrate(width: 3840, fps: 30, hevc: false), 50_000_000)
        XCTAssertEqual(CaptureChoice.bitrate(width: 1920, fps: 60, hevc: false), 30_000_000)
        XCTAssertEqual(CaptureChoice.bitrate(width: 1920, fps: 30, hevc: true), 20_000_000 * 2 / 3)
    }

    func testTakeNameFallbacks() {
        var s = Script(id: "a", rootScriptId: "a", version: 1, adId: "92", title: "Inquiries off first", body: "x")
        s.takeFileName = nil
        s.takeNo = 1
        XCTAssertEqual(CaptureChoice.takeName(for: s), "Ad 92 — Inquiries off first Take 1.mp4", "no made-up offer word")
        s.offerWord = "SLO"
        s.angleName = "Inquiries off first"
        s.takeFileName = "SLO Ad 92 — Inquiries off first Take 1.mp4"
        XCTAssertEqual(CaptureChoice.takeName(for: s), "SLO Ad 92 — Inquiries off first Take 1.mp4")
        XCTAssertEqual(CaptureChoice.takeName(for: s, localExtra: 1), "SLO Ad 92 — Inquiries off first Take 2.mp4")
        XCTAssertEqual(CaptureChoice.safeFileName("a/b:c"), "a-b-c")
    }
}
