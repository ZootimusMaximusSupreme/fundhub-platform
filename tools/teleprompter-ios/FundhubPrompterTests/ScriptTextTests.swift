import XCTest
@testable import FundhubPrompter

final class ScriptTextTests: XCTestCase {

    /// The made-up example script from docs/specs/marketing-machine-api.md §6.2.
    let body = "MOST lenders read TWO files before they say yes.\n\nIf one is a mess, they never open the other.\n\nthe personal file\nthe business file\nwhich one they read first\n\nWe check both before you apply anywhere.\n\nTap below and see what both files say today."
    var parts: [ScriptPart] {
        [ScriptPart(kind: "hook", text: "MOST lenders read TWO files before they say yes."),
         ScriptPart(kind: "line2", text: "If one is a mess, they never open the other."),
         ScriptPart(kind: "cue", text: "the personal file"),
         ScriptPart(kind: "cue", text: "the business file"),
         ScriptPart(kind: "cue", text: "which one they read first"),
         ScriptPart(kind: "reveal", text: "We check both before you apply anywhere."),
         ScriptPart(kind: "cta", text: "Tap below and see what both files say today.")]
    }

    func script(style: String) -> Script {
        Script(id: "v1", rootScriptId: "root", version: 1, body: body, parts: parts, style: style)
    }

    func testWordsModeSplitsOnBlankLines() {
        let p = ScriptText.paragraphs(script(style: "words"))
        XCTAssertEqual(p.count, 5)
        XCTAssertEqual(p[2].text, "the personal file\nthe business file\nwhich one they read first")
        XCTAssertFalse(p.contains { $0.cue })
    }

    func testBulletsModeRollsPartsAndCuesHold() {
        let s = script(style: "bullets")
        XCTAssertTrue(ScriptText.isBullets(s))
        let p = ScriptText.paragraphs(s)
        XCTAssertEqual(p.count, 7)
        XCTAssertEqual(p.filter { $0.cue }.count, 3)
        XCTAssertEqual(p[3], Paragraph(text: "the business file", cue: true))
    }

    func testFirstLineOnlyRollsTheHook() {
        var s = script(style: "bullets")
        s.firstLineOnly = true
        XCTAssertFalse(ScriptText.isBullets(s))
        XCTAssertEqual(ScriptText.paragraphs(s), [Paragraph(text: "MOST lenders read TWO files before they say yes.", cue: false)])
    }

    func testCapsRule() {
        XCTAssertTrue(ScriptText.isCaps("MOST"))
        XCTAssertTrue(ScriptText.isCaps("TWO,"))
        XCTAssertFalse(ScriptText.isCaps("LLC"))
        XCTAssertFalse(ScriptText.isCaps("SBA."))
        XCTAssertFalse(ScriptText.isCaps("A"))
        XCTAssertFalse(ScriptText.isCaps("Most"))
    }

    func testTakeFileNameFollowsNaming() {
        XCTAssertEqual(ScriptText.takeFileName(offerWord: "SLO", adId: "7", angle: "Haynes, the call that was never a roadmap", takeNo: 2),
                       "SLO Ad 7 — Haynes, the call that was never a roadmap Take 2.mp4")
        XCTAssertNil(ScriptText.takeFileName(offerWord: nil, adId: "7", angle: "x", takeNo: 1))
        XCTAssertNil(ScriptText.takeFileName(offerWord: "SLO", adId: "7a", angle: "x", takeNo: 1))
        XCTAssertNil(ScriptText.takeFileName(offerWord: "SLO", adId: "7", angle: "", takeNo: 1))
    }

    func testAfterMarkMovesToNextTake() {
        var s = script(style: "words")
        s.offerWord = "SLO"; s.adId = "91"; s.angleName = "Lenders read two files"
        s.takeNo = 3; s.takes = 2; s.takeFileName = "SLO Ad 91 — Lenders read two files Take 3.mp4"
        let a = ScriptText.afterMark(s, gotIt: false)
        XCTAssertEqual(a.takes, 3)
        XCTAssertEqual(a.takeNo, 4)
        XCTAssertEqual(a.gotIt, false)
        XCTAssertEqual(a.lastTakeFileName, "SLO Ad 91 — Lenders read two files Take 3.mp4")
        XCTAssertEqual(a.takeFileName, "SLO Ad 91 — Lenders read two files Take 4.mp4")
        XCTAssertEqual(ScriptText.afterMark(a, gotIt: true).gotIt, true)
        XCTAssertEqual(ScriptText.afterMark(ScriptText.afterMark(a, gotIt: true), gotIt: false).gotIt, true, "Another take never un-keeps Got it")
    }

    // MARK: applyEdit (port of teleprompter-edits.js)

    func testEditOneParagraphWordsMode() {
        let s = script(style: "words")
        let paras = ScriptText.paragraphs(s)
        let r = ScriptText.applyEdit(s, paragraphs: paras, index: 4, newText: "Tap below and see your number today.  ", bullets: false)!
        XCTAssertTrue(r.changed)
        XCTAssertTrue(r.body.hasSuffix("We check both before you apply anywhere.\n\nTap below and see your number today."))
        XCTAssertEqual(r.parts?.last, ScriptPart(kind: "cta", text: "Tap below and see your number today."))
        XCTAssertEqual(r.parts?.count, 7)
    }

    func testEditCueLinesMapLineByLine() {
        let s = script(style: "words")
        let paras = ScriptText.paragraphs(s)
        let r = ScriptText.applyEdit(s, paragraphs: paras, index: 2,
                                     newText: "the personal file\nthe company file\nwhich one they read first", bullets: false)!
        XCTAssertTrue(r.body.contains("the personal file\nthe company file\nwhich one they read first"))
        XCTAssertEqual(r.parts?[3], ScriptPart(kind: "cue", text: "the company file"))
    }

    func testEditBulletsModeChangesThatPart() {
        let s = script(style: "bullets")
        let paras = ScriptText.paragraphs(s)
        let r = ScriptText.applyEdit(s, paragraphs: paras, index: 3, newText: "the business credit file", bullets: true)!
        XCTAssertEqual(r.parts?[3].text, "the business credit file")
        XCTAssertTrue(r.body.contains("the personal file\nthe business credit file\nwhich one"))
    }

    func testDeletingAParagraphClosesTheGap() {
        let s = script(style: "words")
        let paras = ScriptText.paragraphs(s)
        let r = ScriptText.applyEdit(s, paragraphs: paras, index: 3, newText: "   ", bullets: false)!
        XCTAssertFalse(r.body.contains("We check both"))
        XCTAssertTrue(r.body.contains("which one they read first\n\nTap below"))
        XCTAssertEqual(r.parts?.count, 6)
    }

    func testNoChangeIsNotChanged() {
        let s = script(style: "words")
        let paras = ScriptText.paragraphs(s)
        let r = ScriptText.applyEdit(s, paragraphs: paras, index: 0, newText: paras[0].text + "\n", bullets: false)!
        XCTAssertFalse(r.changed)
        XCTAssertEqual(r.body, body)
    }

    func testEditOutOfRangeIsNil() {
        let s = script(style: "words")
        XCTAssertNil(ScriptText.applyEdit(s, paragraphs: ScriptText.paragraphs(s), index: 9, newText: "x", bullets: false))
    }

    func testWithWordsKeepsRolledTextInStep() {
        let s = script(style: "words")
        let w = ScriptText.withWords(s, body: "One.\n\nTwo.", parts: nil)
        XCTAssertEqual(w.teleprompterText, "One.\n\nTwo.")
        XCTAssertNil(w.parts)
        XCTAssertEqual(ScriptText.paragraphs(w).map { $0.text }, ["One.", "Two."])
    }
}
