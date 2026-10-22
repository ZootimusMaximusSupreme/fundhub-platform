import XCTest
@testable import Fundhub

final class FundhubTests: XCTestCase {
    func testFaceIDPurposeIsPresentForTheApp() {
        let purpose = Bundle.main.object(forInfoDictionaryKey: "NSFaceIDUsageDescription") as? String
        XCTAssertEqual(purpose, "Use Face ID to unlock your saved Fundhub sign-in.")
    }

    func testRoleHomesAreSeparate() {
        XCTAssertEqual(FundhubRole.workspacePath(principal: "client", role: "owner"), "/app/client-portal.html")
        XCTAssertEqual(FundhubRole.workspacePath(principal: "staff", role: "closer"), "/app/closer-dashboard.html")
        XCTAssertEqual(FundhubRole.workspacePath(principal: "staff", role: "csm"), "/app/csm-queue.html")
    }

    func testClientStageAndDueDecodeFromExistingAPI() throws {
        let data = Data(#"{"ok":true,"stage":{"key":"call_held"},"advisor":{"name":"Alex"},"documents":[],"invoice_due":{"count":0,"total_display":"$0.00"}}"#.utf8)
        let summary = try JSONDecoder().decode(PortalSummary.self, from: data)
        XCTAssertEqual(summary.stage.title, "Your call is complete")
        XCTAssertEqual(summary.invoiceDue?.count, 0)
    }

    func testOnlyFundhubEmailLinkIsAccepted() {
        XCTAssertEqual(MagicLink.token(from: "https://fundhub.ai/portal-login.html?t=abc123"), "abc123")
        XCTAssertNil(MagicLink.token(from: "https://evil.example/portal-login.html?t=abc123"))
        XCTAssertNil(MagicLink.token(from: "https://fundhub.ai/portal-login.html"))
    }

    func testClientSummaryUsesBearerTokenWithoutClientIdQuery() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        let api = FundhubAPI(session: URLSession(configuration: config))
        StubURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.absoluteString, "https://fundhub.ai/api/read/portal-summary")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-session")
            return (200, Data(#"{"ok":true,"stage":{"key":"booked"},"advisor":null,"documents":[],"invoice_due":{"count":0,"total_display":"$0.00"}}"#.utf8))
        }
        defer { StubURLProtocol.handler = nil }
        let summary = try await api.portalSummary(token: "test-session")
        XCTAssertEqual(summary.stage.title, "Getting started")
    }

    func testNativeLogoutRevokesTheBearerSession() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        let api = FundhubAPI(session: URLSession(configuration: config))
        StubURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/auth/logout")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-session")
            return (200, Data(#"{"ok":true}"#.utf8))
        }
        defer { StubURLProtocol.handler = nil }
        try await api.logout(token: "test-session")
    }

    func testNativePushEnvironmentOnlyAcceptsAppleEnvironments() {
        XCTAssertEqual(NativePushEnvironment.current(), "development")
        XCTAssertEqual(NativePushEnvironment.valid("development"), "development")
        XCTAssertEqual(NativePushEnvironment.valid("production"), "production")
        XCTAssertNil(NativePushEnvironment.valid("sandbox"))
        XCTAssertNil(NativePushEnvironment.valid(nil))
        XCTAssertNotNil(UUID(uuidString: NativePushInstallation.id))
    }

    func testNativePushStatusUsesThisInstallationAndBearerSession() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        let api = FundhubAPI(session: URLSession(configuration: config))
        let installationId = "56a40391-e541-4a89-873b-37eab9d6d953"
        StubURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/push/native-device")
            XCTAssertEqual(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "installation_id" })?.value, installationId)
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-session")
            return (200, Data(#"{"ok":true,"configured":true,"registered":false}"#.utf8))
        }
        defer { StubURLProtocol.handler = nil }
        let status = try await api.nativePushStatus(token: "test-session", installationId: installationId)
        XCTAssertTrue(status.configured)
        XCTAssertFalse(status.registered)
    }

    func testNativePushRegisterAndUnregisterUseTheSameInstallation() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        let api = FundhubAPI(session: URLSession(configuration: config))
        let installationId = "56a40391-e541-4a89-873b-37eab9d6d953"
        var methods: [String] = []
        StubURLProtocol.handler = { request in
            methods.append(request.httpMethod ?? "")
            XCTAssertEqual(request.url?.path, "/api/push/native-device")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-session")
            let body = (try? JSONSerialization.jsonObject(with: request.bodyData())) as? [String: String]
            XCTAssertEqual(body?["installation_id"], installationId)
            if request.httpMethod == "POST" {
                XCTAssertEqual(body?["token"], String(repeating: "ab", count: 32))
                XCTAssertEqual(body?["environment"], "development")
            }
            return (200, Data(#"{"ok":true}"#.utf8))
        }
        defer { StubURLProtocol.handler = nil }
        try await api.registerNativePush(token: "test-session", deviceToken: String(repeating: "ab", count: 32),
                                         environment: "development", installationId: installationId)
        try await api.unregisterNativePush(token: "test-session", installationId: installationId)
        XCTAssertEqual(methods, ["POST", "DELETE"])
    }

    func testNotificationTapAcceptsOnlyTheClientPortalPath() {
        XCTAssertTrue(NativePushTap.opensClientPortal(["path": "/app/client-portal.html"]))
        for path in [
            "https://evil.example/join", "//evil.example/join",
            "/app/closer-dashboard.html", "/app/client-portal.html?client_id=other",
            "/app/client-portal.html#old-call", "tel:+15551234567"
        ] {
            XCTAssertFalse(NativePushTap.opensClientPortal(["path": path]), path)
        }
        XCTAssertFalse(NativePushTap.opensClientPortal([:]))
        XCTAssertFalse(NativePushTap.opensClientPortal(["path": 123]))
    }

    @MainActor
    func testNotificationTapRequestIsOneUseAndExpires() {
        let push = NativePushCenter.shared
        let tappedAt = Date(timeIntervalSince1970: 1_700_000_000)
        _ = push.takePortalOpenRequest(now: tappedAt)
        XCTAssertFalse(push.recordNotificationTap(userInfo: ["path": "https://evil.example/join"], now: tappedAt))
        XCTAssertFalse(push.takePortalOpenRequest(now: tappedAt))

        XCTAssertTrue(push.recordNotificationTap(userInfo: ["path": NativePushTap.portalPath], now: tappedAt))
        XCTAssertTrue(push.takePortalOpenRequest(now: tappedAt.addingTimeInterval(60)))
        XCTAssertFalse(push.takePortalOpenRequest(now: tappedAt.addingTimeInterval(61)))

        XCTAssertTrue(push.recordNotificationTap(userInfo: ["path": NativePushTap.portalPath], now: tappedAt))
        XCTAssertFalse(push.takePortalOpenRequest(now: tappedAt.addingTimeInterval(NativePushTap.requestLifetime + 1)))
    }

    func testServerErrorDoesNotInvalidateSession() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        let api = FundhubAPI(session: URLSession(configuration: config))
        StubURLProtocol.handler = { _ in (500, Data(#"{"ok":false}"#.utf8)) }
        defer { StubURLProtocol.handler = nil }
        do {
            _ = try await api.identity(token: "test-session")
            XCTFail("A 500 is not a valid session reply")
        } catch FundhubAPIError.unavailable {
            // Keep the Keychain token and allow a retry.
        }
    }

    func testRefusedLoginShowsTheServersReason() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        let api = FundhubAPI(session: URLSession(configuration: config))
        defer { StubURLProtocol.handler = nil }

        StubURLProtocol.handler = { _ in (403, Data(#"{"ok":false,"error":"demo_logins_disabled","message":"Demo sign-ins are off."}"#.utf8)) }
        do {
            _ = try await api.login(email: "a@b.co", password: "x")
            XCTFail("A 403 must not sign in")
        } catch FundhubAPIError.refused(let text) {
            XCTAssertEqual(text, "Demo sign-ins are off.")
        }

        StubURLProtocol.handler = { _ in (429, Data(#"{"ok":false,"error":"rate_limited"}"#.utf8)) }
        do {
            _ = try await api.login(email: "a@b.co", password: "x")
            XCTFail("A 429 must not sign in")
        } catch FundhubAPIError.refused(let text) {
            XCTAssertTrue(text.hasPrefix("Too many tries"))
        }

        StubURLProtocol.handler = { _ in (401, Data(#"{"ok":false,"error":"invalid_credentials"}"#.utf8)) }
        do {
            _ = try await api.login(email: "a@b.co", password: "x")
            XCTFail("A 401 must not sign in")
        } catch FundhubAPIError.invalidSession {
            XCTAssertEqual(FundhubAPIError.invalidSession.errorDescription, "Wrong email or password. Check them and try again.")
        }
    }

    func testWebSignOutDestinationIsExact() {
        XCTAssertTrue(WorkspaceNavigation.isSignOutDestination(URL(string: "https://fundhub.ai/portal-login.html")!))
        XCTAssertTrue(WorkspaceNavigation.isSignOutDestination(URL(string: "https://fundhub.ai/login.html")!))
        XCTAssertFalse(WorkspaceNavigation.isSignOutDestination(URL(string: "https://fundhub.ai/app/client-portal.html")!))
        XCTAssertFalse(WorkspaceNavigation.isSignOutDestination(URL(string: "https://evil.example/login.html")!))
    }
}

private final class StubURLProtocol: URLProtocol {
    static var handler: ((URLRequest) -> (Int, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let (status, data) = Self.handler?(request), let url = request.url,
              let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil) else {
            client?.urlProtocol(self, didFailWithError: FundhubAPIError.invalidResponse)
            return
        }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

private extension URLRequest {
    func bodyData() -> Data {
        if let httpBody { return httpBody }
        guard let httpBodyStream else { return Data() }
        httpBodyStream.open()
        defer { httpBodyStream.close() }
        var result = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while httpBodyStream.hasBytesAvailable {
            let count = httpBodyStream.read(&buffer, maxLength: buffer.count)
            if count <= 0 { break }
            result.append(contentsOf: buffer[..<count])
        }
        return result
    }
}
