import Foundation
import SwiftUI

@MainActor
final class AppModel: ObservableObject {
    @Published private(set) var mac: PairedMac?
    @Published private(set) var sessions: [Session] = []
    @Published private(set) var isLoadingSessions = false
    @Published var listError: String?

    /// v2: every task the Mac knows about, newest first, kept live by the WebSocket.
    @Published private(set) var tasks: [BridgeTask] = []

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
        socket.onTask = { [weak self] t in self?.upsertTask(t) }
        socket.onHello = { [weak self] in
            Task { await self?.refreshTasks() }
        }
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
        tasks = []
        listError = nil
        socket.start(mac: paired, token: info.token)
        await refreshSessions()
        await refreshTasks()
    }

    func forget() {
        socket.stop()
        store.clear()
        mac = nil
        token = nil
        sessions = []
        tasks = []
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

    // MARK: Tasks (v2)

    var runningTasks: [BridgeTask] { TaskList.running(tasks) }

    func task(id: String) -> BridgeTask? {
        tasks.first { $0.id == id }
    }

    func activeTask(for session: Session) -> BridgeTask? {
        TaskList.activeTask(in: tasks, for: session)
    }

    /// The list row for a task's session, or a stand-in until the list has it.
    func session(for task: BridgeTask) -> Session? {
        guard let sid = task.sessionId, !sid.isEmpty else { return nil }
        if let s = sessions.first(where: { $0.key == SessionKey.make(tool: task.tool, id: sid) }) {
            return s
        }
        return task.placeholderSession()
    }

    /// Quiet on purpose: an older v1 helper has no /v1/tasks and answers 404.
    func refreshTasks() async {
        guard let api else { return }
        guard let list = try? await api.tasks() else { return }
        // Keep any newer copy the socket already gave us.
        var merged = TaskList.sorted(list)
        for t in tasks where !list.contains(where: { $0.id == t.id }) {
            merged = TaskList.upsert(merged, t)
        }
        tasks = merged
    }

    /// Sends the task. Throws `BridgeError.busy/.unauthorized` (or another plain error) with plain words.
    func startTask(_ body: NewTaskRequest) async throws -> BridgeTask {
        guard let api else { throw BridgeError.badAddress }
        let t = try await api.startTask(body)
        upsertTask(t)
        return t
    }

    func stopTask(id: String) async {
        guard let api else { return }
        do {
            upsertTask(try await api.stopTask(id: id))
        } catch BridgeError.notFound {
            alertMessage = "The Mac does not have that task any more."
            await refreshTasks()
        } catch {
            alertMessage = "Could not stop the task. \(error.localizedDescription)"
        }
    }

    private func upsertTask(_ t: BridgeTask) {
        tasks = TaskList.upsert(tasks, t)
    }

    // MARK: App life

    func onAppear() {
        guard let mac, let token else { return }
        socket.ensureRunning(mac: mac, token: token)
        Task {
            await refreshSessions()
            await refreshTasks()
        }
    }

    func scenePhaseChanged(_ phase: ScenePhase) {
        guard let mac, let token else { return }
        switch phase {
        case .active:
            socket.ensureRunning(mac: mac, token: token)
            Task {
                await refreshSessions()
                await refreshTasks()
            }
        case .background:
            socket.stop()
        default:
            break
        }
    }
}
