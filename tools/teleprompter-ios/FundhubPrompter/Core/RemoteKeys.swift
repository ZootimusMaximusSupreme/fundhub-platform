import Foundation

/// What a remote button or keyboard key does. v1's keys stay as they are
/// (spec §8.1): Space, Enter and PageDown play/pause, the arrows change speed,
/// PageUp restarts. At the END of a script, play keys mean Got it and the
/// restart key means Another take. Settings › Learn remote adds any remote's
/// buttons to a slot, per device.
enum RemoteAction: String, CaseIterable, Codable {
    case play
    case faster
    case slower
    case restart
    case gotIt = "got_it"
    case anotherTake = "another_take"
    case record

    /// The label in Learn remote (4th grade words).
    var label: String {
        switch self {
        case .play: return "Play / pause"
        case .faster: return "Faster"
        case .slower: return "Slower"
        case .restart: return "Start over"
        case .gotIt: return "Got it"
        case .anotherTake: return "Another take"
        case .record: return "Record / stop"
        }
    }
}

enum RemoteKeys {
    /// Key ids are "hid:<usage number>" (UIKeyboardHIDUsage raw value), so any
    /// remote that types a key can be learned.
    static func id(hidUsage: Int) -> String { "hid:\(hidUsage)" }

    // UIKeyboardHIDUsage raw values (USB HID usage table, page 0x07).
    static let space = 0x2C
    static let enter = 0x28
    static let keypadEnter = 0x58
    static let pageUp = 0x4B
    static let pageDown = 0x4E
    static let right = 0x4F
    static let left = 0x50
    static let down = 0x51
    static let up = 0x52
    static let r = 0x15

    static let defaults: [RemoteAction: [String]] = [
        .play: [id(hidUsage: space), id(hidUsage: enter), id(hidUsage: keypadEnter), id(hidUsage: pageDown)],
        .faster: [id(hidUsage: up), id(hidUsage: right)],
        .slower: [id(hidUsage: down), id(hidUsage: left)],
        .restart: [id(hidUsage: pageUp)],
        .gotIt: [],
        .anotherTake: [],
        .record: [id(hidUsage: r)]
    ]

    /// What a key does. Learned keys win over the defaults.
    static func action(for keyId: String, learned: [String: [String]], atEnd: Bool) -> RemoteAction? {
        let order: [RemoteAction] = [.gotIt, .anotherTake, .record, .play, .restart, .faster, .slower]
        for slot in order where (learned[slot.rawValue] ?? []).contains(keyId) {
            return mapEnd(slot, atEnd: atEnd)
        }
        for slot in order where (defaults[slot] ?? []).contains(keyId) {
            return mapEnd(slot, atEnd: atEnd)
        }
        return nil
    }

    static func mapEnd(_ slot: RemoteAction, atEnd: Bool) -> RemoteAction {
        if atEnd && slot == .play { return .gotIt }
        if atEnd && slot == .restart { return .anotherTake }
        if !atEnd && slot == .gotIt { return .play }
        if !atEnd && slot == .anotherTake { return .restart }
        return slot
    }

    /// Learn one key for a slot: it moves off every other slot first, so one
    /// button never does two things.
    static func learn(_ keyId: String, for slot: RemoteAction, into learned: [String: [String]]) -> [String: [String]] {
        var out = learned
        for k in out.keys { out[k]?.removeAll { $0 == keyId } }
        var list = out[slot.rawValue] ?? []
        if !list.contains(keyId) { list.append(keyId) }
        out[slot.rawValue] = list
        return out
    }
}
