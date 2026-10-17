import Foundation
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

@MainActor
final class NativePushCenter: ObservableObject {
    static let shared = NativePushCenter()

    enum State {
        case checking, off, registering, on, blocked, notReady, error(String)
    }

    @Published private(set) var state: State = .checking
    private var bearer: String?
    private let api = FundhubAPI()
    private let registeredKey = "fundhub.nativePush.registered"

    private init() {}

    func attach(bearer: String) async {
        self.bearer = bearer
        await refresh()
    }

    func refresh() async {
        guard let bearer else { state = .off; return }
        state = .checking
        do {
            let server = try await api.nativePushStatus(token: bearer, installationId: NativePushInstallation.id)
            guard self.bearer == bearer else { return }
            UserDefaults.standard.set(server.registered, forKey: registeredKey)
            guard server.configured else {
                state = .notReady
                return
            }
            let settings = await UNUserNotificationCenter.current().notificationSettings()
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral:
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
            guard granted else { state = .blocked; return }
            state = .registering
            UIApplication.shared.registerForRemoteNotifications()
        } catch {
            guard self.bearer == bearer else { return }
            state = .error("Could not turn on notifications. Try again.")
        }
    }

    func receivedDeviceToken(_ data: Data) async {
        guard let bearer else { return }
        let environment = NativePushEnvironment.current()
        let token = data.map { String(format: "%02x", $0) }.joined()
        do {
            try await api.registerNativePush(
                token: bearer, deviceToken: token,
                environment: environment, installationId: NativePushInstallation.id
            )
            guard self.bearer == bearer else { return }
            UserDefaults.standard.set(true, forKey: registeredKey)
            state = .on
        } catch {
            guard self.bearer == bearer else { return }
            state = .error("Could not finish notification setup. Try again.")
        }
    }

    func failedToRegister() {
        guard bearer != nil else { return }
        state = .error("This iPhone could not connect to Apple notifications. Try again.")
    }

    func disable() async {
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
}
