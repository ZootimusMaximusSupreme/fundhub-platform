import Foundation

/// What a pairing link carries:
/// macbridge://pair?host=<lan-ip>&port=7878&token=<token>&name=<hostname>
struct PairingInfo: Equatable {
    var host: String
    var port: Int
    var token: String
    var name: String
}

enum PairingLinkError: Error, Equatable, LocalizedError {
    case notMacBridge
    case notPairing
    case missingHost
    case badPort
    case missingToken

    var errorDescription: String? {
        switch self {
        case .notMacBridge: return "That is not a Mac Bridge code."
        case .notPairing: return "That Mac Bridge link is not a pairing link."
        case .missingHost: return "The pairing link has no Mac address."
        case .badPort: return "The pairing link has a bad port number."
        case .missingToken: return "The pairing link has no token."
        }
    }
}

enum PairingLink {
    static let defaultPort = 7878

    static func parse(_ string: String) throws -> PairingInfo {
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed) else { throw PairingLinkError.notMacBridge }
        return try parse(url)
    }

    static func parse(_ url: URL) throws -> PairingInfo {
        guard let comps = URLComponents(url: url, resolvingAgainstBaseURL: false),
              comps.scheme?.lowercased() == "macbridge" else {
            throw PairingLinkError.notMacBridge
        }
        guard comps.host?.lowercased() == "pair" else { throw PairingLinkError.notPairing }

        func value(_ name: String) -> String {
            (comps.queryItems?.first { $0.name == name }?.value ?? "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }

        let host = value("host")
        guard !host.isEmpty, !host.contains(" "), !host.contains("/") else { throw PairingLinkError.missingHost }

        let portText = value("port")
        let port: Int
        if portText.isEmpty {
            port = defaultPort
        } else {
            guard let p = Int(portText), (1...65535).contains(p) else { throw PairingLinkError.badPort }
            port = p
        }

        let token = value("token")
        guard !token.isEmpty, !token.contains(where: { $0.isWhitespace }) else { throw PairingLinkError.missingToken }

        let name = value("name")
        return PairingInfo(host: host, port: port, token: token, name: name.isEmpty ? host : name)
    }
}
