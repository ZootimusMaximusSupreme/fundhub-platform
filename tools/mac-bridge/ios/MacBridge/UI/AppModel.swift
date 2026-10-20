import Foundation
import SwiftUI

@MainActor
final class AppModel: ObservableObject {
    @Published private(set) var mac: PairedMac?
    @Published private(set) var sessions: [Session] = []
    @Published private(set) var isLoadingSessions = false
    @Published var listError: String?

    /// A macbridge:// link opened from outside the app, waiting for a yes.
    @Published var incomingPairing: PairingInfo?
    @Published var alertMessage: String?

    let socket = BridgeSocket()
    private var token: String?
    private let store = PairedMacStore()

    init() {
        if let saved = store.load() {
            mac = saved.mac
            token = saved.token
        }
        socket.onSession = { [weak self] s in self?.upsert(s) }
    }

    var api: BridgeAPI? {
        guard let mac, let token else { return nil }
        return BridgeAPI(mac: mac, token: token)
    }

    // MARK: Pairing

    /// Checks GET /v1/health with the token, then saves the Mac. Nothing is saved if the check fails.
    func verifyAndPair(_ info: PairingInfo) async throws {
        let candidate = PairedMac(host: info.host, port: info.port, name: info.name)
        let health = try await BridgeAPI(mac: candidate, token: info.token).health()
        guard health.ok else { throw BridgeError.badResponse }
        var name = info.name.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty || name == info.host, let n = health.name, !n.isEmpty { name = n }
        let paired = PairedMac(host: info.host, port: info.port, name: name.isEmpty ? info.host : name)

        socket.stop()
        guard store.save(mac: paired, token: info.token) else {
            throw BridgeError.unreachable("Could not save the token in the Keychain.")
        }
        mac = paired
        token = info.token
        sessions = []
        listError = nil
        socket.start(mac: paired, token: info.token)
        await refreshSessions()
    }

    func forget() {
        socket.stop()
        store.clear()
        mac = nil
        token = nil
        sessions = []
        listError = nil
    }

    func handleIncoming(_ url: URL) {
        do {
            incomingPairing = try PairingLink.parse(url)
        } catch {
            alertMessage = error.localizedDescription
        }
    }

    func confirmIncoming(_ info: PairingInfo) async {
        incomingPairing = nil
        do {
            try await verifyAndPair(info)
        } catch {
            alertMessage = "Pairing failed. \(error.localizedDescription)"
        }
    }

    // MARK: Sessions

    func refreshSessions() async {
        guard let api else { return }
        isLoadingSessions = true
        defer { isLoadingSessions = false }
        do {
            sessions = Self.sorted(try await api.sessions())
            listError = nil
        } catch {
            listError = error.localizedDescription
        }
    }

    private func upsert(_ s: Session) {
        var list = sessions
        if let i = list.firstIndex(where: { $0.key == s.key }) {
            list[i] = s
        } else {
            list.append(s)
        }
        sessions = Self.sorted(list)
    }

    static func sorted(_ list: [Session]) -> [Session] {
        list.sorted { a, b in
            let da = a.updatedDate ?? .distantPast
            let db = b.updatedDate ?? .distantPast
            return da == db ? a.key < b.key : da > db
        }
    }

    // MARK: App life

    func onAppear() {
        guard let mac, let token else { return }
        socket.ensureRunning(mac: mac, token: token)
        Task { await refreshSessions() }
    }

    func scenePhaseChanged(_ phase: ScenePhase) {
        guard let mac, let token else { return }
        switch phase {
        case .active:
            socket.ensureRunning(mac: mac, token: token)
            Task { await refreshSessions() }
        case .background:
            socket.stop()
        default:
            break
        }
    }
}
