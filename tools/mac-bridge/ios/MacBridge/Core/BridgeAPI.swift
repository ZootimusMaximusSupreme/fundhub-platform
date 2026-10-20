import Foundation

enum BridgeError: LocalizedError, Equatable {
    case badAddress
    case unauthorized
    case notFound
    case http(Int)
    case unreachable(String)
    case badResponse
    /// 429: the Mac already runs 3 tasks.
    case busy
    /// 400 / 413: the Mac did not accept the request (for example a prompt that is too long).
    case rejected(String)

    var errorDescription: String? {
        switch self {
        case .badAddress: return "That Mac address does not look right."
        case .unauthorized: return "The Mac said the token is wrong. Pair again."
        case .notFound: return "The Mac does not have that session any more."
        case .http(let code): return "The Mac answered with error \(code)."
        case .unreachable(let why): return "Can't reach the Mac. \(why)"
        case .badResponse: return "The Mac sent something this app can't read."
        case .busy: return "The Mac is already running 3 tasks. Wait for one to finish, or stop one, then send again."
        case .rejected(let why): return "The Mac did not take this task (\(why))."
        }
    }

    /// Turns a non-2xx answer into an error the person can read. nil for 2xx.
    static func from(status: Int, body: Data) -> BridgeError? {
        struct Body: Decodable {
            var error: String?
        }
        let parsed = try? JSONDecoder().decode(Body.self, from: body)
        switch status {
        case 200..<300:
            return nil
        case 401:
            return .unauthorized
        case 404:
            return .notFound
        case 429:
            return .busy
        case 400, 413:
            return .rejected(parsed?.error ?? "bad request")
        default:
            return .http(status)
        }
    }
}

/// HTTP side of the protocol. All JSON, bearer token on every call.
/// v1 reads are GET; v2 tasks add three calls (`POST /v1/tasks`, `GET /v1/tasks`, `POST /v1/tasks/:id/stop`).
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

    // MARK: v2 tasks

    /// `POST /v1/tasks` → `202 { task }`. Throws `.busy`, `.unauthorized` or a plain error with the code.
    func startTask(_ body: NewTaskRequest) async throws -> BridgeTask {
        let r: TaskResponse = try await send(try startTaskRequest(body))
        return r.task
    }

    func tasks() async throws -> [BridgeTask] {
        let r: TasksResponse = try await get("/v1/tasks")
        return r.tasks
    }

    func stopTask(id: String) async throws -> BridgeTask {
        let r: TaskResponse = try await send(try stopTaskRequest(id: id))
        return r.task
    }

    func startTaskRequest(_ body: NewTaskRequest) throws -> URLRequest {
        try request(path: "/v1/tasks", method: "POST", body: try JSONEncoder().encode(body))
    }

    func stopTaskRequest(id: String) throws -> URLRequest {
        try request(path: "/v1/tasks/\(Self.segment(id))/stop", method: "POST")
    }

    // MARK: Plumbing

    func request(path: String, query: [URLQueryItem] = [], method: String = "GET", body: Data? = nil) throws -> URLRequest {
        guard let base = mac.baseURL(scheme: "http"),
              var comps = URLComponents(url: base, resolvingAgainstBaseURL: false) else {
            throw BridgeError.badAddress
        }
        comps.percentEncodedPath = path
        if !query.isEmpty { comps.queryItems = query }
        guard let url = comps.url else { throw BridgeError.badAddress }
        var req = URLRequest(url: url, timeoutInterval: 10)
        req.httpMethod = method
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return req
    }

    private func get<T: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
        try await send(try request(path: path, query: query))
    }

    private func send<T: Decodable>(_ req: URLRequest) async throws -> T {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await urlSession.data(for: req)
        } catch {
            throw BridgeError.unreachable(error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else { throw BridgeError.badResponse }
        if let err = BridgeError.from(status: http.statusCode, body: data) { throw err }
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
