import Foundation
import Network

/// Finds Mac helpers on the Wi-Fi that advertise `_macbridge._tcp`.
@MainActor
final class BonjourBrowser: ObservableObject {
    struct Found: Identifiable, Hashable {
        let id: String
        let displayName: String
        let endpoint: NWEndpoint
    }

    @Published private(set) var found: [Found] = []
    @Published private(set) var problem: String?

    private var browser: NWBrowser?

    func start() {
        guard browser == nil else { return }
        let params = NWParameters()
        params.includePeerToPeer = true
        let b = NWBrowser(for: .bonjourWithTXTRecord(type: "_macbridge._tcp", domain: nil), using: params)
        b.browseResultsChangedHandler = { [weak self] results, _ in
            let items: [Found] = results.compactMap { r in
                guard case let .service(name, _, _, _) = r.endpoint else { return nil }
                var display = name
                if case let .bonjour(txt) = r.metadata, let n = txt["name"], !n.isEmpty {
                    display = n
                }
                return Found(id: name, displayName: display, endpoint: r.endpoint)
            }
            Task { @MainActor [weak self] in
                self?.found = items.sorted { $0.displayName < $1.displayName }
            }
        }
        b.stateUpdateHandler = { [weak self] state in
            let text: String?
            switch state {
            case .failed(let e): text = "Search stopped: \(e.localizedDescription)"
            case .waiting(let e): text = "Allow Local Network for Mac Bridge in Settings. (\(e.localizedDescription))"
            default: text = nil
            }
            Task { @MainActor [weak self] in self?.problem = text }
        }
        browser = b
        b.start(queue: .main)
    }

    func stop() {
        browser?.cancel()
        browser = nil
    }

    /// Turns a Bonjour service into an IPv4 host and port by opening a short TCP link to it.
    nonisolated static func resolve(_ endpoint: NWEndpoint, timeout: TimeInterval = 6) async throws -> (host: String, port: Int) {
        let params = NWParameters.tcp
        if let ip = params.defaultProtocolStack.internetProtocol as? NWProtocolIP.Options {
            ip.version = .v4
        }
        let conn = NWConnection(to: endpoint, using: params)
        let once = ResumeOnce()

        return try await withCheckedThrowingContinuation { (cont: CheckedContinuation<(host: String, port: Int), Error>) in
            conn.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    if case let .hostPort(host, port)? = conn.currentPath?.remoteEndpoint,
                       once.claim() {
                        cont.resume(returning: (hostString(host), Int(port.rawValue)))
                    } else if once.claim() {
                        cont.resume(throwing: BridgeError.unreachable("Could not read the Mac's address."))
                    }
                    conn.cancel()
                case .failed(let e):
                    if once.claim() { cont.resume(throwing: BridgeError.unreachable(e.localizedDescription)) }
                    conn.cancel()
                default:
                    break
                }
            }
            conn.start(queue: .global())
            DispatchQueue.global().asyncAfter(deadline: .now() + timeout) {
                if once.claim() {
                    cont.resume(throwing: BridgeError.unreachable("The Mac did not answer in time."))
                }
                conn.cancel()
            }
        }
    }

    nonisolated static func hostString(_ host: NWEndpoint.Host) -> String {
        let raw: String
        switch host {
        case .ipv4(let a): raw = "\(a)"
        case .ipv6(let a): return "\(a)"
        case .name(let n, _): raw = n
        @unknown default: raw = "\(host)"
        }
        // Drop an interface suffix like "%en0" from an IPv4 address or name.
        return raw.split(separator: "%").first.map(String.init) ?? raw
    }
}

/// Makes sure a continuation resumes exactly once.
private final class ResumeOnce: @unchecked Sendable {
    private let lock = NSLock()
    private var done = false

    func claim() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if done { return false }
        done = true
        return true
    }
}
