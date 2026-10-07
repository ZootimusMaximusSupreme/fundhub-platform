import SwiftUI

/// The shoot screen: dark glass with the words, a small camera box that fades
/// away, the buttons (hidden while rolling), and the pulse line.
struct PrompterScreen: View {
    @EnvironmentObject var model: AppModel
    @EnvironmentObject var camera: CameraController
    @Environment(\.dismiss) private var dismiss
    @StateObject private var prompter = PrompterController()

    let startRoot: String
    @State private var root: String = ""
    @State private var previewOn = true
    @State private var hideTask: Task<Void, Never>?
    @State private var editing: EditTarget?
    @State private var showSettings = false
    /// A take was filmed and has no Got it / Another take yet.
    @State private var takeWaiting = false
    /// Takes filmed with no shoot open (no server count), so names still move on.
    @State private var localExtra: [String: Int] = [:]
    @State private var lastRecordedHere = false

    private var script: Script? { model.script(root: root.isEmpty ? startRoot : root) }
    private var paragraphs: [Paragraph] { script.map(ScriptText.paragraphs) ?? [] }
    private var rolling: Bool { [.rolling, .countdown, .holding].contains(prompter.mode) }
    private var cameraOn: Bool { model.settings.recordOnThisDevice && !model.isDemo }

    var body: some View {
        GeometryReader { geo in
            ZStack {
                Brand.glass.ignoresSafeArea()
                PrompterView(paragraphs: paragraphs, scriptKey: root.isEmpty ? startRoot : root,
                             settings: model.settings, controller: prompter)
                    .ignoresSafeArea()

                if prompter.mode == .scroll {
                    VStack {
                        Text("Scroll mode — drag the words. Tap to roll. Double tap to leave.")
                            .font(.footnote.weight(.semibold))
                            .padding(8)
                            .background(.black.opacity(0.7), in: Capsule())
                            .padding(.top, 8)
                        Spacer()
                    }
                    .allowsHitTesting(false)
                }

                cornerCamera(geo.size)

                VStack(spacing: 0) {
                    if !rolling { topBar.transition(.opacity) }
                    Spacer()
                    VStack(spacing: 0) {
                        if (prompter.mode == .ended || takeWaiting) && !camera.isRecording { endBar.padding(.top, 10).transition(.opacity) }
                        if !rolling { controls.transition(.opacity) }
                        PulseBar(root: root, compact: rolling)
                            .padding(.horizontal, 12)
                            .padding(.bottom, 4)
                            .opacity(rolling ? 0.6 : 1)
                    }
                    // Paused: a dark panel so the buttons read over the words.
                    .background(Color.black.opacity(rolling ? 0 : 0.9).ignoresSafeArea(edges: .bottom))
                }
                .animation(.easeInOut(duration: 0.25), value: rolling)
            }
        }
        .statusBarHidden()
        .persistentSystemOverlays(.hidden)
        .onAppear(perform: appear)
        .onDisappear(perform: disappear)
        .onChange(of: model.settings) { old, s in
            if s.recordOnThisDevice != old.recordOnThisDevice {
                if cameraOn { camera.start(with: s) } else { camera.stop() }
            } else {
                camera.apply(s)
            }
        }
        .onChange(of: prompter.mode) { _, m in
            if m == .rolling || m == .countdown { fadePreview(after: 0.6) }
        }
        .sheet(item: $editing, onDismiss: { prompter.focusKeys() }) { t in
            EditSheet(target: t) { text in model.edit(root: t.root, index: t.index, newText: text) }
        }
        .sheet(isPresented: $showSettings, onDismiss: { prompter.focusKeys() }) { SettingsView(prompter: prompter) }
    }

    // MARK: - Pieces

    private var topBar: some View {
        HStack(alignment: .top, spacing: 12) {
            Button { dismiss() } label: {
                Label("Scripts", systemImage: "chevron.left").font(.headline)
            }
            .disabled(camera.isRecording)
            VStack(alignment: .leading, spacing: 2) {
                Text(script?.displayName ?? "").font(.headline).lineLimit(1)
                Text(takeName).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                if !cameraOn {
                    Text(model.settings.recordOnThisDevice ? "Words only" : "Words only — recording is off here")
                        .font(.caption).foregroundStyle(.secondary)
                } else if !camera.summary.isEmpty {
                    Text(camera.summary).font(.caption).foregroundStyle(.secondary)
                }
                if let s = camera.shortfall { Text(s).font(.caption.weight(.semibold)).foregroundStyle(Brand.bad) }
                if let e = camera.lastError { Text(e).font(.caption).foregroundStyle(Brand.bad) }
                else if let ok = camera.lastSaved { Text(ok).font(.caption).foregroundStyle(Brand.good).lineLimit(2) }
            }
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.trailing, 110)
        .background(Color.black.opacity(0.9).ignoresSafeArea(edges: .top))
    }

    private var controls: some View {
        // One row on an iPad or a phone held sideways; two rows on a phone held up.
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 10) { speedRow; actionRow }
            VStack(spacing: 8) { speedRow; actionRow }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity)

    }

    private var speedRow: some View {
        HStack(spacing: 10) {
            RoundButton(icon: "backward.end.fill", label: "Start over") { prompter.restart() }
            RoundButton(icon: "minus", label: "Slower") { changeSpeed(-10) }
            VStack(spacing: 0) {
                Text("\(model.settings.wpm)").font(.title3.monospacedDigit().bold())
                Text("words/min").font(.caption2).foregroundStyle(.secondary)
                Text("\(PromptClock.clock(Double(prompter.secondsLeft))) left").font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
            }
            .frame(minWidth: 64)
            RoundButton(icon: "plus", label: "Faster") { changeSpeed(10) }
        }
        .fixedSize()
    }

    private var actionRow: some View {
        HStack(spacing: 10) {
            RoundButton(icon: prompter.mode == .holding ? "forward.fill" : "play.fill", label: "Play", big: true) {
                prompter.togglePlay()
            }
            .accessibilityIdentifier("play")
            RoundButton(icon: "pencil", label: "Edit") { openEdit(prompter.currentParagraph()) }
                .accessibilityIdentifier("edit")
            if cameraOn {
                RoundButton(icon: camera.isRecording ? "stop.fill" : "record.circle", label: camera.isRecording ? "Stop" : "Record",
                            tint: Brand.bad) { toggleRecord() }
                    .disabled(!(camera.state == .ready || camera.isRecording))
                    .accessibilityIdentifier("record")
            }
            RoundButton(icon: "gearshape", label: "Settings") { showSettings = true }
        }
        .fixedSize()
    }

    private var endBar: some View {
        HStack(spacing: 12) {
            if model.shootId != nil {
                Button { gotIt() } label: {
                    Text("Got it").font(.headline).frame(maxWidth: .infinity).padding(.vertical, 12)
                }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("gotit")
                Button { anotherTake() } label: {
                    Text("Another take").font(.headline).frame(maxWidth: .infinity).padding(.vertical, 12)
                }
                .buttonStyle(.bordered)
            } else {
                Button { anotherTake() } label: {
                    Text("Roll again").font(.headline).frame(maxWidth: .infinity).padding(.vertical, 12)
                }
                .buttonStyle(.bordered)
            }
            Button { goNext() } label: {
                Text("Next script").font(.headline).frame(maxWidth: .infinity).padding(.vertical, 12)
            }
            .buttonStyle(.bordered)
        }
        .frame(maxWidth: 640)
        .padding(.horizontal, 16)
        .padding(.bottom, 6)
    }

    @ViewBuilder
    private func cornerCamera(_ size: CGSize) -> some View {
        let tall = size.height >= size.width
        let w: CGFloat = tall ? 96 : 170
        let h: CGFloat = tall ? 170 : 96
        VStack {
            HStack {
                if camera.isRecording { RecDot() }
                Spacer()
                ZStack(alignment: .topTrailing) {
                    if cameraOn && previewOn && camera.state != .idle {
                        CameraPreview(session: camera.session)
                            .frame(width: w, height: h)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(.white.opacity(0.3)))
                            .transition(.opacity)
                    }
                    // Tap the corner to bring the camera box back.
                    Button { showPreview() } label: {
                        Image(systemName: "camera.viewfinder")
                            .font(.title3)
                            .foregroundStyle(.white.opacity(previewOn ? 0 : 0.35))
                            .frame(width: 56, height: 56)
                            .contentShape(Rectangle())
                    }
                    .accessibilityLabel("Show the camera")
                    .accessibilityIdentifier("corner")
                }
            }
            Spacer()
        }
        .padding(.top, 6)
        .padding(.horizontal, 8)
        .animation(.easeOut(duration: 1.2), value: previewOn)
    }

    private var takeName: String {
        guard let s = script else { return "" }
        return CaptureChoice.takeName(for: s, localExtra: localExtra[s.rootScriptId] ?? 0)
    }

    // MARK: - Actions

    private func appear() {
        root = startRoot
        prompter.onEditRequest = { i in openEdit(i) }
        prompter.onSpeed = { d in changeSpeed(d) }
        prompter.onRemote = { a in
            switch a {
            case .gotIt: gotIt()
            case .anotherTake: anotherTake()
            case .record: toggleRecord()
            default: break
            }
        }
        prompter.onLearned = { slot, key in
            model.settings.learnedKeys = RemoteKeys.learn(key, for: slot, into: model.settings.learnedKeys)
        }
        if cameraOn { camera.start(with: model.settings) }
        showPreview()
        // Screenshot demo only (launch arguments, never on Chris's phone).
        if model.isDemo {
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 800_000_000)
                if DemoArgs.has("-FundhubDemoRoll") { prompter.togglePlay() }
                if DemoArgs.has("-FundhubDemoEdit") { openEdit(1) }
                if DemoArgs.has("-FundhubDemoSettings") { showSettings = true }
                if DemoArgs.has("-FundhubDemoSave"), let s = script, paragraphs.count > 1 {
                    model.edit(root: s.rootScriptId, index: 1, newText: paragraphs[1].text + " Ever.")
                }
            }
        }
    }

    private func disappear() {
        hideTask?.cancel()
        if camera.isRecording { camera.stopRecording() }
        camera.stop()
        UIApplication.shared.isIdleTimerDisabled = false
    }

    private func showPreview() {
        previewOn = true
        fadePreview(after: model.settings.previewSeconds)
    }

    private func fadePreview(after seconds: Double) {
        hideTask?.cancel()
        hideTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: UInt64(max(0.2, seconds) * 1_000_000_000))
            if !Task.isCancelled { previewOn = false }
        }
    }

    private func changeSpeed(_ d: Int) {
        model.settings.wpm = PromptClock.clampWPM(model.settings.wpm + d)
    }

    private func openEdit(_ i: Int) {
        prompter.pause()
        guard let s = script, i >= 0, i < paragraphs.count else { return }
        editing = EditTarget(root: s.rootScriptId, index: i, text: paragraphs[i].text, title: s.displayName)
    }

    private func toggleRecord() {
        guard cameraOn else { return }
        if camera.isRecording {
            camera.stopRecording()
            prompter.pause()
            takeWaiting = true
            return
        }
        guard camera.state == .ready, let s = script else { return }
        // A take already filmed and not marked: it counts as Another take.
        if takeWaiting { countTake(s, gotIt: false) }
        takeWaiting = false
        lastRecordedHere = true
        camera.startRecording(name: takeName)
        if prompter.mode != .rolling && prompter.mode != .countdown { prompter.togglePlay() }
    }

    private func countTake(_ s: Script, gotIt: Bool) {
        if model.shootId != nil {
            model.mark(root: s.rootScriptId, gotIt: gotIt)
        } else {
            localExtra[s.rootScriptId, default: 0] += 1
        }
    }

    private func gotIt() {
        guard let s = script else { return }
        if camera.isRecording { camera.stopRecording() }
        countTake(s, gotIt: true)
        takeWaiting = false
        goNext()
    }

    private func anotherTake() {
        guard let s = script else { return }
        let again = lastRecordedHere && cameraOn
        if camera.isRecording { camera.stopRecording() }
        if takeWaiting || prompter.mode == .ended { countTake(s, gotIt: false) }
        takeWaiting = false
        prompter.restart()
        if again {
            // The camera needs a moment to finish saving the last take.
            Task { @MainActor in
                for _ in 0..<40 where camera.state != .ready { try? await Task.sleep(nanoseconds: 100_000_000) }
                if camera.state == .ready { camera.startRecording(name: takeName) }
            }
        }
    }

    private func goNext() {
        guard let next = model.nextRoot(after: root) else { return }
        takeWaiting = false
        lastRecordedHere = false
        root = next
        showPreview()
    }
}

struct EditTarget: Identifiable {
    var root: String
    var index: Int
    var text: String
    var title: String
    var id: String { "\(root)#\(index)" }
}

struct RoundButton: View {
    let icon: String
    let label: String
    var big = false
    var tint: Color = .white
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 3) {
                Image(systemName: icon)
                    .font(big ? .title : .title3)
                    .frame(width: big ? 60 : 46, height: big ? 60 : 46)
                    .background(Color.white.opacity(big ? 0.2 : 0.1), in: Circle())
                    .foregroundStyle(tint)
                Text(label).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

/// A small red dot while the camera records, so Chris always knows.
struct RecDot: View {
    @EnvironmentObject var camera: CameraController
    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { ctx in
            HStack(spacing: 6) {
                Circle().fill(Brand.bad).frame(width: 10, height: 10)
                if case .recording(let start) = camera.state {
                    Text(PromptClock.clock(ctx.date.timeIntervalSince(start)))
                        .font(.caption.monospacedDigit().weight(.semibold))
                }
            }
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(.black.opacity(0.6), in: Capsule())
        }
    }
}
