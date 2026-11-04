import XCTest
@testable import Fundhub

final class FundhubTests: XCTestCase {
    @MainActor
    func testWidgetSnapshotWritesOnlyKnownRoleCountsWithoutSecrets() throws {
        let timestamp = ISO8601DateFormatter().string(from: Date())
        let feed: [String: Any] = [
            "ok": true, "generatedAt": timestamp,
            "identity": ["kind": "staff", "roles": ["setter", "unknown"]],
            "bearer": "never-write-this-bearer", "name": "Never write this name",
            "sections": [
                ["role": "setter", "metrics": [
                    ["key": "booked", "unit": "count", "value": 2],
                    ["key": "dials", "unit": "count", "value": -1],
                    ["key": "token", "unit": "count", "value": 9]
                ], "items": [["id": "client:private-name"]]],
                ["role": "owner", "metrics": [["key": "booked_calls", "unit": "count", "value": 99]], "items": []]
            ]
        ]
        let data = try DockWidgetSnapshot.sanitizedSnapshotData(from: JSONSerialization.data(withJSONObject: feed))
        let result = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(result["roles"] as? [String], ["setter"])
        let items = try XCTUnwrap(result["items"] as? [[String: Any]])
        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items.first?["kind"] as? String, "booked_today")
        XCTAssertEqual(items.first?["count"] as? Int, 2)
        let text = try XCTUnwrap(String(data: data, encoding: .utf8))
        for forbidden in ["never-write-this-bearer", "Never write this name", "private-name", "booked_calls"] {
            XCTAssertFalse(text.contains(forbidden), forbidden)
        }
    }

    @MainActor
    func testWidgetSnapshotRejectsExpiredOrUnrecognizedIdentity() throws {
        for (kind, age) in [("staff", -7_200.0), ("unknown", 0.0)] {
            let feed: [String: Any] = [
                "ok": true,
                "generatedAt": ISO8601DateFormatter().string(from: Date().addingTimeInterval(age)),
                "identity": ["kind": kind, "roles": ["setter"]], "sections": []
            ]
            XCTAssertThrowsError(try DockWidgetSnapshot.sanitizedSnapshotData(from: JSONSerialization.data(withJSONObject: feed)))
        }
    }

    func testAppDoesNotDeclareFaceIDPrompt() {
        let purpose = Bundle.main.object(forInfoDictionaryKey: "NSFaceIDUsageDescription") as? String
        XCTAssertNil(purpose)
    }

    func testSavedSessionReadsWithoutASecondPrompt() {
        SessionKeychain.clear()
        defer { SessionKeychain.clear() }
        XCTAssertTrue(SessionKeychain.save("test-session"))
        XCTAssertEqual(SessionKeychain.read(), "test-session")
    }

    func testNativePushEligibilityUsesOnlyKnownPrimaryStaffRoles() {
        let roles = ["owner", "admin", "sales_manager", "setter", "closer", "outbound_rep",
                     "inquiry_specialist", "funding_advisor", "csm"]
        for role in roles {
            XCTAssertTrue(FundhubRole.canRegisterNativePush(principal: "staff", role: role), role)
        }
        let unsupported: [String?] = [nil, "", "unknown_job", "Owner", "setter,closer"]
        for role in unsupported {
            XCTAssertFalse(FundhubRole.canRegisterNativePush(principal: "staff", role: role))
        }
        XCTAssertTrue(FundhubRole.canRegisterNativePush(principal: "client", role: nil))
        XCTAssertTrue(FundhubRole.canRegisterNativePush(principal: "client", role: "unknown_job"))
        for principal in ["partner", "affiliate", "unknown", ""] {
            XCTAssertFalse(FundhubRole.canRegisterNativePush(principal: principal, role: "owner"))
        }
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

    func testClientPushAcceptsAll22ExactLessonsAndRejectsOtherDestinations() {
        let slugs = [
            "pre-underwriting", "funding-sequence", "apply-yourself", "money-on-the-table",
            "after-you-say-yes", "bank-said-no", "thirteen-points", "card-paydown",
            "credit-optimization", "credit-partner", "business-one-two", "blueprint-12-months",
            "soft-pull", "the-call", "who-we-are", "cost-of-waiting", "the-maximum",
            "the-money-talk", "tried-before", "blueprint-value", "blueprint-in-action", "your-data-is-safe"
        ]
        XCTAssertEqual(Set(slugs).count, 22)
        for slug in slugs {
            let path = "/slideshows/\(slug).html"
            XCTAssertEqual(NativePushTap.clientPath(["path": path]), path)
        }
        for path in ["https://fundhub.ai/slideshows/the-call.html", "//evil.example/the-call.html",
                     "/slideshows/the-call.html?client_id=other", "/slideshows/the-call.html#part2",
                     "/slideshows/../app/pipeline.html", "/slideshows/film/the-call.html",
                     "/slideshows/not-approved.html", "/app/pipeline.html"] {
            XCTAssertNil(NativePushTap.clientPath(["path": path]), path)
        }
        XCTAssertNil(NativePushTap.clientPath(["path": 123]))
    }

    @MainActor
    func testLessonTapPreservesPathWithSameSessionAndExpiresOrClearsOnce() {
        let push = NativePushCenter.shared
        push.resetAfterInvalidSession()
        defer { push.resetAfterInvalidSession() }
        let now = Date(timeIntervalSince1970: 2_000_000)
        let path = "/slideshows/the-call.html"
        let info = ["path": path]
        XCTAssertFalse(push.recordNotificationTap(userInfo: info, now: now))
        XCTAssertTrue(push.recordNotificationTap(userInfo: info, now: now, sessionBearer: "session-A"))
        XCTAssertEqual(push.takeClientOpenRequest(now: now.addingTimeInterval(60), currentBearer: "session-A")?.path, path)
        XCTAssertNil(push.takeClientOpenRequest(now: now, currentBearer: "session-A"))
        XCTAssertTrue(push.recordNotificationTap(userInfo: info, now: now, sessionBearer: "session-A"))
        XCTAssertNil(push.takeClientOpenRequest(now: now, currentBearer: "session-B"))
        XCTAssertNil(push.takeClientOpenRequest(now: now, currentBearer: "session-A"))
        XCTAssertTrue(push.recordNotificationTap(userInfo: info, now: now, sessionBearer: "session-A"))
        XCTAssertNil(push.takeClientOpenRequest(now: now.addingTimeInterval(301), currentBearer: "session-A"))
        XCTAssertTrue(push.recordNotificationTap(userInfo: info, now: now, sessionBearer: "session-A"))
        push.resetAfterInvalidSession()
        XCTAssertNil(push.takeClientOpenRequest(now: now, currentBearer: "session-A"))
    }

    @MainActor
    func testLessonNavigationDropsAccountSwitchDuringIdentityRefresh() async {
        let path = "/slideshows/the-call.html"
        let request = NativePushTap.ClientOpenRequest(path: path, tappedAt: Date())
        let gate = DelayedIdentityGate()
        let simulated = SimulatedStaffState(bearer: "session-A")
        let pending = Task { @MainActor in
            let bearer = simulated.bearer!
            await gate.pause()
            return ClientPortalNavigation.verifiedPath(request, bearerAtTap: bearer,
                bearerAfterRefresh: simulated.bearer, clientSessionVerified: true, taskCancelled: false)
        }
        await gate.waitUntilPaused()
        simulated.bearer = "session-B"
        await gate.release()
        let stalePath = await pending.value
        XCTAssertNil(stalePath)
        XCTAssertEqual(ClientPortalNavigation.verifiedPath(request, bearerAtTap: "session-A",
            bearerAfterRefresh: "session-A", clientSessionVerified: true, taskCancelled: false), path)
        XCTAssertNil(ClientPortalNavigation.verifiedPath(request, bearerAtTap: "session-A",
            bearerAfterRefresh: "session-A", clientSessionVerified: false, taskCancelled: false))
        XCTAssertNil(ClientPortalNavigation.verifiedPath(request, bearerAtTap: "session-A",
            bearerAfterRefresh: "session-A", clientSessionVerified: true, taskCancelled: true))
        XCTAssertNil(ClientPortalNavigation.verifiedPath(.init(path: "/app/pipeline.html", tappedAt: Date()), bearerAtTap: "session-A",
            bearerAfterRefresh: "session-A", clientSessionVerified: true, taskCancelled: false))
    }

    func testBackToFundhubAppearsOnlyForAnExactClientLessonUnderTheSameSession() {
        let show: (String?, String?, String, String) -> Bool = { path, opened, current, principal in
            ClientPortalNavigation.showsBackButton(path: path, bearerAtOpen: opened,
                                                   currentBearer: current, principal: principal)
        }
        XCTAssertTrue(show("/slideshows/the-call.html", "session-A", "session-A", "client"))
        XCTAssertFalse(show("/slideshows/the-call.html", "session-A", "session-B", "client"))
        XCTAssertFalse(show("/slideshows/the-call.html", "session-A", "session-A", "staff"))
        XCTAssertFalse(show("/app/client-portal.html", "session-A", "session-A", "client"))
        XCTAssertFalse(show("/slideshows/the-call.html?client_id=other", "session-A", "session-A", "client"))
        XCTAssertFalse(show("https://fundhub.ai/slideshows/the-call.html", "session-A", "session-A", "client"))
        XCTAssertFalse(show("/slideshows/the-call.html", nil, "session-A", "client"))
        XCTAssertFalse(show("/slideshows/the-call.html", "", "", "client"))
        XCTAssertFalse(show(nil, "session-A", "session-A", "client"))
    }

    @MainActor
    func testLessonTapExpiresWhileIdentityRefreshIsSuspended() async {
        let push = NativePushCenter.shared
        push.resetAfterInvalidSession()
        defer { push.resetAfterInvalidSession() }
        let tappedAt = Date(timeIntervalSince1970: 3_000_000)
        let path = "/slideshows/the-call.html"
        XCTAssertTrue(push.recordNotificationTap(userInfo: ["path": path], now: tappedAt, sessionBearer: "session-A"))
        let request = push.takeClientOpenRequest(now: tappedAt.addingTimeInterval(1), currentBearer: "session-A")!
        XCTAssertEqual(ClientPortalNavigation.verifiedPath(request, bearerAtTap: "session-A",
            bearerAfterRefresh: "session-A", clientSessionVerified: true, taskCancelled: false,
            now: tappedAt.addingTimeInterval(1)), path)
        let gate = DelayedIdentityGate()
        let pending = Task { @MainActor in
            await gate.pause()
            return ClientPortalNavigation.verifiedPath(request, bearerAtTap: "session-A",
                bearerAfterRefresh: "session-A", clientSessionVerified: true, taskCancelled: false,
                now: tappedAt.addingTimeInterval(301))
        }
        await gate.waitUntilPaused()
        await gate.release()
        let expiredPath = await pending.value
        XCTAssertNil(expiredPath, "A tap valid before identity refresh may expire while it awaits the server.")
        XCTAssertNil(ClientPortalNavigation.verifiedPath(request, bearerAtTap: "session-A",
            bearerAfterRefresh: "session-A", clientSessionVerified: true, taskCancelled: false,
            now: tappedAt.addingTimeInterval(-1)))
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
        let payout = NativePushTap.staffAlert(["path": NativePushTap.staffPath,
                                               "kind": "payout", "client_id": id])
        XCTAssertEqual(payout?.workspacePath(role: "closer"), "/app/closer-dashboard.html")
        XCTAssertEqual(payout?.workspacePath(role: "sales_manager"), "/app/sales-floor.html")
        XCTAssertNil(payout?.workspacePath(role: "setter"))
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
        push.resetAfterInvalidSession()
        let tappedAt = Date(timeIntervalSince1970: 1_700_000_000)
        _ = push.takePortalOpenRequest(now: tappedAt, currentBearer: "session-A")
        XCTAssertFalse(push.recordNotificationTap(userInfo: ["path": "https://evil.example/join"], now: tappedAt))
        XCTAssertFalse(push.takePortalOpenRequest(now: tappedAt, currentBearer: "session-A"))

        XCTAssertFalse(push.recordNotificationTap(userInfo: ["path": NativePushTap.portalPath], now: tappedAt))
        XCTAssertTrue(push.recordNotificationTap(userInfo: ["path": NativePushTap.portalPath], now: tappedAt,
                                                 sessionBearer: "session-A"))
        XCTAssertTrue(push.takePortalOpenRequest(now: tappedAt.addingTimeInterval(60), currentBearer: "session-A"))
        XCTAssertFalse(push.takePortalOpenRequest(now: tappedAt.addingTimeInterval(61), currentBearer: "session-A"))

        XCTAssertTrue(push.recordNotificationTap(userInfo: ["path": NativePushTap.portalPath], now: tappedAt,
                                                 sessionBearer: "session-A"))
        XCTAssertFalse(push.takePortalOpenRequest(now: tappedAt.addingTimeInterval(NativePushTap.requestLifetime + 1),
                                                  currentBearer: "session-A"))
        push.resetAfterInvalidSession()
    }

    @MainActor
    func testClientPortalTapCannotCrossSessions() {
        let push = NativePushCenter.shared
        push.resetAfterInvalidSession()
        let now = Date()
        let info = ["path": NativePushTap.portalPath]
        XCTAssertTrue(push.recordNotificationTap(userInfo: info, now: now, sessionBearer: "session-A"))
        XCTAssertFalse(push.takePortalOpenRequest(now: now, currentBearer: "session-B"))
        XCTAssertFalse(push.takePortalOpenRequest(now: now, currentBearer: "session-A"))
        XCTAssertTrue(push.recordNotificationTap(userInfo: info, now: now, sessionBearer: "session-A"))
        push.resetAfterInvalidSession()
        XCTAssertFalse(push.takePortalOpenRequest(now: now, currentBearer: "session-A"))
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
        XCTAssertTrue(push.recordNotificationTap(userInfo: ["path": NativePushTap.portalPath], now: now,
                                                 sessionBearer: "session-A"))
        push.resetAfterInvalidSession()
        XCTAssertFalse(push.takePortalOpenRequest(now: now, currentBearer: "session-A"))
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

    @MainActor
    func testDelayedClientPortalTapRejectsAccountSwitchAfterIdentityRefresh() async {
        let gate = DelayedIdentityGate()
        let simulated = SimulatedStaffState(bearer: "session-A")
        let delayedCheck = Task { @MainActor in
            guard let bearerAtTap = simulated.bearer else { return false }
            await gate.pause()
            return ClientPortalNavigation.shouldOpen(
                bearerAtTap: bearerAtTap,
                bearerAfterRefresh: simulated.bearer,
                clientSessionVerified: true,
                taskCancelled: Task.isCancelled
            )
        }
        await gate.waitUntilPaused()
        simulated.bearer = "session-B"
        await gate.release()
        let staleOpen = await delayedCheck.value
        XCTAssertFalse(staleOpen, "A queued portal tap must not reload under another account.")
        XCTAssertTrue(ClientPortalNavigation.shouldOpen(
            bearerAtTap: "session-A", bearerAfterRefresh: "session-A",
            clientSessionVerified: true, taskCancelled: false
        ))
        XCTAssertFalse(ClientPortalNavigation.shouldOpen(
            bearerAtTap: "session-A", bearerAfterRefresh: nil,
            clientSessionVerified: true, taskCancelled: false
        ))
        XCTAssertFalse(ClientPortalNavigation.shouldOpen(
            bearerAtTap: "session-A", bearerAfterRefresh: "session-A",
            clientSessionVerified: false, taskCancelled: false
        ))
        XCTAssertFalse(ClientPortalNavigation.shouldOpen(
            bearerAtTap: "session-A", bearerAfterRefresh: "session-A",
            clientSessionVerified: true, taskCancelled: true
        ))
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

    func testStaffSMSLinkParserAcceptsOnlyExactDashboardUUIDLinks() {
        let id = "56a40391-e541-4a89-873b-37eab9d6d953"
        for desk in ["setter", "closer"] {
            let link = StaffDashboardLink.parse(URL(string: "https://fundhub.ai/app/\(desk)-dashboard.html?client_id=\(id)")!)
            XCTAssertEqual(link?.workspacePath, "/app/\(desk)-dashboard.html?client_id=\(id)")
        }
        for invalid in [
            "http://fundhub.ai/app/setter-dashboard.html?client_id=\(id)",
            "https://evil.example/app/setter-dashboard.html?client_id=\(id)",
            "https://fundhub.ai.evil.example/app/setter-dashboard.html?client_id=\(id)",
            "https://staff@fundhub.ai/app/setter-dashboard.html?client_id=\(id)",
            "https://fundhub.ai:443/app/setter-dashboard.html?client_id=\(id)",
            "https://fundhub.ai/app/setter-dashboard.html/extra?client_id=\(id)",
            "https://fundhub.ai/app/%73etter-dashboard.html?client_id=\(id)",
            "https://fundhub.ai/app/../app/setter-dashboard.html?client_id=\(id)",
            "https://fundhub.ai/app/client-portal.html?client_id=\(id)",
            "https://fundhub.ai/app/setter-dashboard.html?client_id=\(id)#private",
            "https://fundhub.ai/app/setter-dashboard.html?client_id=\(id)#",
            "https://fundhub.ai/app/setter-dashboard.html?client_id=\(id)&client_id=\(id)",
            "https://fundhub.ai/app/setter-dashboard.html?client_id=\(id)&token=secret",
            "https://fundhub.ai/app/setter-dashboard.html?client_id=\(id)&task_id=\(id)",
            "https://fundhub.ai/app/setter-dashboard.html?client_id=\(id)&returnTo=https://evil.example",
            "https://fundhub.ai/app/setter-dashboard.html?client_id=not-a-uuid",
            "https://fundhub.ai/app/setter-dashboard.html?client_id=",
            "https://fundhub.ai/app/setter-dashboard.html?client%5Fid=\(id)",
            "https://fundhub.ai/app/setter-dashboard.html"
        ] { XCTAssertNil(StaffDashboardLink.parse(URL(string: invalid)!), invalid) }
    }

    func testStaffSMSLinksUseOnlyExistingPrimaryDeskRoles() {
        let setter = StaffDashboardLink.parse(URL(string: "https://fundhub.ai/app/setter-dashboard.html?client_id=56a40391-e541-4a89-873b-37eab9d6d953")!)!
        let closer = StaffDashboardLink.parse(URL(string: "https://fundhub.ai/app/closer-dashboard.html?client_id=56a40391-e541-4a89-873b-37eab9d6d953")!)!
        for role in ["owner", "admin", "setter", "closer", "sales_manager", "csm", "outbound_rep", "funding_advisor", "inquiry_specialist", "unknown", ""] {
            XCTAssertEqual(setter.permits(principal: "staff", role: role), ["owner", "admin", "setter"].contains(role), role)
            XCTAssertEqual(closer.permits(principal: "staff", role: role), ["owner", "admin", "sales_manager", "closer"].contains(role), role)
        }
        for principal in ["client", "partner", "affiliate", "unknown", ""] {
            XCTAssertFalse(setter.permits(principal: principal, role: "owner"))
            XCTAssertFalse(closer.permits(principal: principal, role: "closer"))
        }
        XCTAssertFalse(setter.permits(principal: "staff", role: nil))
    }

    func testSignedOutStaffSMSLinkQueuesUntilVerifiedSignInThenConsumesOnce() {
        var queue = StaffDashboardLink.Queue()
        let now = Date(), url = URL(string: "https://fundhub.ai/app/setter-dashboard.html?client_id=56a40391-e541-4a89-873b-37eab9d6d953")!
        XCTAssertTrue(queue.receive(url, bearer: nil, now: now))
        let request = queue.pending!, generation = queue.generation
        let opened = queue.consume(requestId: request.id, generation: generation,
            bearerAtStart: "new-staff-session", bearerAfterRefresh: "new-staff-session",
            principal: "staff", role: "setter", verified: true, taskCancelled: false, now: now.addingTimeInterval(60))
        XCTAssertEqual(opened?.path, "/app/setter-dashboard.html?client_id=56a40391-e541-4a89-873b-37eab9d6d953")
        XCTAssertTrue(opened!.isCurrent(bearer: "new-staff-session", generation: generation,
            principal: "staff", role: "setter", verified: true, taskCancelled: false))
        XCTAssertNil(queue.pending)
        XCTAssertNil(queue.consume(requestId: request.id, generation: generation,
            bearerAtStart: "new-staff-session", bearerAfterRefresh: "new-staff-session",
            principal: "staff", role: "setter", verified: true, taskCancelled: false))
    }

    func testStaffSMSQueueExpiresRefusesWrongAccountAndDeduplicatesBothDeliveryHooks() {
        let now = Date(), url = URL(string: "https://fundhub.ai/app/setter-dashboard.html?client_id=56a40391-e541-4a89-873b-37eab9d6d953")!
        for mode in ["expired", "future", "changed-bearer", "wrong-role", "client", "cancelled", "unverified"] {
            var queue = StaffDashboardLink.Queue()
            queue.receive(url, bearer: "session-A", now: now)
            let request = queue.pending!, generation = queue.generation
            XCTAssertNil(queue.consume(requestId: request.id, generation: generation,
                bearerAtStart: "session-A", bearerAfterRefresh: mode == "changed-bearer" ? "session-B" : "session-A",
                principal: mode == "client" ? "client" : "staff", role: mode == "wrong-role" ? "closer" : "setter",
                verified: mode != "unverified", taskCancelled: mode == "cancelled",
                now: mode == "expired" ? now.addingTimeInterval(301) : mode == "future" ? now.addingTimeInterval(-1) : now))
            XCTAssertNil(queue.pending, mode)
        }
        var queue = StaffDashboardLink.Queue()
        queue.receive(url, bearer: "session-A", now: now)
        let first = queue.pending!, generation = queue.generation
        queue.receive(url, bearer: "session-A", now: now.addingTimeInterval(0.1))
        XCTAssertEqual(queue.pending?.id, first.id)
        XCTAssertEqual(queue.generation, generation)
        queue.receive(url, bearer: "session-B", now: now.addingTimeInterval(0.2))
        XCTAssertNotEqual(queue.pending?.id, first.id)
        XCTAssertNil(queue.consume(requestId: first.id, generation: generation,
            bearerAtStart: "session-A", bearerAfterRefresh: "session-A", principal: "staff", role: "setter",
            verified: true, taskCancelled: false, now: now))
        XCTAssertNotNil(queue.pending, "an old continuation cannot discard a newer link")
        queue.clear()
        XCTAssertNil(queue.pending)
    }

    @MainActor
    func testStaffSMSFinalNavigationRechecksBearerGenerationAndRoleAfterLastAwait() async {
        let gate = DelayedIdentityGate()
        let simulated = SimulatedStaffState(bearer: "session-A")
        var queue = StaffDashboardLink.Queue()
        let now = Date(), url = URL(string: "https://fundhub.ai/app/setter-dashboard.html?client_id=56a40391-e541-4a89-873b-37eab9d6d953")!
        queue.receive(url, bearer: "session-A", now: now)
        let request = queue.pending!, generation = queue.generation
        let resolved = queue.consume(requestId: request.id, generation: generation,
            bearerAtStart: "session-A", bearerAfterRefresh: "session-A", principal: "staff", role: "setter",
            verified: true, taskCancelled: false, now: now)!
        let delayedCheck = Task { @MainActor in
            await gate.pause()
            return resolved.isCurrent(bearer: simulated.bearer, generation: generation,
                principal: "staff", role: "setter", verified: true, taskCancelled: Task.isCancelled)
        }
        await gate.waitUntilPaused()
        simulated.bearer = "session-B"
        await gate.release()
        let opened = await delayedCheck.value
        XCTAssertFalse(opened, "a completed refresh result cannot navigate under a changed account")
        XCTAssertFalse(resolved.isCurrent(bearer: "session-A", generation: generation + 1,
            principal: "staff", role: "setter", verified: true, taskCancelled: false))
        XCTAssertFalse(resolved.isCurrent(bearer: "session-A", generation: generation,
            principal: "staff", role: "closer", verified: true, taskCancelled: false))
        XCTAssertFalse(resolved.isCurrent(bearer: nil, generation: generation,
            principal: nil, role: nil, verified: false, taskCancelled: false))
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
