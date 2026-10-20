import SwiftUI

@main
struct FundhubPrompterApp: App {
    @StateObject private var model = AppModel()
    @StateObject private var camera = CameraController()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .environmentObject(camera)
                .preferredColorScheme(.dark)
                .tint(Brand.amber)
        }
    }
}

enum Brand {
    static let amber = Color(red: 1, green: 0.75, blue: 0.2)
    static let glass = Color.black
    static let good = Color(red: 0.35, green: 0.85, blue: 0.5)
    static let warn = Color(red: 1, green: 0.75, blue: 0.2)
    static let bad = Color(red: 1, green: 0.4, blue: 0.4)
}

struct RootView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.scenePhase) private var phase

    var body: some View {
        ScriptListView()
        .onChange(of: phase) { _, p in
            if p == .active { model.startPolling() } else { model.stopPolling() }
        }
        .onAppear { model.startPolling() }
    }
}
