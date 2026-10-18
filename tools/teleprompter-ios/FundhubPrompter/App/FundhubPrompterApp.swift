import SwiftUI

@main
struct FundhubPrompterApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
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
    var body: some View {
        LivePrompterView()
    }
}
