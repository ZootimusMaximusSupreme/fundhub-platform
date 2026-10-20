import SwiftUI

/// Small "Live / Connecting / Retry in 4s" pill for the one shared WebSocket.
struct StatusPill: View {
    @EnvironmentObject private var socket: BridgeSocket

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(color)
                .frame(width: 8, height: 8)
            Text(label)
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .background(Capsule().fill(Color(.secondarySystemBackground)))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Connection: \(label)")
    }

    private var label: String {
        switch socket.state {
        case .idle: return "Offline"
        case .connecting: return "Connecting"
        case .connected: return "Live"
        case .waiting(let s): return "Retry in \(s)s"
        case .unauthorized: return "Token rejected"
        }
    }

    private var color: Color {
        switch socket.state {
        case .connected: return .green
        case .connecting: return .yellow
        case .waiting: return .orange
        case .idle, .unauthorized: return .red
        }
    }
}
