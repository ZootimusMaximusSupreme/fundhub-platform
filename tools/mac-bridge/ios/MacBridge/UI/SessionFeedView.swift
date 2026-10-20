import SwiftUI
import UIKit

struct SessionFeedView: View {
    @StateObject private var feed: FeedModel
    @EnvironmentObject private var socket: BridgeSocket

    @State private var atBottom = true
    @State private var unseen = 0

    init(session: Session, api: BridgeAPI, socket: BridgeSocket) {
        _feed = StateObject(wrappedValue: FeedModel(session: session, api: api, socket: socket))
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    if let err = feed.error {
                        Label(err, systemImage: "wifi.exclamationmark")
                            .font(.footnote)
                            .foregroundStyle(.orange)
                            .frame(maxWidth: .infinity)
                    }
                    ForEach(feed.events) { e in
                        EventRow(event: e)
                            .id(e.seq)
                    }
                    Color.clear
                        .frame(height: 1)
                        .id("bottom")
                        .onAppear { atBottom = true; unseen = 0 }
                        .onDisappear { atBottom = false }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
            }
            .overlay {
                if feed.loading && feed.events.isEmpty {
                    ProgressView()
                } else if !feed.loading && feed.events.isEmpty && feed.error == nil {
                    ContentUnavailableView("Nothing here yet", systemImage: "text.bubble")
                }
            }
            .overlay(alignment: .bottomTrailing) {
                if !atBottom && unseen > 0 {
                    Button {
                        withAnimation { proxy.scrollTo("bottom", anchor: .bottom) }
                    } label: {
                        Label("\(unseen) new", systemImage: "arrow.down")
                            .font(.footnote.weight(.semibold))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(Capsule().fill(.tint))
                            .foregroundStyle(.white)
                    }
                    .padding(16)
                }
            }
            .onChange(of: feed.events.count) { old, new in
                // Only follow new lines when the reader is already at the bottom.
                if atBottom || old == 0 {
                    DispatchQueue.main.async {
                        if old == 0 {
                            proxy.scrollTo("bottom", anchor: .bottom)
                        } else {
                            withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo("bottom", anchor: .bottom) }
                        }
                    }
                } else {
                    unseen += max(0, new - old)
                }
            }
        }
        .navigationTitle(feed.session.title.isEmpty ? feed.session.project : feed.session.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                VStack(spacing: 0) {
                    Text(feed.session.title.isEmpty ? "(no title)" : feed.session.title)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                    HStack(spacing: 4) {
                        ToolBadge(tool: feed.session.tool, label: feed.session.toolLabel)
                        Text(feed.session.project).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                StatusPill()
            }
        }
        .task { await feed.start() }
        .onDisappear { feed.stop() }
        .onChange(of: socket.connectCount) { _, _ in
            // Back online: fetch whatever came in while the link was down.
            Task { await feed.catchUp() }
        }
    }
}

// MARK: - Rows

struct EventRow: View {
    let event: Event

    var body: some View {
        switch event.kind {
        case .user:
            ChatBubble(text: event.text, mine: true)
        case .assistant:
            ChatBubble(text: event.text, mine: false)
        case .command:
            CodeCard(
                icon: "terminal",
                text: "$ " + (event.command ?? event.text),
                exitCode: event.exitCode,
                emphasis: true
            )
        case .output:
            CodeCard(icon: "text.alignleft", text: event.text, exitCode: event.exitCode, emphasis: false)
        case .tool:
            CodeCard(icon: "wrench.and.screwdriver", text: event.text, exitCode: event.exitCode, emphasis: false)
        case .system:
            Text(event.text)
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .textSelection(.enabled)
        }
    }
}

struct ChatBubble: View {
    let text: String
    let mine: Bool

    var body: some View {
        HStack {
            if mine { Spacer(minLength: 40) }
            Text(text)
                .textSelection(.enabled)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .foregroundStyle(mine ? Color.white : Color.primary)
                .background(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(mine ? Color.accentColor : Color(.secondarySystemBackground))
                )
            if !mine { Spacer(minLength: 40) }
        }
    }
}

struct CodeCard: View {
    let icon: String
    let text: String
    let exitCode: Int?
    let emphasis: Bool

    @State private var expanded = false
    private static let foldLines = 14

    var body: some View {
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
        let long = lines.count > Self.foldLines
        let shown = (long && !expanded) ? lines.prefix(Self.foldLines).joined(separator: "\n") + "\n…" : text

        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 6) {
                Image(systemName: icon)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.top, 2)
                Text(shown)
                    .font(.system(.footnote, design: .monospaced))
                    .fontWeight(emphasis ? .semibold : .regular)
                    .foregroundStyle(.primary)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let code = exitCode, code != 0 {
                    Text("exit \(code)")
                        .font(.caption2.weight(.bold))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(Color.red.opacity(0.18)))
                        .foregroundStyle(.red)
                }
            }
            if long {
                Button(expanded ? "Show less" : "Show all \(lines.count) lines") {
                    expanded.toggle()
                }
                .font(.caption)
            }
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color(.tertiarySystemBackground))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(Color(.separator), lineWidth: 0.5)
        )
        .contextMenu {
            Button {
                UIPasteboard.general.string = text
            } label: {
                Label("Copy", systemImage: "doc.on.doc")
            }
        }
    }
}
