import SwiftUI

@main
struct MacBridgeApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .environmentObject(model.socket)
                .onOpenURL { model.handleIncoming($0) }
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            if model.mac != nil {
                SessionListView()
            } else {
                PairView()
            }
        }
        .onAppear { model.onAppear() }
        .onChange(of: scenePhase) { _, phase in model.scenePhaseChanged(phase) }
        .alert(
            "Pair with this Mac?",
            isPresented: Binding(
                get: { model.incomingPairing != nil },
                set: { if !$0 { model.incomingPairing = nil } }
            ),
            presenting: model.incomingPairing
        ) { info in
            Button("Pair") { Task { await model.confirmIncoming(info) } }
            Button("Cancel", role: .cancel) { model.incomingPairing = nil }
        } message: { info in
            Text("\(info.name) at \(info.host):\(String(info.port))")
        }
        .alert(
            "Mac Bridge",
            isPresented: Binding(
                get: { model.alertMessage != nil },
                set: { if !$0 { model.alertMessage = nil } }
            )
        ) {
            Button("OK", role: .cancel) { model.alertMessage = nil }
        } message: {
            Text(model.alertMessage ?? "")
        }
    }
}
