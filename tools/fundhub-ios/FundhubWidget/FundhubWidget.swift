import SwiftUI
import WidgetKit

// The host app writes only generic, role-scoped counts here. Never share names,
// messages, document contents, or credentials with the widget extension.
private enum WidgetSnapshotStore {
    static let appGroup = "group.ai.fundhub.app"
    static let filename = "role-snapshot.json"

    static func read() -> RoleSnapshot? {
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup),
              let data = try? Data(contentsOf: container.appendingPathComponent(filename)) else {
            return nil
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let snapshot = try? decoder.decode(RoleSnapshot.self, from: data),
              snapshot.version == 1,
              snapshot.updatedAt <= Date().addingTimeInterval(300),
              snapshot.updatedAt > Date().addingTimeInterval(-86_400) else {
            return nil
        }
        return snapshot
    }
}

// Contract for role-snapshot.json (ISO 8601 updatedAt):
// {"version":1,"audience":"staff","roles":["owner"],
//  "updatedAt":"2026-11-02T00:00:00Z",
//  "items":[{"role":"owner","kind":"approvals","count":2}]}
// Unknown kinds and roles are dropped so server text cannot appear on a lock screen.
private struct RoleSnapshot: Decodable {
    let version: Int
    let audience: String
    let roles: [String]
    let updatedAt: Date
    let items: [SnapshotItem]

    var visibleItems: [SnapshotItem] {
        let allowedRoles = Set(roles.filter { WidgetRole.isKnown($0) && $0 != "client" })
        guard audience == "staff" || audience == "client" else { return [] }
        return items.filter { item in
            item.count > 0 && item.count <= 999 &&
            WidgetKind(rawValue: item.kind) != nil &&
            (audience == "client"
             ? roles.contains("client") && item.role == "client" && WidgetKind.clientKinds.contains(item.kind)
             : allowedRoles.contains(item.role))
        }.sorted { lhs, rhs in
            let left = WidgetKind(rawValue: lhs.kind)?.priority ?? 99
            let right = WidgetKind(rawValue: rhs.kind)?.priority ?? 99
            return left == right ? lhs.count > rhs.count : left < right
        }
    }

    var isStale: Bool { Date().timeIntervalSince(updatedAt) > 3_600 }
    var roleCount: Int { Set(roles.filter(WidgetRole.isKnown)).count }
}

private struct SnapshotItem: Decodable {
    let role: String
    let kind: String
    let count: Int
}

private enum WidgetRole {
    static func isKnown(_ value: String) -> Bool {
        ["owner", "admin", "setter", "closer", "sales_manager", "outbound_rep",
         "inquiry_specialist", "funding_advisor", "csm", "client"].contains(value)
    }

    static func title(_ value: String) -> String {
        switch value {
        case "owner": "Founder"
        case "admin": "Admin"
        case "setter": "Setter"
        case "closer": "Closer"
        case "sales_manager": "Sales manager"
        case "outbound_rep": "Bank relations"
        case "inquiry_specialist": "Inquiry removal"
        case "funding_advisor": "Funding advisor"
        case "csm": "Service"
        default: "Client"
        }
    }
}

private enum WidgetKind: String {
    case approvals, atRisk = "at_risk", nextCalls = "next_calls"
    case outreach, documents, funding, service, aiOps = "ai_ops"
    case marketing, updates, nextStep = "next_step", advisor, files
    case bookedCalls = "booked_calls", bookedToday = "booked_today"
    case dialsToday = "dials_today", depositsToday = "deposits_today"
    case depositsMonth = "deposits_month", fundedFiles = "funded_files"
    case bankReplies = "bank_replies"

    static let clientKinds: Set<String> = ["documents", "funding", "updates", "next_step", "advisor", "files"]

    var title: String {
        switch self {
        case .approvals: "Approvals waiting"
        case .atRisk: "Needs attention"
        case .nextCalls: "Calls coming up"
        case .outreach: "Follow-ups due"
        case .documents: "Documents needed"
        case .funding: "Funding updates"
        case .service: "Service replies"
        case .aiOps: "AI ops alerts"
        case .marketing: "Marketing alerts"
        case .updates: "New updates"
        case .nextStep: "Next steps"
        case .advisor: "Advisor replies"
        case .files: "Documents on file"
        case .bookedCalls: "Booked calls"
        case .bookedToday: "Booked today"
        case .dialsToday: "Dials today"
        case .depositsToday: "Deposits today"
        case .depositsMonth: "Deposits this month"
        case .fundedFiles: "Funded files"
        case .bankReplies: "Bank replies waiting"
        }
    }

    var symbol: String {
        switch self {
        case .approvals: "checkmark.seal"
        case .atRisk: "exclamationmark.circle"
        case .nextCalls: "phone"
        case .outreach: "arrow.turn.up.right"
        case .documents: "doc"
        case .funding: "banknote"
        case .service: "bubble.left"
        case .aiOps: "sparkles"
        case .marketing: "chart.bar"
        case .updates: "bell"
        case .nextStep: "arrow.right.circle"
        case .advisor: "person.crop.circle"
        case .files: "doc.on.doc"
        case .bookedCalls, .bookedToday: "calendar.badge.clock"
        case .dialsToday: "phone.arrow.up.right"
        case .depositsToday, .depositsMonth: "dollarsign.circle"
        case .fundedFiles: "banknote"
        case .bankReplies: "envelope.badge"
        }
    }

    var priority: Int {
        switch self {
        case .atRisk, .aiOps: 0
        case .approvals, .documents, .service, .nextStep: 1
        case .bankReplies: 1
        case .nextCalls, .outreach, .advisor: 2
        case .funding, .marketing, .updates, .files,
             .bookedCalls, .bookedToday, .dialsToday,
             .depositsToday, .depositsMonth, .fundedFiles: 3
        }
    }
}

private struct RoleEntry: TimelineEntry {
    let date: Date
    let snapshot: RoleSnapshot?
}

private struct RoleProvider: TimelineProvider {
    func placeholder(in context: Context) -> RoleEntry { RoleEntry(date: .now, snapshot: nil) }
    func getSnapshot(in context: Context, completion: @escaping (RoleEntry) -> Void) {
        completion(RoleEntry(date: .now, snapshot: WidgetSnapshotStore.read()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<RoleEntry>) -> Void) {
        completion(Timeline(entries: [RoleEntry(date: .now, snapshot: WidgetSnapshotStore.read())],
                            policy: .after(Date().addingTimeInterval(900))))
    }
}

private enum FundhubWidgetStyle {
    static let ink = Color(red: 13 / 255, green: 17 / 255, blue: 19 / 255)
    static let paper = Color(red: 248 / 255, green: 248 / 255, blue: 246 / 255)
    static let muted = Color(red: 98 / 255, green: 105 / 255, blue: 104 / 255)
    static let spectrum = LinearGradient(colors: [
        Color(red: 242 / 255, green: 166 / 255, blue: 155 / 255),
        Color(red: 245 / 255, green: 206 / 255, blue: 143 / 255),
        Color(red: 242 / 255, green: 227 / 255, blue: 155 / 255),
        Color(red: 168 / 255, green: 216 / 255, blue: 176 / 255),
        Color(red: 169 / 255, green: 198 / 255, blue: 232 / 255),
        Color(red: 196 / 255, green: 179 / 255, blue: 229 / 255)
    ],
                                         startPoint: .leading, endPoint: .trailing)
}

private struct HomeWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: RoleEntry

    private var items: [SnapshotItem] { entry.snapshot?.visibleItems ?? [] }
    private var maximumRows: Int { family == .systemMedium ? 3 : 2 }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text("f.").font(.system(size: 18, weight: .black, design: .rounded))
                    .frame(width: 27, height: 27)
                    .background(FundhubWidgetStyle.ink, in: RoundedRectangle(cornerRadius: 7))
                    .foregroundStyle(.white)
                Text("fundhub").font(.system(size: 14, weight: .bold, design: .rounded))
                Spacer(minLength: 2)
                if let snapshot = entry.snapshot, snapshot.roleCount > 1 {
                    Text("\(snapshot.roleCount) roles")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(FundhubWidgetStyle.muted)
                }
            }
            if let snapshot = entry.snapshot, snapshot.isStale {
                Text("Update delayed · Open Fundhub")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(FundhubWidgetStyle.muted)
            } else if items.isEmpty {
                Text(entry.snapshot == nil ? "Open Fundhub to sync" : "No items to show")
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                    .padding(.top, 10)
            } else {
                ForEach(Array(items.prefix(maximumRows).enumerated()), id: \.offset) { _, item in
                    if let kind = WidgetKind(rawValue: item.kind) {
                        HStack(spacing: 6) {
                            Image(systemName: kind.symbol)
                                .frame(width: 17)
                                .foregroundStyle(FundhubWidgetStyle.ink)
                            Text((entry.snapshot?.roleCount ?? 0) > 1 && family == .systemMedium
                                 ? "\(WidgetRole.title(item.role)) · \(kind.title)" : kind.title)
                                .lineLimit(1)
                            Spacer(minLength: 2)
                            Text("\(item.count)").fontWeight(.bold)
                        }
                        .font(.system(size: 12, weight: .medium))
                        .privacySensitive()
                    }
                }
                if items.count > maximumRows {
                    Text("+\(items.count - maximumRows) more")
                        .font(.system(size: 10))
                        .foregroundStyle(FundhubWidgetStyle.muted)
                }
            }
            Spacer(minLength: 0)
            HStack {
                if let snapshot = entry.snapshot {
                    Text("Updated ") + Text(snapshot.updatedAt, style: .relative)
                } else {
                    Text("No recent update")
                }
                Spacer()
            }
            .font(.system(size: 10))
            .foregroundStyle(FundhubWidgetStyle.muted)
            Rectangle().fill(FundhubWidgetStyle.spectrum).frame(height: 3)
        }
        .foregroundStyle(FundhubWidgetStyle.ink)
        .containerBackground(FundhubWidgetStyle.paper, for: .widget)
    }
}

private struct LockWidgetView: View {
    let entry: RoleEntry

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "square.stack.3d.up.fill")
            if let snapshot = entry.snapshot, !snapshot.isStale,
               let item = snapshot.visibleItems.first,
               let kind = WidgetKind(rawValue: item.kind) {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Fundhub · \(item.count) need action")
                        .font(.system(size: 12, weight: .semibold))
                        .privacySensitive()
                    Text(kind.title).font(.system(size: 10)).privacySensitive()
                }
            } else if entry.snapshot?.isStale == false {
                Text("Fundhub · No items to show").font(.system(size: 12, weight: .semibold))
            } else {
                Text("Fundhub · Open to sync").font(.system(size: 12, weight: .semibold))
            }
        }
        .lineLimit(1)
        .containerBackground(.clear, for: .widget)
    }
}

private struct FundhubRoleWidget: Widget {
    let kind = "FundhubRoleWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: RoleProvider()) { entry in
            if #available(iOS 17.0, *) {
                WidgetFamilyView(entry: entry)
            }
        }
        .configurationDisplayName("Fundhub status")
        .description("See the work that needs your attention.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
    }
}

private struct WidgetFamilyView: View {
    @Environment(\.widgetFamily) private var family
    let entry: RoleEntry

    var body: some View {
        if family == .accessoryRectangular {
            LockWidgetView(entry: entry)
        } else {
            HomeWidgetView(entry: entry)
        }
    }
}

@main
private struct FundhubWidgets: WidgetBundle {
    var body: some Widget { FundhubRoleWidget() }
}
