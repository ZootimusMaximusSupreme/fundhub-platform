import Foundation
import Security

/// The paired Mac. Host, port and name live in UserDefaults.
/// The token lives in the Keychain only.
struct PairedMac: Codable, Equatable {
    var host: String
    var port: Int
    var name: String

    /// "http://192.168.1.5:7878" or "ws://[fe80::1%25en0]:7878".
    func baseURL(scheme: String) -> URL? {
        URL(string: "\(scheme)://\(Self.urlHost(host)):\(port)")
    }

    static func urlHost(_ host: String) -> String {
        guard host.contains(":") else { return host }
        let bare = host.trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
        return "[" + bare.replacingOccurrences(of: "%", with: "%25") + "]"
    }
}

struct PairedMacStore {
    static let defaultsKey = "pairedMac"
    var defaults: UserDefaults = .standard
    var keychain = TokenKeychain()

    func load() -> (mac: PairedMac, token: String)? {
        guard let data = defaults.data(forKey: Self.defaultsKey),
              let mac = try? JSONDecoder().decode(PairedMac.self, from: data),
              let token = keychain.load(), !token.isEmpty else { return nil }
        return (mac, token)
    }

    @discardableResult
    func save(mac: PairedMac, token: String) -> Bool {
        guard keychain.save(token), let data = try? JSONEncoder().encode(mac) else { return false }
        defaults.set(data, forKey: Self.defaultsKey)
        return true
    }

    func clear() {
        defaults.removeObject(forKey: Self.defaultsKey)
        keychain.clear()
    }
}

/// The pairing token, kept on this device only (never in a backup, never synced).
struct TokenKeychain {
    var service = "ai.fundhub.macbridge"
    var account = "mac-token"

    private var base: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }

    func save(_ token: String) -> Bool {
        let attrs: [String: Any] = [
            kSecValueData as String: Data(token.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        let status = SecItemUpdate(base as CFDictionary, attrs as CFDictionary)
        if status == errSecItemNotFound {
            var add = base
            add.merge(attrs) { $1 }
            return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
        }
        return status == errSecSuccess
    }

    func load() -> String? {
        var q = base
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess,
              let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func clear() {
        SecItemDelete(base as CFDictionary)
    }
}
