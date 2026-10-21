import SwiftUI
import XCTest
@testable import MacBridge

/// Cursor is the third tool (added 2026-10-20): `tool` is `claude`, `codex` or `cursor`.
final class CursorTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    func testCursorSessionDecodes() throws {
        let s = try decode(Session.self, """
        { "id": "9b2e-chat", "tool": "cursor", "project": "fundhub-platform", "title": "Fix the badge",
          "updatedAt": "2026-10-20T18:00:00Z", "live": true, "eventCount": 4 }
        """)
        XCTAssertEqual(s.tool, "cursor")
        XCTAssertEqual(s.toolLabel, "Cursor")
        XCTAssertEqual(s.key, "cursor/9b2e-chat")
    }

    func testCursorEventStreamMessage() throws {
        // Cursor shell calls come as `command` with no `output` and no exit code.
        let m = try StreamMessage.decode(Data("""
        { "type": "event", "tool": "cursor", "sessionId": "9b2e-chat",
          "event": { "seq": 3, "ts": "", "kind": "command", "text": "npm test", "command": "npm test" } }
        """.utf8))
        guard case let .event(tool, sid, e) = m else { return XCTFail("expected event, got \(m)") }
        XCTAssertEqual(tool, "cursor")
        XCTAssertEqual(sid, "9b2e-chat")
        XCTAssertEqual(e.kind, .command)
        XCTAssertNil(e.exitCode)
        XCTAssertFalse(e.failed)
    }

    func testCursorTaskDecodesAndExplainsMissingAgent() throws {
        let t = try decode(BridgeTask.self, """
        { "id": "c1", "tool": "cursor", "pickedBy": "you", "pickReason": "You picked Cursor.", "prompt": "p",
          "status": "failed", "sessionId": null, "startedAt": "2026-10-20T18:00:00Z",
          "endedAt": "2026-10-20T18:00:01Z", "exitCode": null, "error": "cursor_not_found" }
        """)
        XCTAssertEqual(t.toolLabel, "Cursor")
        XCTAssertNil(t.pickSummary)
        XCTAssertEqual(t.problem, "Cursor's agent is not installed on the Mac.")
        let running = try decode(BridgeTask.self, #"{ "id": "c2", "tool": "cursor", "prompt": "p", "status": "running", "sessionId": "chat-7", "startedAt": "" }"#)
        XCTAssertEqual(running.placeholderSession()?.key, "cursor/chat-7")
    }

    func testCursorTaskStreamMessage() throws {
        let m = try StreamMessage.decode(Data("""
        { "type": "task", "task": { "id": "c3", "tool": "cursor", "pickedBy": "rules", "pickReason": "Cursor chat stays in Cursor.",
          "prompt": "p", "status": "running", "sessionId": "chat-7", "startedAt": "2026-10-20T18:00:00Z" } }
        """.utf8))
        guard case .task(let t) = m else { return XCTFail("expected task, got \(m)") }
        XCTAssertEqual(t.tool, "cursor")
        XCTAssertEqual(t.pickSummary, "Picked by the repo rules: Cursor chat stays in Cursor.")
    }

    func testPickerOrderIsClaudeCodexCursorAuto() {
        XCTAssertEqual(TaskTool.allCases.map(\.label), ["Claude", "Codex", "Cursor", "Auto"])
        XCTAssertEqual(TaskTool.cursor.rawValue, "cursor")
    }

    func testCursorNewTaskAndReplyBodies() throws {
        let newData = try JSONEncoder().encode(NewTaskRequest.newTask(tool: .cursor, prompt: "go"))
        let newObj = try XCTUnwrap(JSONSerialization.jsonObject(with: newData) as? [String: String])
        XCTAssertEqual(newObj, ["tool": "cursor", "prompt": "go"])

        let s = Session(id: "chat-7", tool: "cursor", project: "p", title: "t", updatedAt: "", live: false, eventCount: 1)
        let replyData = try JSONEncoder().encode(NewTaskRequest.reply(to: s, prompt: "more"))
        let replyObj = try XCTUnwrap(JSONSerialization.jsonObject(with: replyData) as? [String: String])
        XCTAssertEqual(replyObj, ["tool": "cursor", "prompt": "more", "resumeSessionId": "chat-7"])
        // The reply box reads "Reply to Cursor".
        XCTAssertEqual("Reply to \(s.toolLabel)", "Reply to Cursor")
    }

    func testEveryToolHasItsOwnLabelAndColor() {
        XCTAssertEqual(ToolName.all.map(ToolName.label), ["Claude", "Codex", "Cursor"])
        let colors = ToolName.all.map(ToolBadge.tint(for:))
        XCTAssertEqual(Set(colors.map(\.description)).count, 3)
        XCTAssertEqual(ToolBadge.tint(for: "cursor"), .purple)
        XCTAssertEqual(ToolBadge.tint(for: "other"), .gray)
    }

    func testTooLargeBodyIsRejectedInPlainWords() {
        XCTAssertEqual(BridgeError.from(status: 413, body: Data(#"{"error":"too_large"}"#.utf8)), .rejected("too_large"))
    }
}
