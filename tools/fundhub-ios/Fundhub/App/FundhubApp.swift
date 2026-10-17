import SwiftUI
import WebKit

@main
struct FundhubApp: App {
    @StateObject private var store = FundhubSessionStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .tint(.black)
        }
    }
}

@MainActor
final class FundhubSessionStore: ObservableObject {
    enum Phase { case checking, signedOut, signedIn, error }

    @Published var phase: Phase = .checking
    @Published var identity: SessionReply?
    @Published var summary: PortalSummary?
    @Published var summaryLoading = false
    @Published var message: String?

    private let api = FundhubAPI()
    private(set) var token: String?

    init() { Task { await restore() } }

    func restore() async {
        guard let stored = SessionKeychain.read() else { phase = .signedOut; return }
        token = stored
        await refreshSession()
    }

    func signIn(email: String, password: String) async {
        phase = .checking
        message = nil
        do {
            let reply = try await api.login(email: email.trimmingCharacters(in: .whitespacesAndNewlines), password: password)
            try await accept(reply)
        } catch {
            phase = .signedOut
            message = error.localizedDescription
        }
    }

    func requestLink(email: String) async {
        message = nil
        do {
            try await api.requestLink(email: email.trimmingCharacters(in: .whitespacesAndNewlines))
            message = "Check your email. Copy the Fundhub sign-in link, then tap Paste link here."
        } catch { message = error.localizedDescription }
    }

    func pasteLink(_ text: String?) async {
        guard let text, let linkToken = MagicLink.token(from: text) else {
            message = "Copy the full Fundhub sign-in link from your email and try again."
            return
        }
        phase = .checking
        message = nil
        do { try await accept(try await api.exchangeLink(linkToken)) }
        catch {
            phase = .signedOut
            message = error.localizedDescription
        }
    }

    private func accept(_ reply: LoginReply) async throws {
        guard reply.ok, let newToken = reply.token, !newToken.isEmpty else {
            throw FundhubAPIError.refused(reply.message ?? "That sign-in did not work.")
        }
        SessionKeychain.save(newToken)
        token = newToken
        await refreshSession()
    }

    func refreshSession() async {
        guard let token else { phase = .signedOut; return }
        do {
            let result = try await api.identity(token: token)
            guard result.ok, result.principal == "client" || result.principal == "staff" else {
                throw FundhubAPIError.invalidResponse
            }
            identity = result
            phase = .signedIn
            message = nil
            if result.principal == "client" { await loadSummary() }
        } catch {
            // A network outage does not destroy a valid session.
            if case FundhubAPIError.refused = error { signOut(); return }
            phase = .error
            message = error.localizedDescription
        }
    }

    func loadSummary() async {
        guard identity?.principal == "client", let token else { return }
        summaryLoading = true
        defer { summaryLoading = false }
        do {
            let result = try await api.portalSummary(token: token)
            guard result.ok else { throw FundhubAPIError.invalidResponse }
            summary = result
            message = nil
        } catch {
            summary = nil
            message = "We could not load your file. Pull down to try again."
        }
    }

    func signOut() {
        SessionKeychain.clear()
        token = nil
        identity = nil
        summary = nil
        message = nil
        phase = .signedOut
        WKWebsiteDataStore.default().removeData(
            ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(),
            modifiedSince: .distantPast,
            completionHandler: {}
        )
    }
}

private struct RootView: View {
    @EnvironmentObject private var store: FundhubSessionStore

    var body: some View {
        Group {
            switch store.phase {
            case .checking: ProgressView("Connecting to Fundhub")
            case .signedOut: SignInView()
            case .signedIn: HomeView()
            case .error:
                ContentUnavailableView {
                    Label("Could not connect", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(store.message ?? "Check your connection and try again.")
                } actions: {
                    Button("Try again") { Task { await store.refreshSession() } }
                    Button("Sign out") { store.signOut() }
                }
            }
        }
    }
}

private struct SignInView: View {
    @EnvironmentObject private var store: FundhubSessionStore
    @State private var email = ""
    @State private var password = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                BrandMark()
                VStack(alignment: .leading, spacing: 8) {
                    Text("Your Fundhub app").font(.largeTitle.bold())
                    Text("For clients and the Fundhub team.").foregroundStyle(.secondary)
                }
                VStack(spacing: 16) {
                    TextField("Email address", text: $email)
                        .textContentType(.emailAddress).keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("Password", text: $password).textContentType(.password)
                }
                .textFieldStyle(.roundedBorder)

                Button("Sign in") { Task { await store.signIn(email: email, password: password) } }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(email.isEmpty || password.isEmpty)

                Divider()
                Text("Client sign-in link").font(.headline)
                Text("No password? We can email a one-time link to the address on your file.")
                    .foregroundStyle(.secondary)
                Button("Email me a sign-in link") { Task { await store.requestLink(email: email) } }
                    .disabled(email.isEmpty)
                Button("Paste link here") { Task { await store.pasteLink(UIPasteboard.general.string) } }

                if let message = store.message {
                    Text(message).foregroundStyle(.secondary).accessibilityIdentifier("signInMessage")
                }
                Link("Privacy policy", destination: URL(string: "https://fundhub.ai/privacy/")!)
                Link("Help: support@fundhub.ai", destination: URL(string: "mailto:support@fundhub.ai")!)
            }
            .frame(maxWidth: 520, alignment: .leading)
            .padding(24)
        }
        .background(Color(.systemGroupedBackground))
    }
}

private struct HomeView: View {
    @EnvironmentObject private var store: FundhubSessionStore
    @State private var showingWorkspace = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    if store.identity?.principal == "client" { clientHome }
                    else { staffHome }
                }
                .frame(maxWidth: 660, alignment: .leading)
                .padding(24)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Fundhub")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Sign out") { store.signOut() }
                }
            }
            .safeAreaInset(edge: .bottom) {
                Link("Privacy policy", destination: URL(string: "https://fundhub.ai/privacy/")!)
                    .font(.caption)
                    .padding(8)
            }
            .sheet(isPresented: $showingWorkspace) {
                if let token = store.token, let identity = store.identity {
                    NavigationStack {
                        WorkspaceWebView(
                            token: token,
                            principal: identity.principal,
                            identity: identity.staff,
                            path: FundhubRole.workspacePath(
                                principal: identity.principal,
                                role: identity.staff.role
                            )
                        )
                        .navigationTitle(identity.principal == "client" ? "Client portal" : "My workspace")
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItem(placement: .topBarTrailing) {
                                Button("Done") { showingWorkspace = false }
                            }
                        }
                    }
                }
            }
        }
    }

    private var clientHome: some View {
        VStack(alignment: .leading, spacing: 24) {
            Text("Your file").font(.largeTitle.bold())
            if store.summaryLoading && store.summary == nil {
                ProgressView("Loading your file")
                    .frame(maxWidth: .infinity, minHeight: 180)
            } else if let summary = store.summary {
                VStack(alignment: .leading, spacing: 8) {
                    Text("CURRENT STATUS").font(.caption.weight(.bold)).foregroundStyle(.secondary)
                    Text(summary.stage.title).font(.title2.bold())
                }
                .fundhubCard()
                if let advisor = summary.advisor {
                    detailRow("Your advisor", value: advisor.name, icon: "person.crop.circle")
                }
                detailRow("Documents", value: "\(summary.documents.count) on your file", icon: "doc.text")
                if let due = summary.invoiceDue {
                    detailRow("Amount due", value: due.count == 0 ? "Nothing due" : due.totalDisplay, icon: "creditcard")
                } else {
                    detailRow("Amount due", value: "Could not check right now", icon: "creditcard")
                }
            } else {
                ContentUnavailableView("File unavailable", systemImage: "arrow.clockwise", description: Text(store.message ?? "Pull down to try again."))
            }
            Button("Open full portal") { showingWorkspace = true }
                .buttonStyle(.borderedProminent).controlSize(.large)
        }
        .refreshable { await store.loadSummary() }
    }

    private var staffHome: some View {
        VStack(alignment: .leading, spacing: 24) {
            Text("My work").font(.largeTitle.bold())
            VStack(alignment: .leading, spacing: 8) {
                Text("SIGNED IN AS").font(.caption.weight(.bold)).foregroundStyle(.secondary)
                Text(store.identity?.staff.name ?? "Fundhub team").font(.title2.bold())
                Text(FundhubRole.title(store.identity?.staff.role)).foregroundStyle(.secondary)
            }
            .fundhubCard()
            Text("Open your Fundhub workspace to see your current work and take action.")
                .foregroundStyle(.secondary)
            Button("Open my work") { showingWorkspace = true }
                .buttonStyle(.borderedProminent).controlSize(.large)
        }
    }

    private func detailRow(_ title: String, value: String, icon: String) -> some View {
        HStack(spacing: 16) {
            Image(systemName: icon).frame(width: 28)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.caption).foregroundStyle(.secondary)
                Text(value).font(.body.weight(.semibold))
            }
            Spacer()
        }
        .fundhubCard()
    }
}

private struct BrandMark: View {
    var body: some View {
        Text("f.")
            .font(.system(size: 46, weight: .black, design: .rounded))
            .foregroundStyle(.white)
            .frame(width: 72, height: 72)
            .background(.black, in: RoundedRectangle(cornerRadius: 16))
            .accessibilityLabel("Fundhub")
    }
}

private extension View {
    func fundhubCard() -> some View {
        self.frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
    }
}
