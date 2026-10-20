import Foundation

// Wire models for docs/specs/mac-bridge-protocol-v1.md.
// Field names match the spec exactly. Decoding is forgiving: a missing
// optional field never sinks a whole list.

enum EventKind: String, Codable, CaseIterable {
    case user, assistant, command, output, tool, system

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = EventKind(rawValue: raw) ?? .system
    }
}

struct Session: Codable, Equatable, Hashable {
    var id: String
    var tool: String
    var project: String
    var title: String
    var updatedAt: String
    var live: Bool
    var eventCount: Int

    enum CodingKeys: String, CodingKey {
        case id, tool, project, title, updatedAt, live, eventCount
    }

    /// Unique across both tools: "claude/<id>" or "codex/<id>".
    var key: String { SessionKey.make(tool: tool, id: id) }

    var updatedDate: Date? { BridgeDate.parse(updatedAt) }

    var toolLabel: String { ToolName.label(tool) }

    /// The helper sets `live` when the file changed in the last 120 seconds.
    /// A stale copy on the phone stops being live on its own after that.
    func isLive(now: Date = Date()) -> Bool {
        guard live else { return false }
        guard let d = updatedDate else { return true }
        return now.timeIntervalSince(d) < 120
    }
}

extension Session {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        tool = try c.decode(String.self, forKey: .tool)
        project = try c.decodeIfPresent(String.self, forKey: .project) ?? ""
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt) ?? ""
        live = try c.decodeIfPresent(Bool.self, forKey: .live) ?? false
        eventCount = try c.decodeIfPresent(Int.self, forKey: .eventCount) ?? 0
    }
}

struct Event: Codable, Equatable, Hashable, Identifiable {
    var seq: Int
    var ts: String
    var kind: EventKind
    var text: String
    var command: String?
    var exitCode: Int?

    enum CodingKeys: String, CodingKey {
        case seq, ts, kind, text, command, exitCode
    }

    var id: Int { seq }
    var date: Date? { BridgeDate.parse(ts) }

    /// Non-zero exit codes get a red badge.
    var failed: Bool { (exitCode ?? 0) != 0 }
}

extension Event {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        seq = try c.decode(Int.self, forKey: .seq)
        ts = try c.decodeIfPresent(String.self, forKey: .ts) ?? ""
        kind = try c.decodeIfPresent(EventKind.self, forKey: .kind) ?? .system
        text = try c.decodeIfPresent(String.self, forKey: .text) ?? ""
        command = try c.decodeIfPresent(String.self, forKey: .command)
        exitCode = try c.decodeIfPresent(Int.self, forKey: .exitCode)
    }
}

/// The tools the Mac helper knows: `claude`, `codex`, `cursor` (Cursor added 2026-10-20).
/// An unknown tool name still shows, just capitalized.
enum ToolName {
    static let all = ["claude", "codex", "cursor"]

    static func label(_ tool: String) -> String {
        switch tool {
        case "claude": return "Claude"
        case "codex": return "Codex"
        case "cursor": return "Cursor"
        default: return tool.capitalized
        }
    }
}

enum SessionKey {
    static func make(tool: String, id: String) -> String { "\(tool)/\(id)" }
}

// MARK: - HTTP bodies

struct HealthResponse: Codable, Equatable {
    var ok: Bool
    var name: String?
    var version: String?
}

struct SessionsResponse: Codable {
    var sessions: [Session]
}

struct EventsResponse: Codable {
    var events: [Event]
}

struct ErrorResponse: Codable {
    var error: String
}

// MARK: - WebSocket messages

enum StreamMessage: Equatable {
    case hello(name: String, version: String)
    case session(Session)
    case event(tool: String, sessionId: String, event: Event)
    /// v2: `{ "type": "task", "task": Task }` on every task status change.
    case task(BridgeTask)
    case unknown(String)

    private struct Raw: Decodable {
        var type: String
        var name: String?
        var version: String?
        var session: Session?
        var tool: String?
        var sessionId: String?
        var event: Event?
        var task: BridgeTask?
    }

    static func decode(_ data: Data) throws -> StreamMessage {
        let raw = try JSONDecoder().decode(Raw.self, from: data)
        switch raw.type {
        case "hello":
            return .hello(name: raw.name ?? "", version: raw.version ?? "")
        case "session":
            guard let s = raw.session else { return .unknown(raw.type) }
            return .session(s)
        case "event":
            guard let tool = raw.tool, let sid = raw.sessionId, let e = raw.event else { return .unknown(raw.type) }
            return .event(tool: tool, sessionId: sid, event: e)
        case "task":
            guard let t = raw.task else { return .unknown(raw.type) }
            return .task(t)
        default:
            return .unknown(raw.type)
        }
    }
}

/// What the phone sends: subscribe / unsubscribe to one session's events.
struct SubscriptionMessage: Codable, Equatable {
    var type: String
    var tool: String
    var sessionId: String

    static func subscribe(tool: String, sessionId: String) -> SubscriptionMessage {
        SubscriptionMessage(type: "subscribe", tool: tool, sessionId: sessionId)
    }

    static func unsubscribe(tool: String, sessionId: String) -> SubscriptionMessage {
        SubscriptionMessage(type: "unsubscribe", tool: tool, sessionId: sessionId)
    }
}

// MARK: - Dates

enum BridgeDate {
    private static let withFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let plain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    static func parse(_ s: String) -> Date? {
        guard !s.isEmpty else { return nil }
        return withFraction.date(from: s) ?? plain.date(from: s)
    }
}
