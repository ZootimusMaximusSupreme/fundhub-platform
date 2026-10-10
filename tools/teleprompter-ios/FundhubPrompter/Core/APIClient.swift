import Foundation

/// One answer from the server. status 0 = no connection.
struct HTTPResult {
    var status: Int
    var data: Data?

    var isOffline: Bool { status == 0 }
    var ok: Bool { status >= 200 && status < 300 }

    func decode<T: Decodable>(_ type: T.Type) -> T? {
        guard let d = data else { return nil }
        return try? JSONDecoder().decode(T.self, from: d)
    }

    /// The server's plain-words message, if it sent one.
    var message: String? { decode(ErrorAnswer.self)?.message }
}

/// How the app talks to the server. Tests and the screenshot demo use their own.
protocol Transport: AnyObject {
    func send(_ method: String, _ path: String, body: [String: Any]?) async -> HTTPResult
}

/// The real server: https://fundhub.ai/api/<path>, with the staff sign-in as a
/// Bearer token (src/http/middleware/requireAuth.mjs reads Authorization: Bearer).
final class APIClient: Transport {
    var baseURL: URL
    var token: String?
    let session: URLSession

    init(baseURL: URL, token: String?, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.token = token
        self.session = session
    }

    func request(_ method: String, _ path: String, body: [String: Any]?) -> URLRequest {
        var base = baseURL.absoluteString
        while base.hasSuffix("/") { base.removeLast() }
        let url = URL(string: base + "/api/" + path) ?? baseURL
        var r = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        r.httpMethod = method
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        if let t = token, !t.isEmpty { r.setValue("Bearer " + t, forHTTPHeaderField: "Authorization") }
        if let b = body {
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            r.httpBody = try? JSONSerialization.data(withJSONObject: b, options: [.sortedKeys])
        }
        return r
    }

    func send(_ method: String, _ path: String, body: [String: Any]?) async -> HTTPResult {
        do {
            let (data, resp) = try await session.data(for: request(method, path, body: body))
            return HTTPResult(status: (resp as? HTTPURLResponse)?.statusCode ?? 0, data: data)
        } catch {
            return HTTPResult(status: 0, data: nil)
        }
    }
}

/// The request ids the server keys a save on (docs/specs/marketing-machine-api.md §2).
enum RequestID {
    static func make() -> String { UUID().uuidString.lowercased() }
}

extension ScriptPart {
    var json: [String: Any] { ["kind": kind, "text": text] }
}
