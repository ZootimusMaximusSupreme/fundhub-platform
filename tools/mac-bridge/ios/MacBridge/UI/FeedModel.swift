import Foundation

/// One session's feed: pages in old events with `after=`, then takes new ones from the socket.
/// Events are kept in seq order with no repeats; a gap in seq triggers a catch-up fetch.
@MainActor
final class FeedModel: ObservableObject {
    @Published private(set) var events: [Event] = []
    @Published private(set) var loading = false
    @Published var error: String?
    /// v2: a task just started this session and the Mac has not listed its file yet.
    @Published private(set) var waitingForStart = false

    let session: Session
    private let api: BridgeAPI
    private let socket: BridgeSocket
    private var lastSeq = 0
    private var catchingUp = false
    private var catchUpAgain = false
    private var notFoundYet = false
    private var stopped = false

    /// How long a brand-new session may take to show up on the Mac (1 try a second).
    static let startWaitTries = 30

    init(session: Session, api: BridgeAPI, socket: BridgeSocket) {
        self.session = session
        self.api = api
        self.socket = socket
    }

    func start() async {
        stopped = false
        subscribe()
        await catchUp()
        // A session a task just started may not be on the Mac's list yet. The helper ignores
        // a subscribe to a session it does not know, so wait, subscribe again, and retry.
        var tries = 0
        while notFoundYet && events.isEmpty && tries < Self.startWaitTries && !stopped && !Task.isCancelled {
            waitingForStart = true
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            if stopped || Task.isCancelled { break }
            subscribe()
            await catchUp()
            tries += 1
        }
        let waited = waitingForStart
        waitingForStart = false
        if notFoundYet && events.isEmpty && !stopped {
            error = BridgeError.notFound.localizedDescription
        } else if waited && !stopped {
            // The Mac knows the session now: subscribe once more so live lines flow, then fill any gap.
            subscribe()
            await catchUp()
        }
    }

    func stop() {
        stopped = true
        socket.unsubscribe(tool: session.tool, sessionId: session.id)
    }

    private func subscribe() {
        socket.subscribe(tool: session.tool, sessionId: session.id) { [weak self] e in
            self?.receive(e)
        }
    }

    /// Fetch everything after the last seq we have, page by page.
    func catchUp() async {
        if catchingUp {
            catchUpAgain = true
            return
        }
        catchingUp = true
        loading = events.isEmpty
        defer {
            catchingUp = false
            loading = false
        }
        repeat {
            catchUpAgain = false
            do {
                while true {
                    let page = try await api.events(tool: session.tool, id: session.id, after: lastSeq)
                    append(page)
                    if page.count < BridgeAPI.maxEventPage { break }
                }
                error = nil
                notFoundYet = false
            } catch {
                // Only a brand-new session (no events yet) waits; a known one shows the error at once, as in v1.
                if (error as? BridgeError) == .notFound && events.isEmpty && session.eventCount == 0 {
                    notFoundYet = true
                    return
                }
                self.error = error.localizedDescription
                return
            }
        } while catchUpAgain
    }

    private func receive(_ e: Event) {
        if e.seq <= lastSeq { return }
        if e.seq == lastSeq + 1 {
            append([e])
        } else {
            Task { await catchUp() }
        }
    }

    private func append(_ new: [Event]) {
        var added: [Event] = []
        for e in new.sorted(by: { $0.seq < $1.seq }) where e.seq > lastSeq {
            added.append(e)
            lastSeq = e.seq
        }
        if !added.isEmpty { events.append(contentsOf: added) }
    }
}
