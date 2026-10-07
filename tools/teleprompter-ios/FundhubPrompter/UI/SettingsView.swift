import SwiftUI
import UIKit

struct SettingsView: View {
    @EnvironmentObject var model: AppModel
    @EnvironmentObject var camera: CameraController
    var prompter: PrompterController? = nil
    @Environment(\.dismiss) private var dismiss
    @State private var server = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Words") {
                    Stepper(value: $model.settings.wpm, in: PromptClock.minWPM...PromptClock.maxWPM, step: 10) {
                        Text("Speed: \(model.settings.wpm) words a minute")
                    }
                    VStack(alignment: .leading) {
                        Text("Text size: \(Int(model.settings.fontSize))")
                        Slider(value: $model.settings.fontSize, in: PrompterSettings.fontRange, step: 2)
                    }
                    VStack(alignment: .leading) {
                        Text("Line width: \(Int(model.settings.lineWidth * 100))% of the screen")
                        Slider(value: $model.settings.lineWidth, in: PrompterSettings.lineWidthRange, step: 0.05)
                    }
                    VStack(alignment: .leading) {
                        Text("Pause at a blank line: \(String(format: "%.1f", model.settings.pauseSeconds)) s")
                        Slider(value: $model.settings.pauseSeconds, in: 0...3, step: 0.1)
                    }
                    Toggle("3-2-1 before it rolls", isOn: $model.settings.countdown)
                }

                Section {
                    Toggle("Flip left-right (glass rig)", isOn: $model.settings.mirror)
                    Toggle("Flip upside down", isOn: $model.settings.flipVertical)
                } header: { Text("iPad glass rig") } footer: {
                    Text("For a beam-splitter: the words show backwards on the screen and right way round in the glass. This device keeps its own setting.")
                }

                Section {
                    Toggle("Film with this device", isOn: $model.settings.recordOnThisDevice)
                    Picker("Quality", selection: $model.settings.quality) {
                        ForEach(PrompterSettings.VideoQuality.allCases) { Text($0.label).tag($0) }
                    }
                    Text("Frame rate: the highest this phone really films at that size.")
                        .foregroundStyle(.secondary)
                    Picker("Video format", selection: $model.settings.codec) {
                        ForEach(PrompterSettings.VideoCodecChoice.allCases) { Text($0.label).tag($0) }
                    }
                    Toggle("Record mirrored (like the preview)", isOn: $model.settings.recordMirrored)
                    Picker("Steady video", selection: $model.settings.stabilization) {
                        ForEach(PrompterSettings.Steady.allCases) { Text($0.label).tag($0) }
                    }
                    Toggle("Lock brightness", isOn: $model.settings.lockExposure)
                    VStack(alignment: .leading) {
                        Text("Camera box shows for \(Int(model.settings.previewSeconds)) s, then goes dark")
                        Slider(value: $model.settings.previewSeconds, in: 2...15, step: 1)
                    }
                    if !camera.summary.isEmpty { Text("Right now: \(camera.summary)").foregroundStyle(.secondary) }
                    if let s = camera.shortfall { Text(s).foregroundStyle(Brand.bad) }
                } header: { Text("Camera") } footer: {
                    Text("4K for VSLs, thank-you videos and testimonials. 1080p for ads. Each one uses the fastest real frame rate at that size. It never stretches a smaller picture and calls it 4K. Lock brightness after you light the room.")
                }

                Section {
                    NavigationLink("Learn remote") { LearnRemoteView() }
                } header: { Text("Bluetooth remote") } footer: {
                    Text("Space, Enter and Page Down play and pause. The arrows change the speed. Page Up starts over. At the end: play = Got it, Page Up = Another take.")
                }

                Section("Server") {
                    TextField("https://fundhub.ai", text: $server)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onSubmit(saveServer)
                    if let who = model.signIn {
                        Text("Signed in as \(who.name ?? who.email ?? "staff")").foregroundStyle(.secondary)
                        Button("Sign out", role: .destructive) {
                            Task { await model.signOut(); dismiss() }
                        }
                    }
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { saveServer(); dismiss() } }
            }
            .onAppear { server = model.settings.serverAddress }
        }
    }

    private func saveServer() {
        let s = server.trimmed
        guard let u = URL(string: s), u.scheme == "https", u.host != nil else { return }
        model.settings.serverAddress = s
    }
}

/// Press a button on the remote for each slot. Each device keeps its own.
struct LearnRemoteView: View {
    @EnvironmentObject var model: AppModel
    @State private var slot: RemoteAction?

    var body: some View {
        List {
            Section {
                ForEach(RemoteAction.allCases, id: \.self) { a in
                    Button {
                        slot = a
                    } label: {
                        HStack {
                            Text(a.label)
                            Spacer()
                            if slot == a {
                                Text("Press a button…").foregroundStyle(Brand.amber)
                            } else {
                                Text("\((model.settings.learnedKeys[a.rawValue] ?? []).count) learned").foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            } footer: {
                Text("Tap a slot, then press the button on your remote. The normal keys keep working too.")
            }
            Section {
                Button("Forget learned buttons", role: .destructive) { model.settings.learnedKeys = [:] }
            }
        }
        .navigationTitle("Learn remote")
        .background(KeyCatcher(active: slot != nil) { key in
            if let s = slot {
                model.settings.learnedKeys = RemoteKeys.learn(key, for: s, into: model.settings.learnedKeys)
                slot = nil
            }
        })
    }
}

/// Catches one key press (a remote button) while active.
struct KeyCatcher: UIViewRepresentable {
    var active: Bool
    var onKey: (String) -> Void

    final class CatchView: UIView {
        var onKey: ((String) -> Void)?
        override var canBecomeFirstResponder: Bool { true }
        override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
            if let k = presses.first?.key {
                onKey?(RemoteKeys.id(hidUsage: k.keyCode.rawValue))
            } else {
                super.pressesBegan(presses, with: event)
            }
        }
    }

    func makeUIView(context: Context) -> CatchView { CatchView() }

    func updateUIView(_ v: CatchView, context: Context) {
        v.onKey = onKey
        if active { DispatchQueue.main.async { v.becomeFirstResponder() } }
    }
}
