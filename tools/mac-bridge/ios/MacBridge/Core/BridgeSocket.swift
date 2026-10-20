import Foundation

/// The one shared WebSocket to the Mac helper (`/v1/stream?token=…`).
/// Reconnects with backoff (1s → 30s) and re-sends every subscribe after each reconnect.
@MainActor
final class BridgeSocket: ObservableObject {
    enum State: Equatable {
        case idle
        case connecting
        case connected
        case waiting(retryIn: Int)
        case unauthorized
    }

    @Published private(set) var state: State = .idle
    /// Goes up by one on every good connect ("hello"). Screens watch it to catch up on missed events.
    @Published private(set) var connectCount = 0

    var onSession: ((Session) -> Void)?

    private struct Subscription {
        var tool: String
        var sessionId: String
        var handler: (Event) -> Void
    }

    private var subscriptions: [String: Subscription] = [:]
    private var target: (mac: PairedMac, token: String)?
    private var task: URLSessionWebSocketTask?
    private let urlSession = URLSession(configuration: .default)
    private var backoff = Backoff()
    private var generation = 0
    private var reconnectTask: Task<Void, Never>?
    private var pingTask: Task<Void, Never>?

    // MARK: Public

    func start(mac: PairedMac, token: String) {
        target = (mac, token)
        backoff.reset()
        connect()
    }

    func stop() {
        target = nil
        teardown()
        state = .idle
    }

    /// Connect now unless already up (for example when the app comes back to the front).
    func ensureRunning(mac: PairedMac, token: String) {
        if target?.mac == mac, target?.token == token, state == .connected || state == .connecting { return }
        start(mac: mac, token: token)
    }

    func subscribe(tool: String, sessionId: String, handler: @escaping (Event) -> Void) {
        subscriptions[SessionKey.make(tool: tool, id: sessionId)] = Subscription(tool: tool, sessionId: sessionId, handler: handler)
        if state == .connected {
            send(.subscribe(tool: tool, sessionId: sessionId))
        }
    }

    func unsubscribe(tool: String, sessionId: String) {
        guard subscriptions.removeValue(forKey: SessionKey.make(tool: tool, id: sessionId)) != nil else { return }
        if state == .connected {
            send(.unsubscribe(tool: tool, sessionId: sessionId))
        }
    }

    nonisolated static func streamURL(mac: PairedMac, token: String) -> URL? {
        guard let base = mac.baseURL(scheme: "ws"),
              var comps = URLComponents(url: base, resolvingAgainstBaseURL: false) else { return nil }
        comps.path = "/v1/stream"
        comps.queryItems = [URLQueryItem(name: "token", value: token)]
        return comps.url
    }

    // MARK: Connection

    private func connect() {
        teardown()
        guard let target, let url = Self.streamURL(mac: target.mac, token: target.token) else {
            state = .idle
            return
        }
        generation += 1
        let gen = generation
        state = .connecting
        let t = urlSession.webSocketTask(with: url)
        t.maximumMessageSize = 4 * 1024 * 1024
        task = t
        t.resume()
        receiveLoop(task: t, gen: gen)
        pingLoop(task: t, gen: gen)
    }

    private func teardown() {
        reconnectTask?.cancel()
        reconnectTask = nil
        pingTask?.cancel()
        pingTask = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
    }

    private func receiveLoop(task t: URLSessionWebSocketTask, gen: Int) {
        Task { [weak self] in
            while true {
                do {
                    let message = try await t.receive()
                    guard let self, self.generation == gen else { return }
                    self.handle(message)
                } catch {
                    guard let self, self.generation == gen else { return }
                    let status = (t.response as? HTTPURLResponse)?.statusCode
                    self.failed(gen: gen, unauthorized: status == 401)
                    return
                }
            }
        }
    }

    /// A ping every 20 seconds finds a dead link (Wi-Fi dropped, Mac asleep) fast.
    private func pingLoop(task t: URLSessionWebSocketTask, gen: Int) {
        pingTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 20_000_000_000)
                if Task.isCancelled { return }
                t.sendPing { error in
                    guard error != nil else { return }
                    Task { @MainActor [weak self] in
                        guard let self, self.generation == gen else { return }
                        self.failed(gen: gen, unauthorized: false)
                    }
                }
                if self == nil { return }
            }
        }
    }

    private func failed(gen: Int, unauthorized: Bool) {
        guard gen == generation, target != nil else { return }
        teardown()
        generation += 1
        if unauthorized {
            state = .unauthorized
            return
        }
        let delay = backoff.next()
        state = .waiting(retryIn: Int(delay))
        reconnectTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard !Task.isCancelled, let self, self.target != nil else { return }
            self.connect()
        }
    }

    private func handle(_ message: URLSessionWebSocketTask.Message) {
        let data: Data
        switch message {
        case .string(let s): data = Data(s.utf8)
        case .data(let d): data = d
        @unknown default: return
        }
        guard let msg = try? StreamMessage.decode(data) else { return }
        switch msg {
        case .hello:
            state = .connected
            backoff.reset()
            for sub in subscriptions.values {
                send(.subscribe(tool: sub.tool, sessionId: sub.sessionId))
            }
            connectCount += 1
        case .session(let s):
            onSession?(s)
        case .event(let tool, let sessionId, let event):
            subscriptions[SessionKey.make(tool: tool, id: sessionId)]?.handler(event)
        case .unknown:
            break
        }
    }

    private func send(_ m: SubscriptionMessage) {
        guard let t = task,
              let data = try? JSONEncoder().encode(m),
              let text = String(data: data, encoding: .utf8) else { return }
        t.send(.string(text)) { _ in }
    }
}
