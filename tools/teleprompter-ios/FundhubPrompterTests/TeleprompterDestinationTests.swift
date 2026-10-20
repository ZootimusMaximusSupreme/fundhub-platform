import XCTest
@testable import FundhubPrompter

final class TeleprompterDestinationTests: XCTestCase {
    func testOpensLiveCurrentShootWithoutLoginOrPastedKey() {
        XCTAssertEqual(TeleprompterDestination.url.absoluteString, "https://fundhub.ai/app/teleprompter.html")
        XCTAssertNil(TeleprompterDestination.url.query)
    }
}
