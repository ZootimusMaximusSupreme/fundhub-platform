import SwiftUI

/// Change one paragraph's words, even while the camera records. Done saves it
/// to the script through the same route the dashboard uses.
struct EditSheet: View {
    let target: EditTarget
    let save: (String) -> Void
    @State private var text: String = ""
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 12) {
                Text(target.title).font(.headline)
                TextEditor(text: $text)
                    .font(.title3)
                    .focused($focused)
                    .scrollContentBackground(.hidden)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                    .accessibilityIdentifier("edit.text")
                Text("Done saves it to the script. The dashboard sees the new words too. CAPS = punch. A blank line = pause.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            .padding(16)
            .navigationTitle("Change the words")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { save(text); dismiss() }.bold().accessibilityIdentifier("edit.done")
                }
            }
            .onAppear {
                text = target.text
                focused = true
            }
        }
        .presentationDetents([.medium, .large])
    }
}

/// Someone changed the same script on the dashboard while this phone waited.
/// Both texts show; Chris picks.
struct ConflictSheet: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                ForEach(model.queue.items.values.filter { $0.conflict != nil }, id: \.root) { it in
                    Section(it.title ?? "Script") {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Yours (this phone)").font(.caption.bold()).foregroundStyle(Brand.amber)
                            Text(it.body).font(.callout)
                        }
                        VStack(alignment: .leading, spacing: 6) {
                            Text("On the dashboard now").font(.caption.bold()).foregroundStyle(.blue)
                            Text(it.conflict?.theirBody ?? "").font(.callout)
                        }
                        Button("Keep mine") { Task { await model.keepMine(it.root) } }
                            .bold()
                        Button("Keep the dashboard's") { model.keepTheirs(it.root) }
                    }
                }
            }
            .navigationTitle("Two versions")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Close") { dismiss() } } }
        }
    }
}
