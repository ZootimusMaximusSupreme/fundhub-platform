import Foundation
import CryptoKit
import SwiftUI
import UIKit
import UserNotifications

enum NativePushEnvironment {
    static func current() -> String {
        // The same build configuration chooses the entitlement and APNs host.
        #if FUNDHUB_APNS_PRODUCTION
        return "production"
        #else
        return "development"
        #endif
    }

    static func valid(_ value: String?) -> String? {
        guard value == "development" || value == "production" else { return nil }
        return value
    }
}

enum NativePushInstallation {
    private static let key = "fundhub.nativePush.installationId"

    static var id: String {
        if let saved = UserDefaults.standard.string(forKey: key), UUID(uuidString: saved) != nil {
            return saved
        }
        let new = UUID().uuidString.lowercased()
        UserDefaults.standard.set(new, forKey: key)
        return new
    }
}

enum NativePushConsent {
    // App-level consent is separate from Apple's device-wide permission and
    // from whether a prior server registration still exists.
    private static let key = "fundhub.nativePush.userOptedIn"
    private static let sessionKey = "fundhub.nativePush.consentSessionFingerprint"

    // A prior user's consent must not follow a new bearer after app relaunch.
    // Store only a one-way hash, never the bearer itself, in UserDefaults.
    static func bind(to bearer: String, defaults: UserDefaults = .standard) {
        let fingerprint = SHA256.hash(data: Data(bearer.utf8))
            .map { String(format: "%02x", $0) }.joined()
        guard defaults.string(forKey: sessionKey) == fingerprint else {
            defaults.set(false, forKey: key)
            defaults.set(fingerprint, forKey: sessionKey)
            return
        }
    }

    static func isEnabled(defaults: UserDefaults = .standard) -> Bool {
        defaults.bool(forKey: key)
    }

    static func setEnabled(_ enabled: Bool, defaults: UserDefaults = .standard) {
        defaults.set(enabled, forKey: key)
    }
}

enum NativePushTap {
    static let portalPath = "/app/client-portal.html"
    static let requestLifetime: TimeInterval = 5 * 60

    static func opensClientPortal(_ userInfo: [AnyHashable: Any]) -> Bool {
        // APNs supplies this path from our server's approved payload. Never
        // navigate to a URL, query string, or client ID supplied by a push.
        (userInfo["path"] as? String) == portalPath
    }
}

@MainActor
final class NativePushCenter: ObservableObject {
    static let shared = NativePushCenter()

    enum State {
        case checking, off, registering, on, blocked, notReady, error(String)
    }

    @Published private(set) var state: State = .checking
    @Published private(set) var portalOpenRequestId = 0
    private var bearer: String?
    private var pendingPortalOpenAt: Date?
    private let api = FundhubAPI()
    private let registeredKey = "fundhub.nativePush.registered"

    private init() {}

    @discardableResult
    func recordNotificationTap(userInfo: [AnyHashable: Any], now: Date = Date()) -> Bool {
        guard NativePushTap.opensClientPortal(userInfo) else { return false }
        pendingPortalOpenAt = now
        portalOpenRequestId &+= 1
        return true
    }

    func takePortalOpenRequest(now: Date = Date()) -> Bool {
        guard let receivedAt = pendingPortalOpenAt else { return false }
        pendingPortalOpenAt = nil
        let age = now.timeIntervalSince(receivedAt)
        return age >= 0 && age <= NativePushTap.requestLifetime
    }

    func attach(bearer: String) async {
        // A different account cannot inherit another session's local consent.
        if let prior = self.bearer, prior != bearer {
            NativePushConsent.setEnabled(false)
        }
        NativePushConsent.bind(to: bearer)
        self.bearer = bearer
        await refresh()
    }

    func refresh() async {
        guard let bearer else { state = .off; return }
        state = .checking
        do {
            let server = try await api.nativePushStatus(token: bearer, installationId: NativePushInstallation.id)
            guard self.bearer == bearer else { return }
            // Do not re-register merely because iOS permission remains granted
            // or an old server-side registration is still present after opt-out.
            guard NativePushConsent.isEnabled() else {
                UIApplication.shared.unregisterForRemoteNotifications()
                if server.registered {
                    try await api.unregisterNativePush(token: bearer, installationId: NativePushInstallation.id)
                    guard self.bearer == bearer else { return }
                }
                UserDefaults.standard.set(false, forKey: registeredKey)
                state = server.configured ? .off : .notReady
                return
            }
            UserDefaults.standard.set(server.registered, forKey: registeredKey)
            guard server.configured else {
                state = .notReady
                return
            }
            let settings = await UNUserNotificationCenter.current().notificationSettings()
            guard self.bearer == bearer else { return }
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral:
                guard NativePushConsent.isEnabled() else { state = .off; return }
                state = server.registered ? .on : .registering
                UIApplication.shared.registerForRemoteNotifications()
            case .denied:
                state = .blocked
            default:
                state = .off
            }
        } catch {
            guard self.bearer == bearer else { return }
            state = .error("Could not check notifications. Try again.")
        }
    }

    func enable() async {
        guard let bearer else { return }
        state = .checking
        do {
            // Check the server and signing entitlement before spending the one iOS prompt.
            let server = try await api.nativePushStatus(token: bearer, installationId: NativePushInstallation.id)
            guard self.bearer == bearer else { return }
            guard server.configured else {
                state = .notReady
                return
            }
            let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
            guard self.bearer == bearer else { return }
            guard granted else {
                NativePushConsent.setEnabled(false)
                state = .blocked
                return
            }
            NativePushConsent.setEnabled(true)
            state = .registering
            UIApplication.shared.registerForRemoteNotifications()
        } catch {
            guard self.bearer == bearer else { return }
            state = .error("Could not turn on notifications. Try again.")
        }
    }

    func receivedDeviceToken(_ data: Data) async {
        guard let bearer, NativePushConsent.isEnabled() else { return }
        let environment = NativePushEnvironment.current()
        let token = data.map { String(format: "%02x", $0) }.joined()
        do {
            try await api.registerNativePush(
                token: bearer, deviceToken: token,
                environment: environment, installationId: NativePushInstallation.id
            )
            guard self.bearer == bearer && NativePushConsent.isEnabled() else {
                // An APNs callback/POST can finish after the user turned it off.
                try? await api.unregisterNativePush(token: bearer, installationId: NativePushInstallation.id)
                return
            }
            UserDefaults.standard.set(true, forKey: registeredKey)
            state = .on
        } catch {
            guard self.bearer == bearer else { return }
            state = .error("Could not finish notification setup. Try again.")
        }
    }

    func failedToRegister() {
        guard bearer != nil, NativePushConsent.isEnabled() else { return }
        state = .error("This iPhone could not connect to Apple notifications. Try again.")
    }

    func disable() async {
        // Persist opt-out immediately; a late callback may not revive consent.
        NativePushConsent.setEnabled(false)
        UIApplication.shared.unregisterForRemoteNotifications()
        guard let bearer else { state = .off; return }
        do {
            try await api.unregisterNativePush(token: bearer, installationId: NativePushInstallation.id)
            guard self.bearer == bearer else { return }
            UIApplication.shared.unregisterForRemoteNotifications()
            UserDefaults.standard.set(false, forKey: registeredKey)
            state = .off
        } catch {
            guard self.bearer == bearer else { return }
            state = .error("Could not turn notifications off. Try again.")
        }
    }

    func revokeBeforeSignOut() async throws {
        NativePushConsent.setEnabled(false)
        guard let bearer else { return }
        // Idempotent DELETE also covers a prior POST that reached the server
        // even though its response never reached this iPhone.
        try await api.unregisterNativePush(token: bearer, installationId: NativePushInstallation.id)
        UIApplication.shared.unregisterForRemoteNotifications()
        UserDefaults.standard.set(false, forKey: registeredKey)
        self.bearer = nil
        state = .off
    }

    func resetAfterInvalidSession() {
        NativePushConsent.setEnabled(false)
        UIApplication.shared.unregisterForRemoteNotifications()
        UserDefaults.standard.set(false, forKey: registeredKey)
        bearer = nil
        state = .off
    }
}

struct NativePushCard: View {
    @ObservedObject private var push = NativePushCenter.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Notifications", systemImage: "bell")
                .font(.headline)
            switch push.state {
            case .checking:
                ProgressView("Checking this iPhone")
            case .off:
                Text("Get Fundhub updates on this iPhone.")
                Button("Turn on notifications") { Task { await push.enable() } }
                    .buttonStyle(.bordered)
            case .registering:
                ProgressView("Connecting this iPhone")
            case .on:
                Text("This iPhone is ready for Fundhub notifications.")
                Button("Turn notifications off") { Task { await push.disable() } }
                    .buttonStyle(.bordered)
            case .blocked:
                Text("Notifications are blocked in iPhone Settings.")
                Link("Open iPhone Settings", destination: URL(string: UIApplication.openSettingsURLString)!)
            case .notReady:
                Text("Notifications are not switched on for this app yet.")
            case .error(let message):
                Text(message)
                Button("Try notifications again") { Task { await push.refresh() } }
                    .buttonStyle(.bordered)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
    }
}

final class FundhubPushDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { @MainActor in await NativePushCenter.shared.receivedDeviceToken(deviceToken) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        Task { @MainActor in NativePushCenter.shared.failedToRegister() }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        guard response.actionIdentifier == UNNotificationDefaultActionIdentifier else {
            completionHandler()
            return
        }
        Task { @MainActor in
            NativePushCenter.shared.recordNotificationTap(userInfo: response.notification.request.content.userInfo)
            completionHandler()
        }
    }
}
