import XCTest
@testable import FundhubPrompter

final class ShootFilmLinkTests: XCTestCase {
    private let key = "11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.1792339200." + String(repeating: "a", count: 64)

    func testAcceptsOnlyLiveTeleprompterFilmLinks() {
        let path = "/app/teleprompter.html?k=\(key)"
        XCTAssertEqual(ShootFilmLink.parse(path)?.absoluteString, "https://fundhub.ai\(path)")
        XCTAssertEqual(ShootFilmLink.parse("  https://fundhub.ai\(path)  ")?.absoluteString, "https://fundhub.ai\(path)")
        XCTAssertNil(ShootFilmLink.parse("https://fundhub.ai/app/teleprompter.html"))
        XCTAssertNil(ShootFilmLink.parse("https://evil.example\(path)"))
        XCTAssertNil(ShootFilmLink.parse("http://fundhub.ai\(path)"))
        XCTAssertNil(ShootFilmLink.parse("https://fundhub.ai.evil.example\(path)"))
        XCTAssertNil(ShootFilmLink.parse("https://fundhub.ai/app/teleprompter.html?k=bad"))
    }
}
