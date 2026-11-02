import XCTest
@testable import Fundhub

final class FundhubTests: XCTestCase {
    func testFaceIDPurposeIsPresentForTheApp() {
        let purpose = Bundle.main.object(forInfoDictionaryKey: "NSFaceIDUsageDescription") as? String
        XCTAssertEqual(purpose, "Use Face ID to unlock your saved Fundhub sign-in.")
    }

    func testRoleHomesAreSeparate() {
        XCTAssertEqual(FundhubRole.workspacePath(principal: "client", role: "owner"), "/app/client-portal.html")
        XCTAssertEqual(FundhubRole.workspacePath(principal: "staff", role: "setter"), "/app/setter-dashboard.html")
        XCTAssertEqual(FundhubRole.workspacePath(principal: "client", role: "setter"), "/app/client-portal.html")
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

    func testStaffAlertTapOpensOnlyAValidatedClientInTheRightWorkspace() {
        let id = "56a40391-e541-4a89-873b-37eab9d6d953"
        let alert = NativePushTap.staffAlert(["path": NativePushTap.staffPath,
                                              "kind": "lead", "client_id": id])
        XCTAssertEqual(alert?.workspacePath(role: "setter"), "/app/setter-dashboard.html?client_id=\(id)")
        XCTAssertEqual(alert?.workspacePath(role: "closer"), "/app/closer-dashboard.html?client_id=\(id)")
        XCTAssertEqual(alert?.workspacePath(role: "owner"), "/app/setter-dashboard.html?client_id=\(id)")
        XCTAssertNil(alert?.workspacePath(role: "csm"))
        let set = NativePushTap.staffAlert(["path": NativePushTap.staffPath,
                                            "kind": "set", "client_id": id])
        XCTAssertEqual(set?.workspacePath(role: "owner"), "/app/closer-dashboard.html?client_id=\(id)")
        XCTAssertNil(set?.workspacePath(role: "setter"))
        XCTAssertNil(NativePushTap.staffAlert(["path": NativePushTap.staffPath,
                                              "kind": "lead", "client_id": "not-an-id"]))
        XCTAssertNil(NativePushTap.staffAlert(["path": "https://evil.example",
                                              "kind": "lead", "client_id": id]))
        XCTAssertNil(NativePushTap.staffAlert(["path": NativePushTap.staffPath,
                                              "kind": "unknown", "client_id": id]))
        XCTAssertEqual(URL(string: alert!.workspacePath(role: "setter")!, relativeTo: FundhubAPI.base)?
            .absoluteURL.absoluteString, "https://fundhub.ai/app/setter-dashboard.html?client_id=\(id)")
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

    @MainActor
    func testStaffNotificationTapRequestIsOneUseAndExpires() {
        let push = NativePushCenter.shared
        push.resetAfterInvalidSession()
        let tappedAt = Date(timeIntervalSince1970: 1_700_000_000)
        let info = ["path": NativePushTap.staffPath, "kind": "upcoming",
                    "client_id": "56a40391-e541-4a89-873b-37eab9d6d953"]
        XCTAssertFalse(push.recordNotificationTap(userInfo: info, now: tappedAt))
        XCTAssertTrue(push.recordNotificationTap(userInfo: info, now: tappedAt, sessionBearer: "session-A"))
        XCTAssertEqual(push.takeStaffOpenRequest(now: tappedAt.addingTimeInterval(60),
                                                 currentBearer: "session-A")?.kind, "upcoming")
        XCTAssertNil(push.takeStaffOpenRequest(now: tappedAt.addingTimeInterval(61), currentBearer: "session-A"))
        XCTAssertTrue(push.recordNotificationTap(userInfo: info, now: tappedAt, sessionBearer: "session-A"))
        XCTAssertNil(push.takeStaffOpenRequest(now: tappedAt.addingTimeInterval(NativePushTap.requestLifetime + 1),
                                               currentBearer: "session-A"))
        push.resetAfterInvalidSession()
    }

    @MainActor
    func testStaffNotificationTapCannotCrossSessions() {
        let push = NativePushCenter.shared
        push.resetAfterInvalidSession()
        let now = Date()
        let info = ["path": NativePushTap.staffPath, "kind": "lead",
                    "client_id": "56a40391-e541-4a89-873b-37eab9d6d953"]
        XCTAssertTrue(push.recordNotificationTap(userInfo: info, now: now, sessionBearer: "session-A"))
        XCTAssertNil(push.takeStaffOpenRequest(now: now, currentBearer: "session-B"))
        XCTAssertNil(push.takeStaffOpenRequest(now: now, currentBearer: "session-A"))
        XCTAssertTrue(push.recordNotificationTap(userInfo: info, now: now, sessionBearer: "session-A"))
        push.resetAfterInvalidSession()
        XCTAssertNil(push.takeStaffOpenRequest(now: now, currentBearer: "session-A"))
        XCTAssertTrue(push.recordNotificationTap(userInfo: ["path": NativePushTap.portalPath], now: now))
        push.resetAfterInvalidSession()
        XCTAssertFalse(push.takePortalOpenRequest(now: now))
    }

    @MainActor
    func testDelayedStaffAlertRejectsAccountSwitchAfterIdentityRefresh() async {
        // The identity lookup is deliberately held until session A becomes B.
        // An already-dequeued alert for A must not navigate under B's WebView.
        let alert = NativePushTap.StaffAlert(kind: "lead",
                                            clientId: "56a40391-e541-4a89-873b-37eab9d6d953")
        let gate = DelayedIdentityGate()
        let simulated = SimulatedStaffState(bearer: "session-A")
        let delayedCheck = Task { @MainActor in
            guard let bearerAtTap = simulated.bearer else { return nil as String? }
            await gate.pause()
            return StaffAlertNavigation.verifiedPath(
                alert: alert,
                bearerAtTap: bearerAtTap,
                bearerAfterRefresh: simulated.bearer,
                staffSessionVerified: true,
                roleAfterRefresh: "setter",
                taskCancelled: Task.isCancelled
            )
        }
        await gate.waitUntilPaused()
        simulated.bearer = "session-B"
        await gate.release()
        let stalePath = await delayedCheck.value
        XCTAssertNil(stalePath, "An alert dequeued for A must not open client navigation under B.")

        let currentPath = StaffAlertNavigation.verifiedPath(
            alert: alert, bearerAtTap: "session-A", bearerAfterRefresh: "session-A",
            staffSessionVerified: true, roleAfterRefresh: "setter", taskCancelled: false
        )
        XCTAssertEqual(currentPath,
                       "/app/setter-dashboard.html?client_id=56a40391-e541-4a89-873b-37eab9d6d953")
        XCTAssertNil(StaffAlertNavigation.verifiedPath(
            alert: alert, bearerAtTap: "session-A", bearerAfterRefresh: nil,
            staffSessionVerified: true, roleAfterRefresh: "setter", taskCancelled: false
        ), "Signing out while identity refresh is suspended must discard the tap.")
        XCTAssertNil(StaffAlertNavigation.verifiedPath(
            alert: alert, bearerAtTap: "session-A", bearerAfterRefresh: "session-A",
            staffSessionVerified: false, roleAfterRefresh: "setter", taskCancelled: false
        ), "An unverified/refused staff session must not navigate.")
        XCTAssertNil(StaffAlertNavigation.verifiedPath(
            alert: alert, bearerAtTap: "session-A", bearerAfterRefresh: "session-A",
            staffSessionVerified: true, roleAfterRefresh: "setter", taskCancelled: true
        ), "A cancelled SwiftUI task must not commit stale navigation.")
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

    func testFundhubPopupLinksStayInAuthenticatedWorkspace() {
        for raw in [
            "https://fundhub.ai/app/client-portal.html",
            "https://fundhub.ai/app/documents.html",
            "https://fundhub.ai/portal-login.html"
        ] {
            XCTAssertTrue(WorkspaceNavigation.shouldOpenInWorkspace(URL(string: raw)!), raw)
        }

        // The native wrapper must not inject a bearer into lookalike domains,
        // different schemes, or external checkout / email destinations.
        for raw in [
            "https://fundhub.ai.evil.example/app/client-portal.html",
            "https://www.fundhub.ai/app/client-portal.html",
            "http://fundhub.ai/app/client-portal.html",
            "https://example-payments.com/checkout",
            "mailto:support@fundhub.ai",
            "tel:+15551234567"
        ] {
            XCTAssertFalse(WorkspaceNavigation.shouldOpenInWorkspace(URL(string: raw)!), raw)
        }
        XCTAssertTrue(WorkspaceNavigation.isSignOutDestination(
            URL(string: "https://fundhub.ai/portal-login.html")!))
    }

    func testNativePushAppOptOutPersistsIndependentlyOfSystemAuthorization() {
        let suite = "ai.fundhub.tests.push-consent.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }

        XCTAssertFalse(NativePushConsent.isEnabled(defaults: defaults))
        NativePushConsent.setEnabled(true, defaults: defaults)
        XCTAssertTrue(NativePushConsent.isEnabled(defaults: defaults))
        NativePushConsent.setEnabled(false, defaults: defaults)
        XCTAssertFalse(NativePushConsent.isEnabled(defaults: defaults))
    }

    func testNativePushConsentCannotMoveBetweenSessionBearers() {
        let suite = "ai.fundhub.tests.push-session.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }

        NativePushConsent.bind(to: "first-bearer", defaults: defaults)
        NativePushConsent.setEnabled(true, defaults: defaults)
        NativePushConsent.bind(to: "first-bearer", defaults: defaults)
        XCTAssertTrue(NativePushConsent.isEnabled(defaults: defaults))

        // Even a new process starting with bearer=nil must reject the old
        // account's consent when attaching a different authenticated session.
        NativePushConsent.bind(to: "second-bearer", defaults: defaults)
        XCTAssertFalse(NativePushConsent.isEnabled(defaults: defaults))
        NativePushConsent.setEnabled(true, defaults: defaults)
        NativePushConsent.bind(to: "first-bearer", defaults: defaults)
        XCTAssertFalse(NativePushConsent.isEnabled(defaults: defaults))
    }


    func testNativeWebViewBlocksPublicMarketingHomeVariants() {
        // URL host/path case, www canonicalization, slashes, and query/hash
        // cannot turn a marketing homepage into an approved app destination.
        for raw in [
            "https://fundhub.ai/",
            "https://FUNDHUB.AI/?utm_campaign=app#pricing",
            "https://www.fundhub.ai/",
            "https://www.fundhub.ai/index.html?source=header#top",
            "https://fundhub.ai/INDEX.HTML",
            "https://fundhub.ai//",
            "https://fundhub.ai/index.html/",
            "https://fundhub.ai/%2e/index.html",
            "https://fundhub.ai/%2e%2e/",
            "https://www.fundhub.ai/%2e%2e/index.html",
            "https://fundhub.ai/app/%2e%2e/index.html"
        ] {
            let url = URL(string: raw)!
            XCTAssertTrue(WorkspaceNavigation.isPublicMarketingHome(url), raw)
        }
    }

    func testNativeWebViewPreservesWorkspaceAuthAndExternalDestinations() {
        for raw in [
            "https://fundhub.ai/app/client-portal.html",
            "https://fundhub.ai/app/setter-dashboard.html",
            "https://fundhub.ai/app/finance-os.html",
            "https://fundhub.ai/login.html",
            "https://fundhub.ai/portal-login.html?t=synthetic",
            "https://fundhub.ai/privacy/",
            "https://fundhub.ai/checkout",
            "https://payments.example/checkout",
            "https://fundhub.ai.evil.example/",
            "mailto:support@fundhub.ai"
        ] {
            XCTAssertFalse(WorkspaceNavigation.isPublicMarketingHome(URL(string: raw)!), raw)
        }
        // Blocking the marketing homepage must not suppress the native
        // sign-out handling for authenticated users.
        XCTAssertTrue(WorkspaceNavigation.isSignOutDestination(
            URL(string: "https://fundhub.ai/portal-login.html")!))
    }

    func testWebSignOutDestinationIsExact() {
        XCTAssertTrue(WorkspaceNavigation.isSignOutDestination(URL(string: "https://fundhub.ai/portal-login.html")!))
        XCTAssertTrue(WorkspaceNavigation.isSignOutDestination(URL(string: "https://fundhub.ai/login.html")!))
        XCTAssertFalse(WorkspaceNavigation.isSignOutDestination(URL(string: "https://fundhub.ai/app/client-portal.html")!))
        XCTAssertFalse(WorkspaceNavigation.isSignOutDestination(URL(string: "https://evil.example/login.html")!))
    }
}

// Controlled synthetic delay: never calls a real identity provider or session.
private actor DelayedIdentityGate {
    private var hasPaused = false
    private var released = false
    private var pausedSignal: CheckedContinuation<Void, Never>?
    private var releaseWaiter: CheckedContinuation<Void, Never>?

    func pause() async {
        hasPaused = true
        pausedSignal?.resume()
        pausedSignal = nil
        if !released {
            await withCheckedContinuation { releaseWaiter = $0 }
        }
    }

    func waitUntilPaused() async {
        if hasPaused { return }
        await withCheckedContinuation { pausedSignal = $0 }
    }

    func release() {
        released = true
        releaseWaiter?.resume()
        releaseWaiter = nil
    }
}

@MainActor
private final class SimulatedStaffState {
    var bearer: String?
    init(bearer: String) { self.bearer = bearer }
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
