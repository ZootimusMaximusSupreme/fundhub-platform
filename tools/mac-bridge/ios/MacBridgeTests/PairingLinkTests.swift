import XCTest
@testable import MacBridge

final class PairingLinkTests: XCTestCase {
    private let token = "a3f9c0d1e2b4a5968778695a4b3c2d1e0f1a2b3c4d5e6f708192a3b4c5d6e7f8"

    func testGoodLink() throws {
        let info = try PairingLink.parse("macbridge://pair?host=192.168.1.20&port=7878&token=\(token)&name=Chris-Mac")
        XCTAssertEqual(info, PairingInfo(host: "192.168.1.20", port: 7878, token: token, name: "Chris-Mac"))
    }

    func testGoodLinkFromURLWithEncodedName() throws {
        let url = try XCTUnwrap(URL(string: "macbridge://pair?host=10.0.0.5&port=9000&token=\(token)&name=Chris%27s%20Mac"))
        let info = try PairingLink.parse(url)
        XCTAssertEqual(info.port, 9000)
        XCTAssertEqual(info.name, "Chris's Mac")
    }

    func testSchemeIsCaseInsensitiveAndWhitespaceTrimmed() throws {
        let info = try PairingLink.parse("  MACBRIDGE://pair?host=h.local&port=7878&token=\(token)\n")
        XCTAssertEqual(info.host, "h.local")
    }

    func testMissingNameFallsBackToHost() throws {
        let info = try PairingLink.parse("macbridge://pair?host=192.168.1.20&port=7878&token=\(token)")
        XCTAssertEqual(info.name, "192.168.1.20")
    }

    func testMissingPortUsesDefault() throws {
        let info = try PairingLink.parse("macbridge://pair?host=192.168.1.20&token=\(token)")
        XCTAssertEqual(info.port, 7878)
    }

    func testWrongScheme() {
        XCTAssertThrowsError(try PairingLink.parse("https://pair?host=1.2.3.4&port=7878&token=\(token)")) {
            XCTAssertEqual($0 as? PairingLinkError, .notMacBridge)
        }
    }

    func testNotAPairingLink() {
        XCTAssertThrowsError(try PairingLink.parse("macbridge://open?host=1.2.3.4&port=7878&token=\(token)")) {
            XCTAssertEqual($0 as? PairingLinkError, .notPairing)
        }
    }

    func testMissingHost() {
        XCTAssertThrowsError(try PairingLink.parse("macbridge://pair?port=7878&token=\(token)")) {
            XCTAssertEqual($0 as? PairingLinkError, .missingHost)
        }
        XCTAssertThrowsError(try PairingLink.parse("macbridge://pair?host=&port=7878&token=\(token)")) {
            XCTAssertEqual($0 as? PairingLinkError, .missingHost)
        }
    }

    func testBadPort() {
        for port in ["abc", "0", "70000", "-1"] {
            XCTAssertThrowsError(try PairingLink.parse("macbridge://pair?host=1.2.3.4&port=\(port)&token=\(token)"), "port \(port)") {
                XCTAssertEqual($0 as? PairingLinkError, .badPort)
            }
        }
    }

    func testMissingToken() {
        XCTAssertThrowsError(try PairingLink.parse("macbridge://pair?host=1.2.3.4&port=7878")) {
            XCTAssertEqual($0 as? PairingLinkError, .missingToken)
        }
        XCTAssertThrowsError(try PairingLink.parse("macbridge://pair?host=1.2.3.4&port=7878&token=")) {
            XCTAssertEqual($0 as? PairingLinkError, .missingToken)
        }
    }

    func testGarbageText() {
        XCTAssertThrowsError(try PairingLink.parse("hello there"))
        XCTAssertThrowsError(try PairingLink.parse(""))
    }
}
