import Foundation
import Security

/// The staff sign-in lives in the iOS Keychain on this device only
/// (kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly: never in a backup, never
/// synced to another device).
struct SignIn: Codable, Equatable {
    var token: String
    var expiresAt: String?
    var name: String?
    var email: String?
    var role: String?
}

enum Keychain {
    static let service = "ai.fundhub.prompter"
    static let account = "staff-session"

    static func save(_ s: SignIn) -> Bool {
        guard let data = try? JSONEncoder().encode(s) else { return false }
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let attrs: [String: Any] = [
            kSecValueData as String: data,
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

    static func load() -> SignIn? {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return try? JSONDecoder().decode(SignIn.self, from: data)
    }

    /// Sign out on this phone: forget this device's session copy.
    static func clear() {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        SecItemDelete(q as CFDictionary)
    }
}
