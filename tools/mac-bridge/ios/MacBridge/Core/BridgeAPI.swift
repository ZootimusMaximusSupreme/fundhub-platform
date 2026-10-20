import Foundation

enum BridgeError: LocalizedError, Equatable {
    case badAddress
    case unauthorized
    case notFound
    case http(Int)
    case unreachable(String)
    case badResponse

    var errorDescription: String? {
        switch self {
        case .badAddress: return "That Mac address does not look right."
        case .unauthorized: return "The Mac said the token is wrong. Pair again."
        case .notFound: return "The Mac does not have that session any more."
        case .http(let code): return "The Mac answered with error \(code)."
        case .unreachable(let why): return "Can't reach the Mac. \(why)"
        case .badResponse: return "The Mac sent something this app can't read."
        }
    }
}

/// HTTP side of the protocol. All GET, all JSON, bearer token on every call.
struct BridgeAPI {
    let mac: PairedMac
    let token: String
    var urlSession: URLSession = .shared

    static let maxEventPage = 500

    func health() async throws -> HealthResponse {
        try await get("/v1/health")
    }

    func sessions() async throws -> [Session] {
        let r: SessionsResponse = try await get("/v1/sessions")
        return r.sessions
    }

    func events(tool: String, id: String, after: Int, limit: Int = BridgeAPI.maxEventPage) async throws -> [Event] {
        let r: EventsResponse = try await get(
            "/v1/sessions/\(Self.segment(tool))/\(Self.segment(id))/events",
            query: [
                URLQueryItem(name: "after", value: String(after)),
                URLQueryItem(name: "limit", value: String(limit))
            ]
        )
        return r.events
    }

    func request(path: String, query: [URLQueryItem] = []) throws -> URLRequest {
        guard let base = mac.baseURL(scheme: "http"),
              var comps = URLComponents(url: base, resolvingAgainstBaseURL: false) else {
            throw BridgeError.badAddress
        }
        comps.percentEncodedPath = path
        if !query.isEmpty { comps.queryItems = query }
        guard let url = comps.url else { throw BridgeError.badAddress }
        var req = URLRequest(url: url, timeoutInterval: 10)
        req.httpMethod = "GET"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        return req
    }

    private func get<T: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
        let req = try request(path: path, query: query)
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await urlSession.data(for: req)
        } catch {
            throw BridgeError.unreachable(error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else { throw BridgeError.badResponse }
        switch http.statusCode {
        case 200..<300: break
        case 401: throw BridgeError.unauthorized
        case 404: throw BridgeError.notFound
        default: throw BridgeError.http(http.statusCode)
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw BridgeError.badResponse
        }
    }

    /// Percent-encode one path piece (session ids never contain "/", but be safe).
    static func segment(_ s: String) -> String {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/")
        return s.addingPercentEncoding(withAllowedCharacters: allowed) ?? s
    }
}
