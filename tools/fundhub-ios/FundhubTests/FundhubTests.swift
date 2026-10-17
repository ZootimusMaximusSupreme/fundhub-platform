import XCTest
@testable import Fundhub

final class FundhubTests: XCTestCase {
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
            return Data(#"{"ok":true,"stage":{"key":"booked"},"advisor":null,"documents":[],"invoice_due":{"count":0,"total_display":"$0.00"}}"#.utf8)
        }
        defer { StubURLProtocol.handler = nil }
        let summary = try await api.portalSummary(token: "test-session")
        XCTAssertEqual(summary.stage.title, "Getting started")
    }
}

private final class StubURLProtocol: URLProtocol {
    static var handler: ((URLRequest) -> Data)?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let data = Self.handler?(request), let url = request.url,
              let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil) else {
            client?.urlProtocol(self, didFailWithError: FundhubAPIError.invalidResponse)
            return
        }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
