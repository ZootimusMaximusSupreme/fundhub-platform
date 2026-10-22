import SwiftUI
import WebKit

@main
struct FundhubApp: App {
    @UIApplicationDelegateAdaptor(FundhubPushDelegate.self) private var pushDelegate
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
    enum Phase: Equatable { case checking, signedOut, signedIn, error }

    @Published var phase: Phase = .checking
    @Published var identity: SessionReply?
    @Published var summary: PortalSummary?
    @Published var summaryLoading = false
    @Published var signingIn = false
    @Published var message: String?

    private let api = FundhubAPI()
    private(set) var token: String?
    var hasSavedSession: Bool { SessionKeychain.hasSavedSession }
    var savedSessionUnlockLabel: String { SessionKeychain.unlockLabel }

    init() { Task { await restore() } }

    func restore() async {
        let hadSavedSession = SessionKeychain.hasSavedSession
        guard hadSavedSession else { phase = .signedOut; return }
        phase = .checking
        let stored = await Task.detached(priority: .userInitiated) { SessionKeychain.read() }.value
        guard let stored else {
            phase = .signedOut
            message = "Could not unlock your saved sign-in. Try again or sign in another way."
            return
        }
        token = stored
        await refreshSession()
    }

    func signIn(email: String, password: String) async {
        signingIn = true
        defer { signingIn = false }
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
            message = "Check your email. Copy the Fundhub sign-in link, then tap Paste a sign-in link."
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
        let savedForQuickSignIn = SessionKeychain.save(newToken)
        token = newToken
        await refreshSession()
        if phase == .signedIn && !savedForQuickSignIn {
            message = "Signed in, but this iPhone could not save Face ID sign-in. You can still use Fundhub now."
        }
    }

    func refreshSession() async {
        guard let token else { phase = .signedOut; return }
        do {
            let result = try await api.identity(token: token)
            guard self.token == token else { return }
            guard result.ok, result.principal == "client" || result.principal == "staff" else {
                throw FundhubAPIError.invalidResponse
            }
            identity = result
            phase = .signedIn
            message = nil
            if result.principal == "client" {
                await loadSummary()
                guard self.token == token, phase == .signedIn else { return }
                await NativePushCenter.shared.attach(bearer: token)
            }
        } catch {
            guard self.token == token else { return }
            // A network outage does not destroy a valid session.
            if case FundhubAPIError.invalidSession = error {
                await signOut(revoke: false)
                return
            }
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
            guard self.token == token else { return }
            guard result.ok else { throw FundhubAPIError.invalidResponse }
            summary = result
            message = nil
        } catch {
            guard self.token == token else { return }
            if case FundhubAPIError.invalidSession = error {
                await signOut(revoke: false)
                return
            }
            summary = nil
            message = "We could not load your file. Pull down to try again."
        }
    }

    func signOut(revoke: Bool = true) async {
        phase = .checking
        var pushRevokeFailed = false
        if identity?.principal == "client" && revoke {
            do { try await NativePushCenter.shared.revokeBeforeSignOut() }
            catch FundhubAPIError.invalidSession { /* Web sign-out already revoked this bearer. */ }
            catch { pushRevokeFailed = true }
            NativePushCenter.shared.resetAfterInvalidSession()
        } else {
            NativePushCenter.shared.resetAfterInvalidSession()
        }
        var revokeFailed = false
        if revoke, let token {
            do { try await api.logout(token: token) }
            catch FundhubAPIError.invalidSession { /* Already revoked by the web portal. */ }
            catch { revokeFailed = true }
        }
        SessionKeychain.clear()
        token = nil
        identity = nil
        summary = nil
        message = revokeFailed
            ? "Signed out here. Fundhub could not close the server session while offline. Notifications may still arrive until the session expires."
            : pushRevokeFailed ? "Signed out. The server session was closed, which also stops notifications." : nil
        await WKWebsiteDataStore.default().removeData(
            ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(),
            modifiedSince: .distantPast
        )
        phase = .signedOut
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
                    Button("Sign out") { Task { await store.signOut() } }
                }
            }
        }
    }
}

private struct SignInView: View {
    @EnvironmentObject private var store: FundhubSessionStore
    @State private var email = ""
    @State private var password = ""
    @State private var showingLink = false
    @State private var sendingLink = false
    @State private var localMessage: String?
    @FocusState private var focusedField: Field?

    private enum Field { case email, password }

    private var ink: Color { Color(red: 10 / 255, green: 10 / 255, blue: 10 / 255) }
    private var mutedInk: Color { Color(red: 72 / 255, green: 72 / 255, blue: 72 / 255) }
    private var paper: Color { Color(red: 252 / 255, green: 252 / 255, blue: 252 / 255) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                BrandMark()
                    .padding(.top, 16)

                VStack(alignment: .leading, spacing: 16) {
                    Text("Your file,\nin focus.")
                        .font(.system(size: 38, weight: .bold, design: .rounded))
                        .tracking(-1.5)
                        .foregroundStyle(ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("See where things stand and what comes next.")
                        .font(.body)
                        .foregroundStyle(mutedInk)
                }
                .padding(.top, 48)

                if store.hasSavedSession {
                    Button { Task { await store.restore() } } label: {
                        Label(store.savedSessionUnlockLabel, systemImage: "faceid")
                            .frame(maxWidth: .infinity, minHeight: 52)
                    }
                    .buttonStyle(.plain)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.white)
                    .background(ink, in: RoundedRectangle(cornerRadius: 16))
                    .padding(.top, 32)
                }

                VStack(alignment: .leading, spacing: 16) {
                    Text("Client or Fundhub team sign-in")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(mutedInk)

                    TextField("Email address", text: $email, prompt: Text("Email address").foregroundColor(mutedInk))
                        .textContentType(.username)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(showingLink ? .send : .next)
                        .focused($focusedField, equals: .email)
                        .onSubmit { if showingLink { requestClientLink() } else { focusedField = .password } }
                        .font(.body)
                        .foregroundStyle(ink)
                        .padding(.horizontal, 16)
                        .frame(minHeight: 52)
                        .background(.white, in: RoundedRectangle(cornerRadius: 16))
                        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(.separator), lineWidth: 1))
                        .accessibilityIdentifier("signInEmail")
                        .onChange(of: email) { _, _ in localMessage = nil }

                    if showingLink {
                        primaryButton(
                            title: sendingLink ? "Sending your link…" : "Email me a sign-in link",
                            busy: sendingLink, action: requestClientLink
                        )
                        .accessibilityIdentifier("signInSendLink")
                    } else {
                        SecureField("Password", text: $password, prompt: Text("Password").foregroundColor(mutedInk))
                            .textContentType(.password)
                            .submitLabel(.go)
                            .focused($focusedField, equals: .password)
                            .onSubmit(signInWithPassword)
                            .font(.body)
                            .foregroundStyle(ink)
                            .padding(.horizontal, 16)
                            .frame(minHeight: 52)
                            .background(.white, in: RoundedRectangle(cornerRadius: 16))
                            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(.separator), lineWidth: 1))
                            .accessibilityIdentifier("signInPassword")

                        primaryButton(
                            title: store.signingIn ? "Signing in…" : "Sign in",
                            busy: store.signingIn, action: signInWithPassword
                        )
                        .accessibilityIdentifier("signInSubmit")
                    }
                }
                .padding(.top, store.hasSavedSession ? 24 : 32)

                if showingLink {
                    Button {
                        localMessage = nil
                        Task { await store.pasteLink(UIPasteboard.general.string) }
                    } label: {
                        Label("Paste a sign-in link", systemImage: "doc.on.clipboard")
                            .frame(maxWidth: .infinity, minHeight: 52)
                    }
                    .buttonStyle(.plain)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(ink)
                    .background(.white, in: RoundedRectangle(cornerRadius: 16))
                    .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(.separator), lineWidth: 1))
                    .padding(.top, 16)
                }

                Button {
                    showingLink.toggle()
                    localMessage = nil
                    store.message = nil
                } label: {
                    HStack {
                        Text(showingLink ? "Have a password?" : "No password?")
                            .foregroundStyle(mutedInk)
                        Text(showingLink ? "Sign in with it" : "Email me a sign-in link")
                            .fontWeight(.semibold)
                        Image(systemName: "arrow.right").font(.caption.weight(.semibold))
                    }
                    .font(.subheadline)
                    .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.plain)
                .foregroundStyle(ink)
                .padding(.top, 16)
                .accessibilityIdentifier("signInSwitchMode")

                if let message = localMessage ?? store.message {
                    Label(message, systemImage: "info.circle")
                        .font(.subheadline)
                        .foregroundStyle(ink)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(16)
                        .background(Color(red: 196 / 255, green: 179 / 255, blue: 229 / 255).opacity(0.22), in: RoundedRectangle(cornerRadius: 16))
                        .accessibilityIdentifier("signInMessage")
                        .padding(.top, 16)
                }

                Spacer(minLength: 48)
                HStack(spacing: 24) {
                    Link("Privacy policy", destination: URL(string: "https://fundhub.ai/privacy/")!)
                    Link("Need help?", destination: URL(string: "mailto:support@fundhub.ai")!)
                }
                .font(.subheadline)
                .foregroundStyle(mutedInk)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            }
            .frame(maxWidth: 520, alignment: .leading)
            .padding(24)
        }
        .background(paper)
    }

    private func requestClientLink() {
        guard !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            localMessage = "Enter the email address on your file to get a sign-in link."
            focusedField = .email
            return
        }
        localMessage = nil
        sendingLink = true
        Task {
            await store.requestLink(email: email)
            sendingLink = false
        }
    }

    private func signInWithPassword() {
        guard !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            localMessage = "Enter your email address."
            focusedField = .email
            return
        }
        guard !password.isEmpty else {
            localMessage = "Enter your password."
            focusedField = .password
            return
        }
        localMessage = nil
        focusedField = nil
        Task { await store.signIn(email: email, password: password) }
    }

    private func primaryButton(title: String, busy: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if busy { ProgressView().tint(store.hasSavedSession ? ink : .white) }
                Text(title)
            }
            .frame(maxWidth: .infinity, minHeight: 52)
        }
        .buttonStyle(.plain)
        .font(.body.weight(.semibold))
        .foregroundStyle(store.hasSavedSession ? ink : .white)
        .background(store.hasSavedSession ? .white : ink, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(store.hasSavedSession ? Color(.separator) : .clear, lineWidth: 1))
        .disabled(busy)
    }
}

private struct HomeView: View {
    @EnvironmentObject private var store: FundhubSessionStore
    @ObservedObject private var push = NativePushCenter.shared
    @State private var showingWorkspace = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    if store.identity?.principal == "client" { clientHome }
                    else { staffHome }
                    if let message = store.message,
                       store.identity?.principal != "client" || store.summary != nil {
                        Text(message).foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: 660, alignment: .leading)
                .padding(24)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Fundhub")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Sign out") { Task { await store.signOut() } }
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
                            ),
                            onWebSignOut: {
                                showingWorkspace = false
                                Task { await store.signOut() }
                            }
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
            .task(id: push.portalOpenRequestId) {
                guard push.takePortalOpenRequest() else { return }
                guard store.identity?.principal == "client" else { return }
                // A tapped alert is never a navigation URL or an assertion that
                // a call still exists. Verify this session again, then let the
                // portal read the client's current call under that session.
                await store.refreshSession()
                guard store.phase == .signedIn, store.identity?.principal == "client" else { return }
                showingWorkspace = true
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
            NativePushCard()
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
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                Text("f.")
                    .font(.system(size: 26, weight: .black, design: .rounded))
                    .foregroundStyle(.white)
                    .frame(width: 40, height: 40)
                    .background(.black, in: RoundedRectangle(cornerRadius: 10))
                Text("fundhub")
                    .font(.system(size: 23, weight: .bold, design: .rounded))
                    .tracking(-0.5)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Fundhub")

            RoundedRectangle(cornerRadius: 2)
                .fill(LinearGradient(colors: [
                    Color(red: 242 / 255, green: 166 / 255, blue: 155 / 255),
                    Color(red: 245 / 255, green: 206 / 255, blue: 143 / 255),
                    Color(red: 242 / 255, green: 227 / 255, blue: 155 / 255),
                    Color(red: 168 / 255, green: 216 / 255, blue: 176 / 255),
                    Color(red: 169 / 255, green: 198 / 255, blue: 232 / 255),
                    Color(red: 196 / 255, green: 179 / 255, blue: 229 / 255)
                ], startPoint: .leading, endPoint: .trailing))
                .frame(height: 3)
                .accessibilityHidden(true)
        }
    }
}

private extension View {
    func fundhubCard() -> some View {
        self.frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
    }
}
