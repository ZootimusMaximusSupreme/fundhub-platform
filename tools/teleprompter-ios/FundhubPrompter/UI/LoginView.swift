import SwiftUI

/// Sign in with the Fundhub staff login (POST /api/auth/login). The session is
/// kept in the Keychain, so Chris signs in once per phone.
struct LoginView: View {
    @EnvironmentObject var model: AppModel
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var problem: String?
    @State private var showSettings = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Spacer(minLength: 20)
                Text("Fundhub Prompter")
                    .font(.largeTitle.bold())
                Text("Sign in with your Fundhub login.")
                    .foregroundStyle(.secondary)
                VStack(spacing: 12) {
                    TextField("Email", text: $email)
                        .textContentType(.username)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .padding(14)
                        .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                        .accessibilityIdentifier("login.email")
                    SecureField("Password", text: $password)
                        .textContentType(.password)
                        .padding(14)
                        .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                        .accessibilityIdentifier("login.password")
                }
                .frame(maxWidth: 420)
                if let p = problem {
                    Text(p).foregroundStyle(Brand.bad).multilineTextAlignment(.center)
                }
                Button {
                    Task {
                        busy = true
                        problem = await model.login(email: email, password: password)
                        busy = false
                    }
                } label: {
                    Text(busy ? "Signing in…" : "Sign in")
                        .font(.headline)
                        .frame(maxWidth: 420)
                        .padding(.vertical, 14)
                }
                .buttonStyle(.borderedProminent)
                .disabled(busy || email.trimmed.isEmpty || password.isEmpty)
                .accessibilityIdentifier("login.submit")
                if let note = model.loadNote {
                    Text(note).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                }
                if model.queue.waitingEdits > 0 {
                    Text("\(model.queue.waitingEdits) edits are waiting on this phone. They save after you sign in.")
                        .font(.footnote).foregroundStyle(Brand.warn).multilineTextAlignment(.center)
                }
                Spacer()
                Text("Server: \(model.settings.serverAddress)")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            .padding(24)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showSettings = true } label: { Image(systemName: "gearshape") }
                        .accessibilityLabel("Settings")
                }
            }
            .sheet(isPresented: $showSettings) { SettingsView() }
        }
    }
}
