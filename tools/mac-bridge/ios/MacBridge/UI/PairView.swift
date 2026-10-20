import SwiftUI
import UIKit

/// Three ways to pair: scan the QR code, pick a Mac found on the Wi-Fi and paste
/// the token, or type host / port / token by hand. Every way checks /v1/health first.
struct PairView: View {
    @EnvironmentObject private var model: AppModel
    @StateObject private var browser = BonjourBrowser()

    @State private var host = ""
    @State private var port = String(PairingLink.defaultPort)
    @State private var token = ""
    @State private var name = ""
    @State private var pickedNearby: String?

    @State private var showScanner = false
    @State private var busy = false
    @State private var resolving: String?
    @State private var errorText: String?

    @FocusState private var tokenFocused: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Start the Mac helper. It shows a QR code and a pairing link. Scan it, pick your Mac below, or type it in.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }

                Section("Scan") {
                    Button {
                        showScanner = true
                    } label: {
                        Label("Scan the QR code", systemImage: "qrcode.viewfinder")
                    }
                    Button {
                        pastePairingLink()
                    } label: {
                        Label("Paste a pairing link", systemImage: "doc.on.clipboard")
                    }
                }
                .disabled(busy)

                Section {
                    if browser.found.isEmpty {
                        HStack(spacing: 10) {
                            ProgressView()
                            Text("Looking for Macs on this Wi-Fi…").foregroundStyle(.secondary)
                        }
                    }
                    ForEach(browser.found) { mac in
                        Button {
                            pick(mac)
                        } label: {
                            HStack {
                                Label(mac.displayName, systemImage: "laptopcomputer")
                                Spacer()
                                if resolving == mac.id {
                                    ProgressView()
                                } else if pickedNearby == mac.id {
                                    Image(systemName: "checkmark").foregroundStyle(.tint)
                                }
                            }
                        }
                        .disabled(busy || resolving != nil)
                    }
                    if let problem = browser.problem {
                        Text(problem).font(.footnote).foregroundStyle(.orange)
                    }
                } header: {
                    Text("Macs nearby")
                } footer: {
                    Text("Pick one, then paste the token the helper printed.")
                }

                Section("Mac address") {
                    TextField("Host (for example 192.168.1.20)", text: $host)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                    TextField("Port", text: $port)
                        .keyboardType(.numberPad)
                    SecureField("Token", text: $token)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($tokenFocused)
                    Button {
                        Task { await connectManual() }
                    } label: {
                        HStack {
                            Text("Connect")
                            Spacer()
                            if busy { ProgressView() }
                        }
                    }
                    .disabled(busy || host.trimmingCharacters(in: .whitespaces).isEmpty || token.trimmingCharacters(in: .whitespaces).isEmpty)
                }

                if let errorText {
                    Section {
                        Label(errorText, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.red)
                            .textSelection(.enabled)
                    }
                }
            }
            .navigationTitle("Pair a Mac")
            .sheet(isPresented: $showScanner) {
                ScannerSheet { code in
                    showScanner = false
                    Task { await pairFromLink(code) }
                }
            }
            .onAppear { browser.start() }
            .onDisappear { browser.stop() }
        }
    }

    private func pick(_ mac: BonjourBrowser.Found) {
        errorText = nil
        resolving = mac.id
        Task {
            defer { resolving = nil }
            do {
                let r = try await BonjourBrowser.resolve(mac.endpoint)
                host = r.host
                port = String(r.port)
                name = mac.displayName
                pickedNearby = mac.id
                tokenFocused = true
            } catch {
                errorText = "Could not reach \(mac.displayName). \(error.localizedDescription)"
            }
        }
    }

    private func pastePairingLink() {
        guard let text = UIPasteboard.general.string else {
            errorText = "The clipboard is empty."
            return
        }
        Task { await pairFromLink(text) }
    }

    private func pairFromLink(_ text: String) async {
        errorText = nil
        do {
            let info = try PairingLink.parse(text)
            await pair(info)
        } catch {
            errorText = error.localizedDescription
        }
    }

    private func connectManual() async {
        errorText = nil
        let h = host.trimmingCharacters(in: .whitespacesAndNewlines)
        let t = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let p = Int(port.trimmingCharacters(in: .whitespaces)), (1...65535).contains(p) else {
            errorText = "The port must be a number from 1 to 65535."
            return
        }
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        await pair(PairingInfo(host: h, port: p, token: t, name: n.isEmpty ? h : n))
    }

    private func pair(_ info: PairingInfo) async {
        busy = true
        defer { busy = false }
        do {
            try await model.verifyAndPair(info)
        } catch {
            errorText = error.localizedDescription
        }
    }
}

/// Full-screen camera with a cancel button.
private struct ScannerSheet: View {
    let onCode: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var problem: String?

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                if let problem {
                    VStack(spacing: 12) {
                        Image(systemName: "camera.fill").font(.largeTitle)
                        Text(problem).multilineTextAlignment(.center)
                    }
                    .foregroundStyle(.white)
                    .padding()
                } else {
                    QRScannerView(onCode: onCode, onFailure: { problem = $0 })
                        .ignoresSafeArea()
                    RoundedRectangle(cornerRadius: 24)
                        .strokeBorder(.white.opacity(0.8), lineWidth: 3)
                        .frame(width: 240, height: 240)
                }
            }
            .navigationTitle("Scan pairing code")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}
