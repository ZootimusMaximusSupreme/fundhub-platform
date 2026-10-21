import XCTest
@testable import MacBridge

/// v2 tasks: docs/specs/mac-bridge-protocol-v2-tasks.md.
final class TaskTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    private func object(_ body: NewTaskRequest) throws -> [String: String] {
        let data = try JSONEncoder().encode(body)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: String])
    }

    private let mac = PairedMac(host: "192.168.1.20", port: 7878, name: "Mac")

    private func session(id: String = "s-1", tool: String = "claude", eventCount: Int = 5) -> Session {
        Session(id: id, tool: tool, project: "fundhub-platform", title: "t",
                updatedAt: "2026-10-20T17:00:00Z", live: true, eventCount: eventCount)
    }

    // MARK: Task decode

    func testTaskDecodesSpecFixture() throws {
        let t = try decode(BridgeTask.self, """
        { "id": "t1", "tool": "codex", "pickedBy": "rules", "pickReason": "AGENTS.md: Codex builds",
          "prompt": "Build the thing\\nwith two lines", "status": "running", "sessionId": "abc-123",
          "startedAt": "2026-10-20T17:04:05.123Z", "endedAt": null, "exitCode": null, "error": null }
        """)
        XCTAssertEqual(t.id, "t1")
        XCTAssertEqual(t.tool, "codex")
        XCTAssertEqual(t.toolLabel, "Codex")
        XCTAssertEqual(t.pickedBy, "rules")
        XCTAssertEqual(t.pickReason, "AGENTS.md: Codex builds")
        XCTAssertEqual(t.status, .running)
        XCTAssertTrue(t.status.isActive)
        XCTAssertEqual(t.sessionId, "abc-123")
        XCTAssertNotNil(t.startedDate)
        XCTAssertNil(t.endedAt)
        XCTAssertNil(t.exitCode)
        XCTAssertNil(t.error)
        XCTAssertEqual(t.firstLine, "Build the thing")
    }

    func testEveryStatusDecodes() throws {
        let active: Set<TaskStatus> = [.starting, .running]
        for raw in ["starting", "running", "done", "failed", "stopped"] {
            let t = try decode(BridgeTask.self, #"{ "id": "x", "tool": "claude", "prompt": "p", "status": "\#(raw)", "startedAt": "2026-10-20T17:00:00Z" }"#)
            XCTAssertEqual(t.status.rawValue, raw)
            XCTAssertEqual(t.status.isActive, active.contains(t.status), raw)
        }
        XCTAssertEqual(TaskStatus.allCases.count, 5)
    }

    func testFinishedTaskWithAllNullsAndMissingPickFields() throws {
        let t = try decode(BridgeTask.self, """
        { "id": "t2", "tool": "claude", "prompt": "p", "status": "done", "sessionId": null,
          "startedAt": "2026-10-20T17:00:00Z", "endedAt": "2026-10-20T17:05:00Z", "exitCode": 0, "error": null }
        """)
        XCTAssertEqual(t.status, .done)
        XCTAssertFalse(t.status.isActive)
        XCTAssertNil(t.sessionId)
        XCTAssertNil(t.pickedBy)
        XCTAssertNil(t.pickReason)
        XCTAssertEqual(t.endedAt, "2026-10-20T17:05:00Z")
        XCTAssertEqual(t.exitCode, 0)
        XCTAssertNil(t.problem)
        XCTAssertNil(t.placeholderSession())
    }

    func testFailedTasksExplainThemselves() throws {
        let failed = try decode(BridgeTask.self, #"{ "id": "f", "tool": "codex", "prompt": "p", "status": "failed", "startedAt": "", "exitCode": 1, "error": "codex_not_found" }"#)
        XCTAssertEqual(failed.problem, "Codex is not installed on the Mac.")
        let failedCode = try decode(BridgeTask.self, #"{ "id": "g", "tool": "claude", "prompt": "p", "status": "failed", "startedAt": "", "exitCode": 2, "error": null }"#)
        XCTAssertEqual(failedCode.problem, "It failed with exit code 2.")
        let stopped = try decode(BridgeTask.self, #"{ "id": "s", "tool": "claude", "prompt": "p", "status": "stopped", "startedAt": "", "exitCode": 130 }"#)
        XCTAssertNil(stopped.problem)
    }

    func testUnknownStatusIsNotActive() throws {
        let t = try decode(BridgeTask.self, #"{ "id": "u", "tool": "claude", "prompt": "p", "status": "paused", "startedAt": "" }"#)
        XCTAssertFalse(t.status.isActive)
        // "blocked" was dropped from the contract (owner, 2026-10-20); an old helper saying it reads as finished.
        let old = try decode(BridgeTask.self, #"{ "id": "o", "tool": "claude", "prompt": "p", "status": "blocked", "startedAt": "" }"#)
        XCTAssertFalse(old.status.isActive)
    }

    func testTaskMissingIdFails() {
        XCTAssertThrowsError(try decode(BridgeTask.self, #"{ "tool": "claude", "prompt": "p", "status": "running" }"#))
    }

    func testPickSummaryOnlyForAutoPicks() throws {
        let rules = try decode(BridgeTask.self, #"{ "id": "a", "tool": "claude", "pickedBy": "rules", "pickReason": "rules do not decide, so Claude", "prompt": "p", "status": "running", "startedAt": "" }"#)
        XCTAssertTrue(rules.wasAutoPicked)
        XCTAssertEqual(rules.pickSummary, "Picked by the repo rules: rules do not decide, so Claude")
        let jev = try decode(BridgeTask.self, #"{ "id": "j", "tool": "codex", "pickedBy": "jev", "pickReason": "", "prompt": "p", "status": "running", "startedAt": "" }"#)
        XCTAssertEqual(jev.pickSummary, "Picked by Jev")
        let you = try decode(BridgeTask.self, #"{ "id": "y", "tool": "codex", "pickedBy": "you", "pickReason": "you picked Codex", "prompt": "p", "status": "running", "startedAt": "" }"#)
        XCTAssertFalse(you.wasAutoPicked)
        XCTAssertNil(you.pickSummary)
    }

    func testTasksAndTaskResponses() throws {
        let list = try decode(TasksResponse.self, """
        { "tasks": [
          { "id": "b", "tool": "codex", "pickedBy": "you", "pickReason": "", "prompt": "two", "status": "running", "sessionId": null, "startedAt": "2026-10-20T17:01:00Z", "endedAt": null, "exitCode": null, "error": null },
          { "id": "a", "tool": "claude", "pickedBy": "you", "pickReason": "", "prompt": "one", "status": "done", "sessionId": "s1", "startedAt": "2026-10-20T17:00:00Z", "endedAt": "2026-10-20T17:00:30Z", "exitCode": 0, "error": null }
        ] }
        """)
        XCTAssertEqual(list.tasks.map(\.id), ["b", "a"])
        let one = try decode(TaskResponse.self, #"{ "task": { "id": "c", "tool": "claude", "prompt": "x", "status": "starting", "sessionId": null, "startedAt": "2026-10-20T17:02:00Z" } }"#)
        XCTAssertEqual(one.task.status, .starting)
    }

    // MARK: Request bodies

    func testNewTaskBodyHasNoResumeKey() throws {
        let obj = try object(.newTask(tool: .auto, prompt: "Fix the build"))
        XCTAssertEqual(obj, ["tool": "auto", "prompt": "Fix the build"])
        XCTAssertNil(obj["resumeSessionId"])
        XCTAssertEqual(try object(.newTask(tool: .codex, prompt: "x"))["tool"], "codex")
        XCTAssertEqual(try object(.newTask(tool: .claude, prompt: "x"))["tool"], "claude")
    }

    func testReplyBodyResumesSameSessionWithSameTool() throws {
        let codex = try object(.reply(to: session(id: "rollout-9", tool: "codex"), prompt: "now add tests"))
        XCTAssertEqual(codex, ["tool": "codex", "prompt": "now add tests", "resumeSessionId": "rollout-9"])
        let claude = try object(.reply(to: session(id: "3f1c", tool: "claude"), prompt: "go on"))
        XCTAssertEqual(claude["tool"], "claude")
        XCTAssertEqual(claude["resumeSessionId"], "3f1c")
    }

    func testPromptLimits() {
        XCTAssertFalse(NewTaskRequest.canSend(""))
        XCTAssertFalse(NewTaskRequest.canSend("  \n "))
        XCTAssertTrue(NewTaskRequest.canSend("hi"))
        XCTAssertTrue(NewTaskRequest.canSend(String(repeating: "a", count: 20_000)))
        XCTAssertFalse(NewTaskRequest.canSend(String(repeating: "a", count: 20_001)))
    }

    func testStartTaskRequestIsAuthorizedJSONPost() throws {
        let api = BridgeAPI(mac: mac, token: "abc123")
        let req = try api.startTaskRequest(.reply(to: session(id: "s-1"), prompt: "hello"))
        XCTAssertEqual(req.httpMethod, "POST")
        XCTAssertEqual(req.url?.absoluteString, "http://192.168.1.20:7878/v1/tasks")
        XCTAssertEqual(req.value(forHTTPHeaderField: "Authorization"), "Bearer abc123")
        XCTAssertEqual(req.value(forHTTPHeaderField: "Content-Type"), "application/json")
        let body = try XCTUnwrap(req.httpBody)
        let obj = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: String])
        XCTAssertEqual(obj, ["tool": "claude", "prompt": "hello", "resumeSessionId": "s-1"])
    }

    func testStopTaskRequest() throws {
        let api = BridgeAPI(mac: mac, token: "abc123")
        let req = try api.stopTaskRequest(id: "t 1")
        XCTAssertEqual(req.httpMethod, "POST")
        XCTAssertEqual(req.url?.absoluteString, "http://192.168.1.20:7878/v1/tasks/t%201/stop")
        XCTAssertEqual(req.value(forHTTPHeaderField: "Authorization"), "Bearer abc123")
        XCTAssertNil(req.httpBody)
    }

    func testGetStaysGetWithNoBody() throws {
        let req = try BridgeAPI(mac: mac, token: "t").request(path: "/v1/tasks")
        XCTAssertEqual(req.httpMethod, "GET")
        XCTAssertNil(req.httpBody)
    }

    // MARK: Error mapping

    func testUnexpectedErrorIsGenericWithTheCode() {
        let err = BridgeError.from(status: 422, body: Data(#"{"error":"something"}"#.utf8))
        XCTAssertEqual(err, .http(422))
        XCTAssertEqual(err?.errorDescription, "The Mac answered with error 422.")
        XCTAssertEqual(BridgeError.from(status: 503, body: Data()), .http(503))
    }

    func testBusyUnauthorizedAndOthers() {
        XCTAssertEqual(BridgeError.from(status: 429, body: Data(#"{"error":"busy"}"#.utf8)), .busy)
        XCTAssertEqual(BridgeError.from(status: 429, body: Data()), .busy)
        XCTAssertTrue(BridgeError.busy.errorDescription?.contains("3 tasks") ?? false)
        XCTAssertEqual(BridgeError.from(status: 401, body: Data(#"{"error":"unauthorized"}"#.utf8)), .unauthorized)
        XCTAssertEqual(BridgeError.from(status: 404, body: Data(#"{"error":"not_found"}"#.utf8)), .notFound)
        XCTAssertEqual(BridgeError.from(status: 400, body: Data(#"{"error":"prompt_too_long"}"#.utf8)), .rejected("prompt_too_long"))
        XCTAssertEqual(BridgeError.from(status: 500, body: Data("oops".utf8)), .http(500))
        XCTAssertNil(BridgeError.from(status: 202, body: Data()))
        XCTAssertNil(BridgeError.from(status: 200, body: Data()))
    }

    // MARK: WebSocket

    func testStreamTaskMessage() throws {
        let m = try StreamMessage.decode(Data("""
        { "type": "task", "task": { "id": "t9", "tool": "claude", "pickedBy": "rules", "pickReason": "default",
          "prompt": "p", "status": "running", "sessionId": "sess-9", "startedAt": "2026-10-20T17:00:00Z",
          "endedAt": null, "exitCode": null, "error": null } }
        """.utf8))
        guard case .task(let t) = m else { return XCTFail("expected task, got \(m)") }
        XCTAssertEqual(t.id, "t9")
        XCTAssertEqual(t.sessionId, "sess-9")
        XCTAssertEqual(t.status, .running)
    }

    func testStreamTaskMessageWithoutTaskIsUnknown() throws {
        XCTAssertEqual(try StreamMessage.decode(Data(#"{ "type": "task" }"#.utf8)), .unknown("task"))
    }

    // MARK: Live list

    private func task(_ id: String, status: TaskStatus, startedAt: String, sessionId: String? = nil, tool: String = "claude") -> BridgeTask {
        BridgeTask(id: id, tool: tool, pickedBy: "you", pickReason: nil, prompt: "p", status: status,
                   sessionId: sessionId, startedAt: startedAt, endedAt: nil, exitCode: nil, error: nil)
    }

    func testUpsertReplacesByIdAndSortsNewestFirst() {
        var list: [BridgeTask] = []
        list = TaskList.upsert(list, task("a", status: .starting, startedAt: "2026-10-20T17:00:00Z"))
        list = TaskList.upsert(list, task("b", status: .running, startedAt: "2026-10-20T17:05:00Z"))
        list = TaskList.upsert(list, task("a", status: .done, startedAt: "2026-10-20T17:00:00Z", sessionId: "s"))
        XCTAssertEqual(list.map(\.id), ["b", "a"])
        XCTAssertEqual(list[1].status, .done)
        XCTAssertEqual(TaskList.running(list).map(\.id), ["b"])
    }

    func testListIsCappedAt50() {
        var list: [BridgeTask] = []
        for i in 0..<60 {
            list = TaskList.upsert(list, task("t\(i)", status: .done, startedAt: String(format: "2026-10-20T17:%02d:00Z", i)))
        }
        XCTAssertEqual(list.count, 50)
        XCTAssertEqual(list.first?.id, "t59")
    }

    func testActiveTaskForSessionMatchesIdAndTool() {
        let s = session(id: "s1", tool: "claude")
        let list = [
            task("done", status: .done, startedAt: "", sessionId: "s1"),
            task("other-tool", status: .running, startedAt: "", sessionId: "s1", tool: "codex"),
            task("other-session", status: .running, startedAt: "", sessionId: "s2")
        ]
        XCTAssertNil(TaskList.activeTask(in: list, for: s))
        let withMine = list + [task("mine", status: .running, startedAt: "", sessionId: "s1")]
        XCTAssertEqual(TaskList.activeTask(in: withMine, for: s)?.id, "mine")
    }

    func testPlaceholderSessionOpensTheFeed() throws {
        let t = task("n", status: .running, startedAt: "2026-10-20T17:00:00Z", sessionId: "new-1", tool: "codex")
        let s = try XCTUnwrap(t.placeholderSession())
        XCTAssertEqual(s.key, "codex/new-1")
        XCTAssertEqual(s.eventCount, 0)
        XCTAssertTrue(s.live)
    }
}
