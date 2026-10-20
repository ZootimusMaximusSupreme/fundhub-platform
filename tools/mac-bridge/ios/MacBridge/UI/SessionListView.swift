import SwiftUI

struct SessionListView: View {
    @EnvironmentObject private var model: AppModel
    @EnvironmentObject private var socket: BridgeSocket
    @State private var confirmForget = false

    var body: some View {
        NavigationStack {
            List {
                if socket.state == .unauthorized {
                    Section {
                        Label("The Mac rejected this phone's token. Forget this Mac and pair again.", systemImage: "lock.trianglebadge.exclamationmark")
                            .foregroundStyle(.red)
                    }
                }
                if let err = model.listError {
                    Section {
                        Label(err, systemImage: "wifi.exclamationmark")
                            .foregroundStyle(.orange)
                            .textSelection(.enabled)
                    }
                }
                ForEach(model.sessions, id: \.key) { s in
                    NavigationLink(value: s) {
                        SessionRow(session: s)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .overlay {
                if model.sessions.isEmpty && model.listError == nil {
                    if model.isLoadingSessions {
                        ProgressView()
                    } else {
                        ContentUnavailableView(
                            "No sessions yet",
                            systemImage: "text.bubble",
                            description: Text("Claude Code and Codex chats on your Mac show up here.")
                        )
                    }
                }
            }
            .refreshable { await model.refreshSessions() }
            .navigationTitle(model.mac?.name ?? "Sessions")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: Session.self) { s in
                if let api = model.api {
                    SessionFeedView(session: s, api: api, socket: model.socket)
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    StatusPill()
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        if let mac = model.mac {
                            Text("\(mac.host):\(String(mac.port))")
                        }
                        Button {
                            Task { await model.refreshSessions() }
                        } label: {
                            Label("Refresh", systemImage: "arrow.clockwise")
                        }
                        Button(role: .destructive) {
                            confirmForget = true
                        } label: {
                            Label("Forget this Mac", systemImage: "trash")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .confirmationDialog("Forget this Mac?", isPresented: $confirmForget, titleVisibility: .visible) {
                Button("Forget and pair again", role: .destructive) { model.forget() }
            } message: {
                Text("The token is removed from this phone. Your Mac is not changed.")
            }
        }
    }
}

struct SessionRow: View {
    let session: Session

    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { ctx in
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    ToolBadge(tool: session.tool, label: session.toolLabel)
                    Text(session.project.isEmpty ? "—" : session.project)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    if session.isLive(now: ctx.date) {
                        Circle()
                            .fill(.green)
                            .frame(width: 8, height: 8)
                            .accessibilityLabel("Live")
                    }
                    Text(RelativeTime.string(session.updatedDate, now: ctx.date))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
                Text(session.title.isEmpty ? "(no title)" : session.title)
                    .font(.body)
                    .lineLimit(2)
                    .foregroundStyle(.primary)
            }
            .padding(.vertical, 2)
        }
    }
}

struct ToolBadge: View {
    let tool: String
    let label: String

    var body: some View {
        Text(label)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Capsule().fill(tint.opacity(0.18)))
            .foregroundStyle(tint)
    }

    private var tint: Color {
        switch tool {
        case "claude": return .orange
        case "codex": return .blue
        default: return .gray
        }
    }
}

enum RelativeTime {
    private static let formatter: RelativeDateTimeFormatter = {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .abbreviated
        return f
    }()

    static func string(_ date: Date?, now: Date = Date()) -> String {
        guard let date else { return "" }
        if abs(now.timeIntervalSince(date)) < 45 { return "now" }
        return formatter.localizedString(for: date, relativeTo: now)
    }
}
