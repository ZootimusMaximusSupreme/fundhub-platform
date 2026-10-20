import XCTest
@testable import MacBridge

final class ModelDecodeTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    func testSessionDecodesSpecFixture() throws {
        let s = try decode(Session.self, """
        { "id": "3f1c-uuid", "tool": "claude", "project": "fundhub-platform",
          "title": "Build the iPhone app", "updatedAt": "2026-10-20T17:04:05.123Z",
          "live": true, "eventCount": 42 }
        """)
        XCTAssertEqual(s.id, "3f1c-uuid")
        XCTAssertEqual(s.tool, "claude")
        XCTAssertEqual(s.project, "fundhub-platform")
        XCTAssertEqual(s.title, "Build the iPhone app")
        XCTAssertEqual(s.updatedAt, "2026-10-20T17:04:05.123Z")
        XCTAssertTrue(s.live)
        XCTAssertEqual(s.eventCount, 42)
        XCTAssertEqual(s.key, "claude/3f1c-uuid")
        XCTAssertEqual(s.toolLabel, "Claude")
        XCTAssertNotNil(s.updatedDate)
    }

    func testSessionWithoutFractionalSecondsAndCodexTool() throws {
        let s = try decode(Session.self, """
        { "id": "rollout-1", "tool": "codex", "project": "x", "title": "t",
          "updatedAt": "2026-10-20T17:04:05Z", "live": false, "eventCount": 0 }
        """)
        XCTAssertEqual(s.toolLabel, "Codex")
        XCTAssertNotNil(s.updatedDate)
        XCTAssertFalse(s.isLive())
    }

    func testSessionMissingNonKeyFieldsUsesDefaults() throws {
        let s = try decode(Session.self, #"{ "id": "a", "tool": "codex" }"#)
        XCTAssertEqual(s.project, "")
        XCTAssertEqual(s.title, "")
        XCTAssertFalse(s.live)
        XCTAssertEqual(s.eventCount, 0)
        XCTAssertNil(s.updatedDate)
    }

    func testSessionMissingIdFails() {
        XCTAssertThrowsError(try decode(Session.self, #"{ "tool": "claude" }"#))
    }

    func testLiveGoesStaleAfter120Seconds() throws {
        let s = try decode(Session.self, """
        { "id": "a", "tool": "claude", "project": "p", "title": "t",
          "updatedAt": "2026-10-20T17:00:00Z", "live": true, "eventCount": 1 }
        """)
        let updated = try XCTUnwrap(s.updatedDate)
        XCTAssertTrue(s.isLive(now: updated.addingTimeInterval(60)))
        XCTAssertFalse(s.isLive(now: updated.addingTimeInterval(121)))
    }

    func testSessionsResponse() throws {
        let r = try decode(SessionsResponse.self, """
        { "sessions": [
          { "id": "a", "tool": "claude", "project": "p", "title": "t", "updatedAt": "2026-10-20T17:00:00Z", "live": true, "eventCount": 1 },
          { "id": "b", "tool": "codex", "project": "q", "title": "u", "updatedAt": "2026-10-20T16:00:00Z", "live": false, "eventCount": 2 }
        ] }
        """)
        XCTAssertEqual(r.sessions.map(\.key), ["claude/a", "codex/b"])
    }

    func testCommandEventWithAllFields() throws {
        let e = try decode(Event.self, """
        { "seq": 17, "ts": "2026-10-20T17:04:05.123Z", "kind": "command",
          "text": "npm test", "command": "npm test", "exitCode": 1 }
        """)
        XCTAssertEqual(e.seq, 17)
        XCTAssertEqual(e.id, 17)
        XCTAssertEqual(e.kind, .command)
        XCTAssertEqual(e.command, "npm test")
        XCTAssertEqual(e.exitCode, 1)
        XCTAssertTrue(e.failed)
        XCTAssertNotNil(e.date)
    }

    func testEventWithoutCommandOrExitCode() throws {
        let e = try decode(Event.self, """
        { "seq": 1, "ts": "2026-10-20T17:04:05Z", "kind": "assistant", "text": "Hello" }
        """)
        XCTAssertEqual(e.kind, .assistant)
        XCTAssertEqual(e.text, "Hello")
        XCTAssertNil(e.command)
        XCTAssertNil(e.exitCode)
        XCTAssertFalse(e.failed)
    }

    func testEventWithNullOptionalFields() throws {
        let e = try decode(Event.self, """
        { "seq": 2, "ts": "2026-10-20T17:04:05Z", "kind": "output", "text": "ok", "command": null, "exitCode": null }
        """)
        XCTAssertEqual(e.kind, .output)
        XCTAssertNil(e.command)
        XCTAssertNil(e.exitCode)
    }

    func testEventZeroExitCodeIsNotFailed() throws {
        let e = try decode(Event.self, #"{ "seq": 3, "ts": "", "kind": "command", "text": "ls", "command": "ls", "exitCode": 0 }"#)
        XCTAssertEqual(e.exitCode, 0)
        XCTAssertFalse(e.failed)
    }

    func testAllSpecKindsDecode() throws {
        for kind in ["user", "assistant", "command", "output", "tool", "system"] {
            let e = try decode(Event.self, #"{ "seq": 1, "ts": "", "kind": "\#(kind)", "text": "" }"#)
            XCTAssertEqual(e.kind.rawValue, kind)
        }
    }

    func testUnknownKindFallsBackToSystem() throws {
        let e = try decode(Event.self, #"{ "seq": 4, "ts": "", "kind": "thinking", "text": "x" }"#)
        XCTAssertEqual(e.kind, .system)
    }

    func testEventMissingSeqFails() {
        XCTAssertThrowsError(try decode(Event.self, #"{ "ts": "", "kind": "user", "text": "x" }"#))
    }

    func testEventsResponse() throws {
        let r = try decode(EventsResponse.self, """
        { "events": [
          { "seq": 1, "ts": "2026-10-20T17:04:05Z", "kind": "user", "text": "hi" },
          { "seq": 2, "ts": "2026-10-20T17:04:06Z", "kind": "command", "text": "ls", "command": "ls", "exitCode": 0 }
        ] }
        """)
        XCTAssertEqual(r.events.map(\.seq), [1, 2])
    }

    func testHealthResponse() throws {
        let h = try decode(HealthResponse.self, #"{ "ok": true, "name": "Chris-Mac", "version": "1" }"#)
        XCTAssertTrue(h.ok)
        XCTAssertEqual(h.name, "Chris-Mac")
        XCTAssertEqual(h.version, "1")
    }

    // MARK: Stream messages

    func testStreamHello() throws {
        let m = try StreamMessage.decode(Data(#"{ "type": "hello", "name": "Mac", "version": "1" }"#.utf8))
        XCTAssertEqual(m, .hello(name: "Mac", version: "1"))
    }

    func testStreamSession() throws {
        let m = try StreamMessage.decode(Data("""
        { "type": "session", "session": { "id": "a", "tool": "claude", "project": "p", "title": "t",
          "updatedAt": "2026-10-20T17:00:00Z", "live": true, "eventCount": 3 } }
        """.utf8))
        guard case .session(let s) = m else { return XCTFail("expected session, got \(m)") }
        XCTAssertEqual(s.key, "claude/a")
        XCTAssertEqual(s.eventCount, 3)
    }

    func testStreamEvent() throws {
        let m = try StreamMessage.decode(Data("""
        { "type": "event", "tool": "codex", "sessionId": "r1",
          "event": { "seq": 9, "ts": "2026-10-20T17:00:00Z", "kind": "output", "text": "done" } }
        """.utf8))
        guard case let .event(tool, sid, e) = m else { return XCTFail("expected event, got \(m)") }
        XCTAssertEqual(tool, "codex")
        XCTAssertEqual(sid, "r1")
        XCTAssertEqual(e.seq, 9)
        XCTAssertNil(e.exitCode)
    }

    func testStreamUnknownType() throws {
        let m = try StreamMessage.decode(Data(#"{ "type": "pong" }"#.utf8))
        XCTAssertEqual(m, .unknown("pong"))
    }

    func testSubscribeMessageEncodesSpecShape() throws {
        let data = try JSONEncoder().encode(SubscriptionMessage.subscribe(tool: "claude", sessionId: "abc"))
        let obj = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: String])
        XCTAssertEqual(obj, ["type": "subscribe", "tool": "claude", "sessionId": "abc"])
        let un = try JSONEncoder().encode(SubscriptionMessage.unsubscribe(tool: "codex", sessionId: "x"))
        let obj2 = try XCTUnwrap(JSONSerialization.jsonObject(with: un) as? [String: String])
        XCTAssertEqual(obj2["type"], "unsubscribe")
    }

    // MARK: URLs

    func testRequestCarriesBearerAndPagingQuery() throws {
        let api = BridgeAPI(mac: PairedMac(host: "192.168.1.20", port: 7878, name: "Mac"), token: "abc123")
        let req = try api.request(path: "/v1/sessions/claude/\(BridgeAPI.segment("id 1"))/events",
                                  query: [URLQueryItem(name: "after", value: "5"), URLQueryItem(name: "limit", value: "500")])
        XCTAssertEqual(req.url?.absoluteString, "http://192.168.1.20:7878/v1/sessions/claude/id%201/events?after=5&limit=500")
        XCTAssertEqual(req.value(forHTTPHeaderField: "Authorization"), "Bearer abc123")
    }

    func testStreamURLCarriesToken() {
        let url = BridgeSocket.streamURL(mac: PairedMac(host: "10.0.0.2", port: 7878, name: "Mac"), token: "deadbeef")
        XCTAssertEqual(url?.absoluteString, "ws://10.0.0.2:7878/v1/stream?token=deadbeef")
    }

    func testIPv6HostIsBracketed() {
        XCTAssertEqual(PairedMac.urlHost("fe80::1"), "[fe80::1]")
        XCTAssertEqual(PairedMac.urlHost("192.168.1.2"), "192.168.1.2")
    }
}
