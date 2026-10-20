import Foundation

/// One session's feed: pages in old events with `after=`, then takes new ones from the socket.
/// Events are kept in seq order with no repeats; a gap in seq triggers a catch-up fetch.
@MainActor
final class FeedModel: ObservableObject {
    @Published private(set) var events: [Event] = []
    @Published private(set) var loading = false
    @Published var error: String?

    let session: Session
    private let api: BridgeAPI
    private let socket: BridgeSocket
    private var lastSeq = 0
    private var catchingUp = false
    private var catchUpAgain = false

    init(session: Session, api: BridgeAPI, socket: BridgeSocket) {
        self.session = session
        self.api = api
        self.socket = socket
    }

    func start() async {
        socket.subscribe(tool: session.tool, sessionId: session.id) { [weak self] e in
            self?.receive(e)
        }
        await catchUp()
    }

    func stop() {
        socket.unsubscribe(tool: session.tool, sessionId: session.id)
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
            } catch {
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
