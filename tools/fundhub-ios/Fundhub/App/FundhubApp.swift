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

// App-local random installation ID, not the user's account or Apple's device ID.
private enum NativeFirstOpen {
    private static let key = "ai.fundhub.app.installation.v1"

    static var installationId: String {
        if let value = UserDefaults.standard.string(forKey: key), UUID(uuidString: value) != nil {
            return value
        }
        let value = UUID().uuidString.lowercased()
        UserDefaults.standard.set(value, forKey: key)
        return value
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
                // After a verified client session, report first authenticated app open.
                // Never require notification permission or block login on telemetry.
                Task {
                    try? await FundhubAPI().reportClientAppOpened(
                        token: token, installationId: NativeFirstOpen.installationId
                    )
                }
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
    @State private var audience: Audience?
    @State private var showingLink = false
    @State private var sendingLink = false
    @State private var localMessage: String?
    @FocusState private var focusedField: Field?

    private enum Field { case email, password }
    private enum Audience { case team, client }

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

                if let audience {
                    VStack(alignment: .leading, spacing: 16) {
                        Button {
                            self.audience = nil
                            showingLink = false
                            password = ""
                            localMessage = nil
                            store.message = nil
                        } label: {
                            Label("Back", systemImage: "chevron.left")
                                .font(.subheadline.weight(.semibold))
                                .frame(minHeight: 44)
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(ink)
                        .accessibilityIdentifier("signInBack")

                        Text(audience == .team ? "Team sign-in" : "Client sign-in")
                            .font(.title3.weight(.bold))
                            .foregroundStyle(ink)

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

                    if audience == .client {
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
                    }
                } else {
                    VStack(spacing: 12) {
                        audienceButton("Team sign-in", filled: !store.hasSavedSession) { choose(.team) }
                            .accessibilityIdentifier("signInChooseTeam")
                        audienceButton("Client sign-in", filled: false) { choose(.client) }
                            .accessibilityIdentifier("signInChooseClient")
                    }
                    .padding(.top, store.hasSavedSession ? 24 : 32)
                }

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

    private func choose(_ choice: Audience) {
        localMessage = nil
        store.message = nil
        showingLink = false
        audience = choice
        focusedField = .email
    }

    private func audienceButton(_ title: String, filled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Text(title)
                Spacer()
                Image(systemName: "arrow.up.right").font(.subheadline.weight(.semibold))
            }
            .padding(.horizontal, 20)
            .frame(maxWidth: .infinity, minHeight: 56)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .font(.body.weight(.semibold))
        .foregroundStyle(filled ? .white : ink)
        .background(filled ? ink : .white, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(filled ? .clear : Color(.separator), lineWidth: 1))
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
    @State private var reloadId = UUID()
    @State private var showingNotifications = false

    var body: some View {
        Group {
            if let token = store.token, let identity = store.identity {
                // Signing in goes straight to the Fundhub workspace. No home page in between.
                WorkspaceWebView(
                    token: token,
                    principal: identity.principal,
                    identity: identity.staff,
                    path: FundhubRole.workspacePath(principal: identity.principal, role: identity.staff.role),
                    onWebSignOut: { Task { await store.signOut() } }
                )
                .id(reloadId)
                .safeAreaInset(edge: .top, spacing: 0) {
                    if identity.principal == "client" {
                        HStack {
                            Spacer()
                            Button {
                                showingNotifications = true
                            } label: {
                                Label("Notifications", systemImage: "bell")
                                    .font(.subheadline.weight(.semibold))
                                    .frame(minHeight: 44)
                            }
                            .accessibilityIdentifier("nativeNotificationSettings")
                        }
                        .padding(.horizontal, 16)
                        .background(Color(.systemBackground))
                    }
                }
                .sheet(isPresented: $showingNotifications) {
                    NavigationStack {
                        NativePushCard()
                            .padding()
                            .navigationTitle("Notifications")
                            .toolbar {
                                ToolbarItem(placement: .topBarTrailing) {
                                    Button("Done") { showingNotifications = false }
                                }
                            }
                    }
                    .presentationDetents([.medium])
                }
            } else {
                ProgressView("Connecting to Fundhub")
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
            reloadId = UUID()
        }
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
