import XCTest
@testable import FundhubPrompter

/// A pretend server: answers in order, and records every request.
final class FakeTransport: Transport {
    struct Call { var method: String; var path: String; var body: [String: Any]? }
    var calls: [Call] = []
    var answers: [(String) -> HTTPResult] = []

    func send(_ method: String, _ path: String, body: [String: Any]?) async -> HTTPResult {
        calls.append(Call(method: method, path: path, body: body))
        guard !answers.isEmpty else { return HTTPResult(status: 0, data: nil) }
        return answers.removeFirst()(path)
    }

    static func json(_ status: Int, _ obj: Any) -> (String) -> HTTPResult {
        { _ in HTTPResult(status: status, data: try? JSONSerialization.data(withJSONObject: obj)) }
    }
    static let offline: (String) -> HTTPResult = { _ in HTTPResult(status: 0, data: nil) }
}

func scriptJSON(id: String, root: String, version: Int, body: String) -> [String: Any] {
    ["id": id, "root_script_id": root, "version": version, "status": "locked", "ad_id": "91",
     "title": "Lenders read two files", "body": body, "parts": NSNull()]
}

@MainActor
final class SaveQueueTests: XCTestCase {
    var base: Script { Script(id: "v1", rootScriptId: "root", version: 1, title: "Lenders read two files", body: "Old words.") }

    func makeQueue(_ t: FakeTransport, file: URL? = nil) -> SaveQueue {
        let q = SaveQueue(transport: t, fileURL: file)
        q.timeZone = TimeZone(identifier: "America/Phoenix")!
        q.now = { Date(timeIntervalSince1970: 1_791_313_440) } // 2026-10-06 19:04 UTC = 12:04 Arizona
        return q
    }

    func testSavesThroughTheDashboardsEditRoute() async {
        let t = FakeTransport()
        t.answers = [FakeTransport.json(200, ["script": scriptJSON(id: "v2", root: "root", version: 2, body: "New words."), "warnings": []])]
        let q = makeQueue(t)
        var saved: Script?
        q.onSaved = { _, s, _ in saved = s }
        q.edit(root: "root", base: base, body: "New words.", parts: nil)
        XCTAssertEqual(q.pulse.text, "1 edit waiting")
        await q.flush()
        XCTAssertEqual(t.calls.count, 1)
        XCTAssertEqual(t.calls[0].method, "POST")
        XCTAssertEqual(t.calls[0].path, "marketing/scripts/edit")
        XCTAssertEqual(t.calls[0].body?["id"] as? String, "v1")
        XCTAssertEqual(t.calls[0].body?["version"] as? Int, 1)
        XCTAssertEqual(t.calls[0].body?["body"] as? String, "New words.")
        XCTAssertNotNil(t.calls[0].body?["request_id"] as? String)
        XCTAssertNil(t.calls[0].body?["parts"])
        XCTAssertEqual(saved?.version, 2)
        XCTAssertTrue(q.items.isEmpty)
        XCTAssertEqual(q.pulse, SaveQueue.Pulse(text: "Saved 12:04", tone: .good))
    }

    func testOfflineKeepsTheEditAndResendsTheSameRequestId() async {
        let t = FakeTransport()
        t.answers = [FakeTransport.offline, FakeTransport.offline,
                     FakeTransport.json(200, ["script": scriptJSON(id: "v2", root: "root", version: 2, body: "B"), "warnings": []])]
        let q = makeQueue(t)
        q.edit(root: "root", base: base, body: "A", parts: nil)
        await q.flush()
        q.edit(root: "root", base: base, body: "B", parts: nil)
        XCTAssertEqual(q.pulse, SaveQueue.Pulse(text: "Offline — 2 edits waiting", tone: .warn))
        await q.flush()
        let first = t.calls[0].body?["request_id"] as? String
        XCTAssertEqual(t.calls[1].body?["request_id"] as? String, first, "a save cut off is sent again exactly")
        XCTAssertEqual(t.calls[1].body?["body"] as? String, "A")
        // Back online: the cut-off save lands, then the newer words go as the next version.
        t.answers.insert(FakeTransport.json(200, ["script": scriptJSON(id: "v2", root: "root", version: 2, body: "A"), "warnings": []]), at: 0)
        q.networkCameBack()
        await q.flush()
        XCTAssertEqual(t.calls[2].body?["request_id"] as? String, first)
        XCTAssertEqual(t.calls[3].body?["body"] as? String, "B")
        XCTAssertEqual(t.calls[3].body?["id"] as? String, "v2")
        XCTAssertEqual(t.calls[3].body?["version"] as? Int, 2)
        XCTAssertNotEqual(t.calls[3].body?["request_id"] as? String, first)
        XCTAssertTrue(q.items.isEmpty)
    }

    func testWaitingListSurvivesAnAppRestart() async {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".json")
        let t = FakeTransport()
        t.answers = [FakeTransport.offline]
        let q = makeQueue(t, file: file)
        q.edit(root: "root", base: base, body: "Kept.", parts: nil)
        q.mark(shootId: "shoot", root: "root", mark: "got_it")
        await q.flush()
        let again = makeQueue(FakeTransport(), file: file)
        XCTAssertEqual(again.items["root"]?.body, "Kept.")
        XCTAssertEqual(again.marks.count, 1)
        XCTAssertEqual(again.items["root"]?.sent?.requestId, t.calls[0].body?["request_id"] as? String)
    }

    func testSignedOutKeepsTheList() async {
        let t = FakeTransport()
        t.answers = [FakeTransport.json(401, ["error": "unauthorized"])]
        let q = makeQueue(t)
        q.edit(root: "root", base: base, body: "X", parts: nil)
        await q.flush()
        XCTAssertEqual(q.pulse.text, "Sign in again — 1 edit waiting")
        XCTAssertNotNil(q.items["root"])
    }

    func testStaleShowsTwoVersionsAndKeepMineSavesOnTop() async {
        let t = FakeTransport()
        t.answers = [
            FakeTransport.json(409, ["error": "stale", "current": ["version": 3, "body": "Dashboard words.", "parts": NSNull()]]),
            FakeTransport.json(200, ["script": scriptJSON(id: "v3", root: "root", version: 3, body: "Dashboard words."),
                                     "versions": [scriptJSON(id: "v3", root: "root", version: 3, body: "Dashboard words.")]]),
            FakeTransport.json(200, ["script": scriptJSON(id: "v4", root: "root", version: 4, body: "Phone words."), "warnings": []])
        ]
        let q = makeQueue(t)
        q.edit(root: "root", base: base, body: "Phone words.", parts: nil)
        await q.flush()
        XCTAssertEqual(t.calls[1].path, "marketing/script?id=v1")
        XCTAssertEqual(q.pulse.text, "Two versions — pick one")
        XCTAssertEqual(q.items["root"]?.conflict?.theirBody, "Dashboard words.")
        await q.keepMine("root")
        XCTAssertEqual(t.calls[2].body?["id"] as? String, "v3")
        XCTAssertEqual(t.calls[2].body?["version"] as? Int, 3)
        XCTAssertEqual(t.calls[2].body?["body"] as? String, "Phone words.")
        XCTAssertTrue(q.items.isEmpty)
    }

    func testKeepTheirsDropsTheWaitingWords() async {
        let t = FakeTransport()
        t.answers = [FakeTransport.json(409, ["error": "stale", "current": ["version": 2, "body": "Theirs"]]), FakeTransport.offline]
        let q = makeQueue(t)
        q.edit(root: "root", base: base, body: "Mine", parts: nil)
        await q.flush()
        XCTAssertNil(q.keepTheirs("root"), "the live version could not be read while offline")
        XCTAssertTrue(q.items.isEmpty)
    }

    func testRefusedSaveCanBeRetriedOrThrownAway() async {
        let t = FakeTransport()
        t.answers = [FakeTransport.json(400, ["error": "invalid", "field": "body", "message": "The words are empty."])]
        let q = makeQueue(t)
        q.edit(root: "root", base: base, body: "Z", parts: nil)
        await q.flush()
        XCTAssertEqual(q.items["root"]?.failed, "The words are empty.")
        XCTAssertEqual(q.pulse.text, "Not saved — tap to see why")
        q.throwAway("root")
        XCTAssertEqual(q.pulse.text, "No changes yet")
    }

    func testTypingBackToTheSavedWordsSendsNothing() async {
        let t = FakeTransport()
        let q = makeQueue(t)
        q.edit(root: "root", base: base, body: "Old words.", parts: nil)
        await q.flush()
        XCTAssertTrue(t.calls.isEmpty)
        XCTAssertTrue(q.items.isEmpty)
    }

    func testMarksGoInOrderOnceEach() async {
        let t = FakeTransport()
        t.answers = [FakeTransport.json(200, ["marks": [:]]), FakeTransport.offline,
                     FakeTransport.json(200, ["marks": [:]])]
        let q = makeQueue(t)
        q.mark(shootId: "s1", root: "a", mark: "another_take")
        q.mark(shootId: "s1", root: "a", mark: "got_it")
        await q.flush()
        XCTAssertEqual(q.marks.count, 1)
        XCTAssertEqual(q.pulse.text, "Offline — 1 take mark waiting")
        await q.flush()
        XCTAssertTrue(q.marks.isEmpty)
        XCTAssertEqual(t.calls.map { $0.path }, ["marketing/shoot/mark", "marketing/shoot/mark", "marketing/shoot/mark"])
        XCTAssertEqual(t.calls[0].body?["mark"] as? String, "another_take")
        XCTAssertEqual(t.calls[1].body?["request_id"] as? String, t.calls[2].body?["request_id"] as? String)
        XCTAssertEqual(t.calls[2].body?["shoot_id"] as? String, "s1")
        XCTAssertEqual(t.calls[2].body?["root_script_id"] as? String, "a")
    }
}

final class ModelsAndAPITests: XCTestCase {
    func testDecodesTheContractsShootExample() throws {
        let a = try JSONDecoder().decode(ShootAnswer.self, from: Data(DemoTransport.shootJSON.utf8))
        XCTAssertEqual(a.shoot?.id, "00000000-0000-4000-8000-000000000901")
        XCTAssertEqual(a.filmList.count, 2)
        let first = a.filmList[0]
        XCTAssertEqual(first.adId, "91")
        XCTAssertEqual(first.takeFileName, "SLO Ad 91 — Lenders read two files Take 3.mp4")
        XCTAssertEqual(first.gotIt, true)
        XCTAssertEqual(first.style, "bullets")
        XCTAssertEqual(first.displayName, "Ad 91 · Lenders read two files")
        XCTAssertNil(a.filmList[1].takeFileName)
    }

    func testNoShootFallsBackToApprovedScripts() throws {
        let json = #"{"shoot":null,"plan_candidates":[{"id":"a","root_script_id":"a","version":1,"body":"Hi.","ad_id":91}]}"#
        let a = try JSONDecoder().decode(ShootAnswer.self, from: Data(json.utf8))
        XCTAssertNil(a.shoot)
        XCTAssertEqual(a.filmList.map { $0.id }, ["a"])
        XCTAssertEqual(a.filmList[0].adId, "91", "a number sent as a number still reads")
    }

    func testRequestsCarryTheBearerTokenAndJSON() throws {
        let api = APIClient(baseURL: URL(string: "https://fundhub.ai/")!, token: "tok")
        let r = api.request("POST", "marketing/scripts/edit", body: ["id": "x", "version": 2])
        XCTAssertEqual(r.url?.absoluteString, "https://fundhub.ai/api/marketing/scripts/edit")
        XCTAssertEqual(r.value(forHTTPHeaderField: "Authorization"), "Bearer tok")
        XCTAssertEqual(r.value(forHTTPHeaderField: "Content-Type"), "application/json")
        let body = try JSONSerialization.jsonObject(with: r.httpBody!) as? [String: Any]
        XCTAssertEqual(body?["version"] as? Int, 2)
        let g = APIClient(baseURL: URL(string: "https://fundhub.ai")!, token: nil).request("GET", "marketing/shoot?wpm=150", body: nil)
        XCTAssertEqual(g.url?.absoluteString, "https://fundhub.ai/api/marketing/shoot?wpm=150")
        XCTAssertNil(g.value(forHTTPHeaderField: "Authorization"))
        XCTAssertNil(g.httpBody)
    }

    func testSettingsKeepOldValuesWhenNewOnesAreAdded() throws {
        let old = #"{"wpm":180,"mirror":true}"#
        let s = try JSONDecoder().decode(PrompterSettings.self, from: Data(old.utf8))
        XCTAssertEqual(s.wpm, 180)
        XCTAssertTrue(s.mirror)
        XCTAssertTrue(s.recordMirrored, "mirrored recording is the owner default")
        XCTAssertEqual(s.quality, .uhd4K)
        XCTAssertEqual(s.codec, .h264)
    }
}
