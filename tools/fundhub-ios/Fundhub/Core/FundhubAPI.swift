import Foundation
import LocalAuthentication
import Security

enum FundhubAPIError: LocalizedError {
    case unavailable
    case invalidSession
    case refused(String)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .unavailable: return "We could not reach Fundhub. Check your connection and try again."
        case .invalidSession: return "Wrong email or password. Check them and try again."
        case .refused(let message): return message
        case .invalidResponse: return "Fundhub did not send a usable reply. Please try again."
        }
    }
}

struct FundhubAPI {
    static let base = URL(string: "https://fundhub.ai")!
    private static let nativeSession: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieStorage = nil
        return URLSession(configuration: config)
    }()
    var session: URLSession = nativeSession

    func login(email: String, password: String) async throws -> LoginReply {
        try await send("/api/auth/login", method: "POST", body: ["email": email, "password": password])
    }

    func requestLink(email: String) async throws {
        let reply: LinkReply = try await send("/api/auth/magic-link", method: "POST", body: ["email": email])
        guard reply.ok else { throw FundhubAPIError.refused(reply.message ?? "The sign-in link could not be sent.") }
    }

    func exchangeLink(_ token: String) async throws -> LoginReply {
        try await send("/api/auth/magic-link-verify", method: "POST", body: ["token": token])
    }

    func identity(token: String) async throws -> SessionReply {
        try await send("/api/auth/session", bearer: token)
    }

    func portalSummary(token: String) async throws -> PortalSummary {
        try await send("/api/read/portal-summary", bearer: token)
    }

    func nativePushStatus(token: String, installationId: String) async throws -> NativePushStatusReply {
        guard let id = installationId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) else {
            throw FundhubAPIError.invalidResponse
        }
        return try await send("/api/push/native-device?installation_id=\(id)", bearer: token)
    }

    func registerNativePush(token: String, deviceToken: String, environment: String,
                            installationId: String) async throws {
        let reply: NativePushWriteReply = try await send("/api/push/native-device", method: "POST", body: [
            "token": deviceToken, "environment": environment, "installation_id": installationId
        ], bearer: token)
        guard reply.ok else { throw FundhubAPIError.unavailable }
    }

    func unregisterNativePush(token: String, installationId: String) async throws {
        let reply: NativePushWriteReply = try await send("/api/push/native-device", method: "DELETE", body: [
            "installation_id": installationId
        ], bearer: token)
        guard reply.ok else { throw FundhubAPIError.unavailable }
    }

    func logout(token: String) async throws {
        let reply: LogoutReply = try await send("/api/auth/logout", method: "POST", bearer: token)
        guard reply.ok else { throw FundhubAPIError.unavailable }
    }

    private func send<T: Decodable>(_ path: String, method: String = "GET", body: [String: String]? = nil, bearer: String? = nil) async throws -> T {
        guard let url = URL(string: path, relativeTo: Self.base)?.absoluteURL else {
            throw FundhubAPIError.invalidResponse
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = path == "/api/auth/logout" ? 5 : 20
        if let bearer { request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        let data: Data
        let response: URLResponse
        do { (data, response) = try await session.data(for: request) }
        catch { throw FundhubAPIError.unavailable }
        guard let http = response as? HTTPURLResponse else { throw FundhubAPIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            if http.statusCode == 401 {
                // A dead link explains itself; a bad password and a dead session do not.
                if path == "/api/auth/magic-link-verify",
                   let reason = try? JSONDecoder().decode(ServerRefusal.self, from: data), let text = reason.message {
                    throw FundhubAPIError.refused(text)
                }
                throw FundhubAPIError.invalidSession
            }
            if http.statusCode >= 500 { throw FundhubAPIError.unavailable }
            // 403 and 429 carry a plain reason from the server. Show it.
            if let reason = try? JSONDecoder().decode(ServerRefusal.self, from: data), let text = reason.message, !text.isEmpty {
                throw FundhubAPIError.refused(text)
            }
            if http.statusCode == 429 { throw FundhubAPIError.refused("Too many tries. Wait a few minutes and try again.") }
            throw FundhubAPIError.refused("Fundhub could not complete this request. Please try again.")
        }
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw FundhubAPIError.invalidResponse }
    }
}

private struct LinkReply: Decodable {
    let ok: Bool
    let message: String?
}

private struct ServerRefusal: Decodable {
    let message: String?
}

private struct LogoutReply: Decodable {
    let ok: Bool
}

enum SessionKeychain {
    private static let service = "ai.fundhub.app.session"
    private static let account = "fundhub"
    private static let savedSessionKey = "ai.fundhub.app.hasSavedSession"

    static var hasSavedSession: Bool {
        UserDefaults.standard.bool(forKey: savedSessionKey)
    }

    static var unlockLabel: String {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error),
              context.biometryType == .faceID else { return "Unlock saved sign-in" }
        return "Continue with Face ID"
    }

    static func read() -> String? {
        guard hasSavedSession else { return nil }
        let context = LAContext()
        context.localizedReason = "Unlock your Fundhub sign-in"
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecUseAuthenticationContext as String: context
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { UserDefaults.standard.removeObject(forKey: savedSessionKey) }
        guard status == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    @discardableResult
    static func save(_ token: String) -> Bool {
        clear()
        var accessError: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(
            nil,
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            .userPresence,
            &accessError
        ) else { return false }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: Data(token.utf8),
            kSecAttrAccessControl as String: access
        ]
        let saved = SecItemAdd(query as CFDictionary, nil) == errSecSuccess
        if saved { UserDefaults.standard.set(true, forKey: savedSessionKey) }
        return saved
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: savedSessionKey)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        SecItemDelete(query as CFDictionary)
    }
}
