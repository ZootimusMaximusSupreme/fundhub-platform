import Foundation

// Wire models for docs/specs/mac-bridge-protocol-v2-tasks.md.
// Field names match the spec exactly. The Swift type is `BridgeTask`
// so it never clashes with Swift's own `Task`.

enum TaskStatus: String, Codable, CaseIterable {
    case starting, running, done, failed, stopped

    /// An unknown status from a newer helper counts as finished, so it never locks the reply box.
    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = TaskStatus(rawValue: raw) ?? .failed
    }

    var isActive: Bool { self == .starting || self == .running }

    var label: String {
        switch self {
        case .starting: return "Starting"
        case .running: return "Working"
        case .done: return "Done"
        case .failed: return "Failed"
        case .stopped: return "Stopped"
        }
    }
}

/// What the phone can ask for. `auto` lets the Mac pick by the repo rules.
enum TaskTool: String, Codable, CaseIterable, Identifiable {
    case claude, codex, cursor, auto

    var id: String { rawValue }

    var label: String {
        switch self {
        case .claude: return "Claude"
        case .codex: return "Codex"
        case .cursor: return "Cursor"
        case .auto: return "Auto"
        }
    }
}

struct BridgeTask: Codable, Equatable, Hashable, Identifiable {
    var id: String
    var tool: String
    var pickedBy: String?
    var pickReason: String?
    var prompt: String
    var status: TaskStatus
    var sessionId: String?
    var startedAt: String
    var endedAt: String?
    var exitCode: Int?
    var error: String?

    enum CodingKeys: String, CodingKey {
        case id, tool, pickedBy, pickReason, prompt, status, sessionId, startedAt, endedAt, exitCode, error
    }

    var startedDate: Date? { BridgeDate.parse(startedAt) }

    var toolLabel: String { ToolName.label(tool) }

    /// First non-empty line of the prompt, for one-line rows.
    var firstLine: String {
        let line = prompt
            .split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .first { !$0.isEmpty }
        return line ?? "(empty prompt)"
    }

    /// True when the Mac picked the tool (the phone sent `auto`), not the person.
    var wasAutoPicked: Bool {
        guard let p = pickedBy, !p.isEmpty else { return false }
        return p != "you"
    }

    /// "Picked by the repo rules: <reason>" — only for auto picks.
    var pickSummary: String? {
        guard wasAutoPicked, let p = pickedBy else { return nil }
        let who: String
        switch p {
        case "rules": who = "Picked by the repo rules"
        case "jev": who = "Picked by Jev"
        default: who = "Picked by \(p)"
        }
        let reason = (pickReason ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return reason.isEmpty ? who : "\(who): \(reason)"
    }

    /// Plain words for a task that ended badly.
    var problem: String? {
        switch status {
        case .failed:
            if let e = error, !e.isEmpty {
                if e == "codex_not_found" { return "Codex is not installed on the Mac." }
                if e == "cursor_not_found" { return "Cursor's agent is not installed on the Mac." }
                return "It failed: \(e)"
            }
            if let c = exitCode, c != 0 { return "It failed with exit code \(c)." }
            return "It failed."
        default:
            return nil
        }
    }

    /// The session this task writes to, as a list row (a stand-in until the list has the real one).
    func placeholderSession(project: String = "") -> Session? {
        guard let sid = sessionId, !sid.isEmpty else { return nil }
        return Session(id: sid, tool: tool, project: project, title: firstLine,
                       updatedAt: startedAt, live: status.isActive, eventCount: 0)
    }
}

extension BridgeTask {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        tool = try c.decodeIfPresent(String.self, forKey: .tool) ?? ""
        pickedBy = try c.decodeIfPresent(String.self, forKey: .pickedBy)
        pickReason = try c.decodeIfPresent(String.self, forKey: .pickReason)
        prompt = try c.decodeIfPresent(String.self, forKey: .prompt) ?? ""
        status = try c.decodeIfPresent(TaskStatus.self, forKey: .status) ?? .failed
        sessionId = try c.decodeIfPresent(String.self, forKey: .sessionId)
        startedAt = try c.decodeIfPresent(String.self, forKey: .startedAt) ?? ""
        endedAt = try c.decodeIfPresent(String.self, forKey: .endedAt)
        exitCode = try c.decodeIfPresent(Int.self, forKey: .exitCode)
        error = try c.decodeIfPresent(String.self, forKey: .error)
    }
}

// MARK: - HTTP bodies

/// `POST /v1/tasks` body. `resumeSessionId` is left out of the JSON when nil.
struct NewTaskRequest: Encodable, Equatable {
    static let maxPromptLength = 20_000

    var tool: String
    var prompt: String
    var resumeSessionId: String?

    enum CodingKeys: String, CodingKey {
        case tool, prompt, resumeSessionId
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(tool, forKey: .tool)
        try c.encode(prompt, forKey: .prompt)
        try c.encodeIfPresent(resumeSessionId, forKey: .resumeSessionId)
    }

    /// A brand new task from the New task screen.
    static func newTask(tool: TaskTool, prompt: String) -> NewTaskRequest {
        NewTaskRequest(tool: tool.rawValue, prompt: prompt, resumeSessionId: nil)
    }

    /// A reply inside an existing session: same tool, resume that session.
    static func reply(to session: Session, prompt: String) -> NewTaskRequest {
        NewTaskRequest(tool: session.tool, prompt: prompt, resumeSessionId: session.id)
    }

    /// Not empty, and not over the Mac's 20,000 character cap.
    static func canSend(_ prompt: String) -> Bool {
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        return !trimmed.isEmpty && prompt.count <= maxPromptLength
    }
}

struct TaskResponse: Codable {
    var task: BridgeTask
}

struct TasksResponse: Codable {
    var tasks: [BridgeTask]
}

// MARK: - The live list

/// Pure list helpers so the app model stays thin and the rules are testable.
enum TaskList {
    static let max = 50

    /// Replace by id (or add), newest first, at most 50.
    static func upsert(_ list: [BridgeTask], _ t: BridgeTask) -> [BridgeTask] {
        var out = list
        if let i = out.firstIndex(where: { $0.id == t.id }) {
            out[i] = t
        } else {
            out.append(t)
        }
        return sorted(out)
    }

    static func sorted(_ list: [BridgeTask]) -> [BridgeTask] {
        let s = list.sorted { a, b in
            let da = a.startedDate ?? .distantPast
            let db = b.startedDate ?? .distantPast
            return da == db ? a.id > b.id : da > db
        }
        return Array(s.prefix(max))
    }

    static func running(_ list: [BridgeTask]) -> [BridgeTask] {
        list.filter { $0.status.isActive }
    }

    /// A task still working on this session (same tool, same session id).
    static func activeTask(in list: [BridgeTask], for session: Session) -> BridgeTask? {
        list.first { $0.status.isActive && $0.sessionId == session.id && $0.tool == session.tool }
    }
}
