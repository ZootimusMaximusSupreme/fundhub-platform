import SwiftUI

/// The approved scripts, in film order, from GET marketing/shoot.
struct ScriptListView: View {
    @EnvironmentObject var model: AppModel
    @State private var open: String?
    @State private var showSettings = false

    var body: some View {
        NavigationStack {
            List {
                if let note = model.loadNote {
                    Text(note).font(.callout).foregroundStyle(Brand.warn)
                }
                if model.scripts.isEmpty {
                    Text(model.answer == nil ? "Loading the shoot…" : "No approved scripts yet. Approve scripts on the dashboard, then plan the shoot.")
                        .foregroundStyle(.secondary)
                }
                ForEach(Array(model.scripts.enumerated()), id: \.element.rootScriptId) { i, s in
                    Button { open = s.rootScriptId } label: { ScriptRow(number: i + 1, script: s) }
                        .accessibilityIdentifier("script.\(i + 1)")
                }
            }
            .listStyle(.insetGrouped)
            .refreshable { await model.refresh(); await model.queue.flush() }
            .navigationTitle(model.listTitle)
            .safeAreaInset(edge: .bottom) {
                PulseBar(root: nil).padding(.horizontal).padding(.bottom, 6)
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showSettings = true } label: { Image(systemName: "gearshape") }
                        .accessibilityLabel("Settings")
                }
            }
            .sheet(isPresented: $showSettings) { SettingsView() }
            .fullScreenCover(item: Binding(get: { open.map { OpenScript(root: $0) } }, set: { open = $0?.root })) { o in
                PrompterScreen(startRoot: o.root)
            }
        }
    }
}

struct OpenScript: Identifiable { var root: String; var id: String { root } }

struct ScriptRow: View {
    let number: Int
    let script: Script

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(number)")
                .font(.headline.monospacedDigit())
                .frame(width: 28, height: 28)
                .background(Color.white.opacity(0.1), in: Circle())
            VStack(alignment: .leading, spacing: 4) {
                Text(script.displayName).font(.headline).foregroundStyle(.primary)
                if let name = script.takeFileName {
                    Text(name).font(.footnote).foregroundStyle(.secondary)
                } else if let why = script.takeNameProblem {
                    Text(why).font(.footnote).foregroundStyle(Brand.warn)
                }
                HStack(spacing: 8) {
                    if script.gotIt == true { Tag(text: "Got it", color: Brand.good) }
                    if script.needsRetake == true { Tag(text: "Retake", color: Brand.warn) }
                    if script.firstLineOnly == true { Tag(text: "First line only", color: Brand.warn) }
                    if let t = script.takes, t > 0 { Tag(text: "\(t) take\(t == 1 ? "" : "s")", color: .secondary) }
                    if let sec = script.readSeconds { Tag(text: PromptClock.clock(sec), color: .secondary) }
                }
            }
            Spacer()
            Image(systemName: "chevron.right").foregroundStyle(.tertiary)
        }
        .padding(.vertical, 4)
    }
}

struct Tag: View {
    let text: String
    let color: Color
    var body: some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8).padding(.vertical, 3)
            .foregroundStyle(color)
            .background(color.opacity(0.15), in: Capsule())
    }
}

/// The change pulse: one line that never hides. "Saved 12:04", "Offline — 2 edits waiting".
struct PulseBar: View {
    @EnvironmentObject var model: AppModel
    /// The script on screen, for the two-versions and not-saved choices.
    let root: String?
    var compact = false
    @State private var showConflict = false
    @State private var showFailed = false

    var body: some View {
        PulseLine(queue: model.queue, compact: compact) {
            let items = model.queue.items.values
            if items.contains(where: { $0.conflict != nil }) { showConflict = true }
            else if items.contains(where: { $0.failed != nil }) { showFailed = true }
            else { Task { await model.queue.flush() } }
        }
        .sheet(isPresented: $showConflict) { ConflictSheet() }
        .alert("Not saved", isPresented: $showFailed, presenting: model.queue.items.values.first { $0.failed != nil }) { it in
            Button("Try again") { Task { await model.queue.retry(it.root) } }
            Button("Throw my change away", role: .destructive) { model.queue.throwAway(it.root) }
            Button("Not now", role: .cancel) {}
        } message: { it in
            Text("\(it.title ?? "A script"): \(it.failed ?? "")")
        }
    }
}

struct PulseLine: View {
    @ObservedObject var queue: SaveQueue
    var compact: Bool
    var tap: () -> Void

    var body: some View {
        let p = queue.pulse
        Button(action: tap) {
            HStack(spacing: 8) {
                Circle().fill(color(p.tone)).frame(width: 8, height: 8)
                Text(p.text)
                    .font(compact ? .caption : .subheadline.weight(.medium))
                    .foregroundStyle(compact ? Color.white.opacity(0.55) : .primary)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, compact ? 8 : 14)
            .padding(.vertical, compact ? 4 : 10)
            .background(compact ? Color.clear : Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("pulse")
    }

    private func color(_ t: SaveQueue.Pulse.Tone) -> Color {
        switch t {
        case .good: return Brand.good
        case .busy: return .blue
        case .warn: return Brand.warn
        case .bad: return Brand.bad
        }
    }
}
