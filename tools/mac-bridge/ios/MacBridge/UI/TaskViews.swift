import SwiftUI

// v2 screens: New task sheet, running-task rows, the reply bar at the bottom of a feed.
// Contract: docs/specs/mac-bridge-protocol-v2-tasks.md.

// MARK: - New task

struct NewTaskView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    /// Called once, as soon as the task's session id is known.
    let onOpen: (Session) -> Void

    @State private var prompt = ""
    @State private var tool: TaskTool = .claude
    @State private var sending = false
    @State private var sendError: String?
    @State private var sentId: String?
    @State private var opened = false
    @FocusState private var focused: Bool

    private var sent: BridgeTask? { sentId.flatMap { model.task(id: $0) } }

    var body: some View {
        NavigationStack {
            Group {
                if let t = sent {
                    sentView(t)
                } else {
                    form
                }
            }
            .navigationTitle(sent == nil ? "New task" : "Task")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(sent == nil ? "Cancel" : "Close") { dismiss() }
                }
                if sent == nil {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Send") { Task { await send() } }
                            .disabled(!NewTaskRequest.canSend(prompt) || sending)
                    }
                }
            }
            .onChange(of: sent?.sessionId) { _, _ in openIfReady() }
            .onAppear { focused = true }
        }
    }

    private var form: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                TextEditor(text: $prompt)
                    .focused($focused)
                    .font(.body)
                    .frame(minHeight: 220)
                    .padding(8)
                    .background(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(Color(.secondarySystemBackground))
                    )
                    .overlay(alignment: .topLeading) {
                        if prompt.isEmpty {
                            Text("What should the Mac build?")
                                .foregroundStyle(.tertiary)
                                .padding(.horizontal, 13)
                                .padding(.vertical, 16)
                                .allowsHitTesting(false)
                        }
                    }
                    .accessibilityLabel("Task")

                if prompt.count > NewTaskRequest.maxPromptLength {
                    Text("Too long: \(prompt.count) of \(NewTaskRequest.maxPromptLength) characters.")
                        .font(.footnote)
                        .foregroundStyle(.red)
                }

                VStack(alignment: .leading, spacing: 6) {
                    Picker("Tool", selection: $tool) {
                        ForEach(TaskTool.allCases) { t in
                            Text(t.label).tag(t)
                        }
                    }
                    .pickerStyle(.segmented)
                    if tool == .auto {
                        Text("Uses the repo rules")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }

                if let sendError {
                    Label(sendError, systemImage: "exclamationmark.octagon")
                        .font(.callout)
                        .foregroundStyle(.red)
                        .textSelection(.enabled)
                }

                Button {
                    Task { await send() }
                } label: {
                    HStack {
                        if sending { ProgressView().tint(.white) }
                        Text(sending ? "Sending…" : "Send")
                            .font(.headline)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
                .disabled(!NewTaskRequest.canSend(prompt) || sending)
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private func sentView(_ t: BridgeTask) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                TaskSummaryCard(task: t, lineLimit: 6)
                if t.status.isActive && t.sessionId == nil {
                    HStack(spacing: 8) {
                        ProgressView()
                        Text("Waiting for the Mac to open the session…")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                }
                if let s = model.session(for: t) {
                    Button {
                        open(s)
                    } label: {
                        Label("Open the live feed", systemImage: "text.bubble")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }
                if !t.status.isActive && t.sessionId == nil {
                    Button("Edit and send again") {
                        sentId = nil
                        opened = false
                    }
                    .buttonStyle(.bordered)
                }
            }
            .padding(16)
        }
    }

    private func send() async {
        guard NewTaskRequest.canSend(prompt), !sending else { return }
        sending = true
        sendError = nil
        defer { sending = false }
        do {
            let t = try await model.startTask(.newTask(tool: tool, prompt: prompt))
            sentId = t.id
            openIfReady()
        } catch {
            sendError = error.localizedDescription
        }
    }

    private func openIfReady() {
        guard !opened, let t = sent, let s = model.session(for: t) else { return }
        open(s)
    }

    private func open(_ s: Session) {
        opened = true
        onOpen(s)
        dismiss()
    }
}

// MARK: - Task pieces

struct TaskStatusBadge: View {
    let status: TaskStatus

    var body: some View {
        HStack(spacing: 4) {
            if status.isActive {
                ProgressView().controlSize(.mini)
            }
            Text(status.label)
        }
        .font(.caption2.weight(.semibold))
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(Capsule().fill(tint.opacity(0.18)))
        .foregroundStyle(tint)
    }

    private var tint: Color {
        switch status {
        case .starting, .running: return .green
        case .done: return .gray
        case .stopped: return .orange
        case .failed: return .red
        }
    }
}

/// Tool, status, the prompt, who picked the tool (Auto only), and any problem in plain words.
struct TaskSummaryCard: View {
    let task: BridgeTask
    var lineLimit = 2

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                ToolBadge(tool: task.tool, label: task.toolLabel)
                TaskStatusBadge(status: task.status)
                Spacer(minLength: 4)
                Text(RelativeTime.string(task.startedDate))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Text(task.prompt.isEmpty ? task.firstLine : task.prompt)
                .font(.callout)
                .lineLimit(lineLimit)
            if let pick = task.pickSummary {
                Label(pick, systemImage: "arrow.triangle.branch")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if let problem = task.problem {
                Text(problem)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .textSelection(.enabled)
            }
        }
    }
}

/// One row in the Running strip at the top of the session list.
struct RunningTaskRow: View {
    let task: BridgeTask
    let onStop: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    ToolBadge(tool: task.tool, label: task.toolLabel)
                    TaskStatusBadge(status: task.status)
                }
                Text(task.firstLine)
                    .font(.subheadline)
                    .lineLimit(1)
                if let pick = task.pickSummary {
                    Text(pick)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 4)
            Button(role: .destructive, action: onStop) {
                Text("Stop")
                    .font(.caption.weight(.semibold))
            }
            .buttonStyle(.bordered)
            .tint(.red)
            .accessibilityLabel("Stop task")
        }
        .padding(.vertical, 2)
    }
}

// MARK: - Reply bar

/// Pinned at the bottom of a session feed. Sends a task that resumes this session with the same tool.
struct ReplyBar: View {
    @EnvironmentObject private var model: AppModel

    let session: Session

    @State private var text = ""
    @State private var sending = false
    @State private var sendError: String?
    /// The last reply sent from here. Keeps the bar busy until it ends, even if the Mac
    /// writes the reply into a new session id.
    @State private var lastId: String?
    @FocusState private var focused: Bool

    private var lastTask: BridgeTask? { lastId.flatMap { model.task(id: $0) } }

    private var working: Bool {
        if sending { return true }
        if model.activeTask(for: session) != nil { return true }
        return lastTask?.status.isActive ?? false
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let sendError {
                Label(sendError, systemImage: "exclamationmark.octagon")
                    .font(.caption)
                    .foregroundStyle(.red)
                    .textSelection(.enabled)
            } else if let t = lastTask, let problem = t.problem {
                Text(problem)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
            if let t = lastTask, let sid = t.sessionId, sid != session.id, let other = model.session(for: t) {
                NavigationLink(value: other) {
                    Label("The reply continues in a new session. Open it", systemImage: "arrow.turn.down.right")
                        .font(.caption)
                }
            }
            if working {
                HStack(spacing: 6) {
                    ProgressView().controlSize(.small)
                    Text("working…")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            HStack(alignment: .bottom, spacing: 8) {
                TextField("Reply to \(session.toolLabel)", text: $text, axis: .vertical)
                    .lineLimit(1...5)
                    .focused($focused)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .fill(Color(.secondarySystemBackground))
                    )
                    .disabled(working)
                Button {
                    Task { await send() }
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 30))
                }
                .disabled(working || !NewTaskRequest.canSend(text))
                .accessibilityLabel("Send reply")
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 8)
        .padding(.bottom, 8)
        .background(.bar)
    }

    private func send() async {
        guard NewTaskRequest.canSend(text), !working else { return }
        sending = true
        sendError = nil
        defer { sending = false }
        do {
            let t = try await model.startTask(.reply(to: session, prompt: text))
            lastId = t.id
            text = ""
            focused = false
        } catch {
            sendError = error.localizedDescription
        }
    }
}
