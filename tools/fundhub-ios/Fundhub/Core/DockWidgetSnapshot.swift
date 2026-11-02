import Foundation
import WidgetKit

// The signed-in app owns the network request. The extension only reads the
// sanitized App Group file; the bearer never crosses that boundary.
@MainActor
enum DockWidgetSnapshot {
    private static let group = "group.ai.fundhub.app"
    private static let filename = "role-snapshot.json"
    private static let widgetKind = "FundhubRoleWidget"
    private static var currentBearer: String?
    private static var generation = 0
    private static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieStorage = nil
        return URLSession(configuration: configuration)
    }()

    static func refresh(bearer: String) async throws {
        guard !bearer.isEmpty else { clear(); return }
        // A new account must not inherit the previous account's widget data.
        if currentBearer != bearer {
            removeSnapshot()
            currentBearer = bearer
        }
        generation += 1
        let requestGeneration = generation

        var request = URLRequest(url: URL(string: "/api/read/dock", relativeTo: FundhubAPI.base)!.absoluteURL)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        request.timeoutInterval = 15

        let (data, response) = try await session.data(for: request)
        guard generation == requestGeneration, currentBearer == bearer else { return }
        guard let response = response as? HTTPURLResponse else { throw SnapshotError.invalidResponse }
        if response.statusCode == 401 {
            clear()
            throw SnapshotError.invalidSession
        }
        guard (200..<300).contains(response.statusCode) else { throw SnapshotError.invalidResponse }
        let feed = try JSONDecoder().decode(DockFeed.self, from: data)
        guard let snapshot = makeSnapshot(from: feed) else { throw SnapshotError.invalidResponse }
        guard generation == requestGeneration, currentBearer == bearer else { return }
        guard let url = snapshotURL else { throw SnapshotError.appGroupUnavailable }

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let snapshotData = try encoder.encode(snapshot)
        // This remains readable to a Lock Screen widget after the first device unlock.
        try snapshotData.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        WidgetCenter.shared.reloadTimelines(ofKind: widgetKind)
    }

    static func clear() {
        generation += 1
        currentBearer = nil
        removeSnapshot()
    }

    private static var snapshotURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)?
            .appendingPathComponent(filename, isDirectory: false)
    }

    private static func removeSnapshot() {
        if let url = snapshotURL { try? FileManager.default.removeItem(at: url) }
        WidgetCenter.shared.reloadTimelines(ofKind: widgetKind)
    }

    private static func makeSnapshot(from feed: DockFeed) -> Snapshot? {
        guard feed.ok, let generatedAt = parseDate(feed.generatedAt),
              generatedAt <= Date().addingTimeInterval(300),
              generatedAt > Date().addingTimeInterval(-3_600),
              feed.identity.kind == "staff" || feed.identity.kind == "client" else {
            return nil
        }
        let allowedRoles = Set(feed.identity.roles.filter { role in
            staffRoles.contains(role) || role == "client"
        })
        let roles = feed.identity.kind == "client"
            ? (allowedRoles.contains("client") ? ["client"] : [])
            : feed.identity.roles.filter { staffRoles.contains($0) }
        guard !roles.isEmpty else { return nil }

        var items: [SnapshotCount] = []
        for section in feed.sections where roles.contains(section.role) {
            for metric in section.metrics {
                guard metric.unit == "count", let count = validCount(metric.value), count > 0,
                      let kind = kind(for: metric.key, role: section.role) else { continue }
                items.append(SnapshotCount(role: section.role, kind: kind, count: count))
            }
            if section.role == "client" && section.items.contains(where: { $0.id.hasPrefix("waypoint:") }) {
                items.append(SnapshotCount(role: "client", kind: "next_step", count: 1))
            }
        }
        return Snapshot(version: 1, audience: feed.identity.kind,
                        roles: roles, updatedAt: generatedAt, items: items)
    }

    private static let staffRoles: Set<String> = [
        "owner", "admin", "sales_manager", "setter", "closer", "outbound_rep",
        "inquiry_specialist", "funding_advisor", "csm"
    ]

    private static func kind(for key: String, role: String) -> String? {
        switch (role, key) {
        case (_, "open_tasks"): "next_step"
        case ("owner", "booked_calls"), ("admin", "booked_calls"): "booked_calls"
        case ("owner", "funded_count"), ("admin", "funded_count"): "funded_files"
        case ("owner", "approvals_waiting"), ("admin", "approvals_waiting"): "approvals"
        case ("owner", "ai_run_errors"), ("admin", "ai_run_errors"): "ai_ops"
        case ("sales_manager", "deposits_today"): "deposits_today"
        case ("setter", "dials"): "dials_today"
        case ("setter", "booked"): "booked_today"
        case ("closer", "deposits"): "deposits_month"
        case ("outbound_rep", "due_now"): "outreach"
        case ("outbound_rep", "replies_waiting"): "bank_replies"
        case ("client", "documents_on_file"): "files"
        default: nil
        }
    }

    private static func validCount(_ value: Double?) -> Int? {
        guard let value, value.isFinite, value >= 0, value <= 999,
              value.rounded(.towardZero) == value else { return nil }
        return Int(value)
    }

    private static func parseDate(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value)
    }
}

private enum SnapshotError: Error {
    case invalidResponse, invalidSession, appGroupUnavailable
}

private struct DockFeed: Decodable {
    let ok: Bool
    let generatedAt: String
    let identity: DockIdentity
    let sections: [DockSection]
}

private struct DockIdentity: Decodable {
    let kind: String
    let roles: [String]
}

private struct DockSection: Decodable {
    let role: String
    let metrics: [DockMetric]
    let items: [DockItem]
}

private struct DockMetric: Decodable {
    let key: String
    let value: Double?
    let unit: String
}

private struct DockItem: Decodable {
    let id: String
}

private struct Snapshot: Encodable {
    let version: Int
    let audience: String
    let roles: [String]
    let updatedAt: Date
    let items: [SnapshotCount]
}

private struct SnapshotCount: Encodable {
    let role: String
    let kind: String
    let count: Int
}
