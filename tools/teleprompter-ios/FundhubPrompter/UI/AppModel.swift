import Foundation
import Network
import SwiftUI
import UIKit

/// The app's brain: sign-in, the film list, the waiting list, settings.
@MainActor
final class AppModel: ObservableObject {
    @Published var signIn: SignIn?
    @Published var settings: PrompterSettings {
        didSet {
            if settings != oldValue {
                settings.save()
                if let url = URL(string: settings.serverAddress) { api.baseURL = url }
            }
        }
    }
    @Published private(set) var answer: ShootAnswer?
    @Published private(set) var scripts: [Script] = []
    @Published private(set) var loadNote: String?
    @Published private(set) var loading = false
    @Published private(set) var lastLoaded: Date?
    @Published var warnings: [String] = []

    let api: APIClient
    let transport: Transport
    let queue: SaveQueue
    let isDemo: Bool

    private var poll: Timer?
    private let monitor = NWPathMonitor()
    private let cacheURL: URL

    init() {
        let args = ProcessInfo.processInfo.arguments
        isDemo = args.contains("-FundhubDemo")
        let big = UIDevice.current.userInterfaceIdiom == .pad
        var s = PrompterSettings.load(bigScreen: big)
        if isDemo && args.contains("-FundhubDemoMirror") { s.mirror = true }
        settings = s
        let saved = isDemo ? SignIn(token: "demo", expiresAt: nil, name: "Sample", email: nil, role: "owner") : Keychain.load()
        signIn = saved
        api = APIClient(baseURL: URL(string: s.serverAddress) ?? URL(string: "https://fundhub.ai")!, token: saved?.token)
        transport = isDemo ? DemoTransport() : api
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        cacheURL = dir.appendingPathComponent(isDemo ? "demo-shoot.json" : "shoot-cache.json")
        queue = SaveQueue(transport: transport, fileURL: isDemo ? nil : SaveQueue.defaultFileURL())
        queue.onSaved = { [weak self] root, script, warnings in
            self?.saved(root: root, script: script, warnings: warnings)
        }
        if let data = try? Data(contentsOf: cacheURL), let a = try? JSONDecoder().decode(ShootAnswer.self, from: data) {
            take(a)
        }
        monitor.pathUpdateHandler = { [weak self] path in
            guard path.status == .satisfied else { return }
            Task { @MainActor in
                self?.queue.networkCameBack()
                await self?.queue.flush()
            }
        }
        monitor.start(queue: DispatchQueue(label: "ai.fundhub.prompter.net"))
    }

    // MARK: - Sign in

    func login(email: String, password: String) async -> String? {
        let r = await api.send("POST", "auth/login", body: ["email": email.trimmed, "password": password])
        if r.isOffline { return "No connection. Check Wi-Fi and try again." }
        let a = r.decode(LoginAnswer.self)
        guard r.ok, let token = a?.token else {
            switch r.status {
            case 400: return "Type your email and password."
            case 401: return "That email or password is not right."
            case 403: return a?.message ?? "This login is turned off."
            case 429: return "Too many tries. Wait a few minutes, then try again."
            default: return a?.message ?? "Sign-in did not work (code \(r.status))."
            }
        }
        guard (a?.principal ?? "staff") == "staff" else {
            return "Use your Fundhub staff login. This is not a staff login."
        }
        let s = SignIn(token: token, expiresAt: a?.expiresAt, name: a?.staff?.name, email: a?.staff?.email, role: a?.staff?.role)
        _ = Keychain.save(s)
        api.token = token
        signIn = s
        queue.signedIn()
        await refresh()
        await queue.flush()
        return nil
    }

    func signOut() async {
        if !isDemo { _ = await api.send("POST", "auth/logout", body: [:]) }
        Keychain.clear()
        api.token = nil
        signIn = nil
    }

    // MARK: - The film list

    func startPolling() {
        poll?.invalidate()
        // Spec §8.1: poll every 5 s while the screen is showing.
        poll = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            Task { @MainActor in
                await self?.refresh()
                await self?.queue.flush()
            }
        }
        Task { await refresh(); await queue.flush() }
    }

    func stopPolling() {
        poll?.invalidate()
        poll = nil
    }

    func refresh() async {
        guard signIn != nil, !loading else { return }
        loading = true
        defer { loading = false }
        let wpm = PromptClock.clampWPM(settings.wpm)
        let r = await transport.send("GET", "marketing/shoot?wpm=\(wpm)", body: nil)
        switch r.status {
        case 200:
            guard let a = r.decode(ShootAnswer.self) else {
                loadNote = "The shoot came back in a shape the app could not read."
                return
            }
            if let d = r.data { try? d.write(to: cacheURL, options: .atomic) }
            loadNote = nil
            lastLoaded = Date()
            take(a)
        case 401:
            loadNote = "Your sign-in ran out. Sign in again. Edits on this phone are kept."
            Keychain.clear()
            api.token = nil
            signIn = nil
        case 403:
            loadNote = "The teleprompter is for the owner and admins."
        case 0:
            loadNote = answer == nil ? "No connection, and no shoot is saved on this phone yet." : "No connection. Showing the shoot saved on this phone."
        default:
            loadNote = "The shoot did not load (code \(r.status)). Showing the copy on this phone."
        }
    }

    private func take(_ a: ShootAnswer) {
        answer = a
        // Take presses still waiting: keep the take numbers this phone already shows.
        let waiting = Set(queue.marks.map { $0.rootScriptId })
        scripts = a.filmList.map { server in
            var s = queue.overlay(server)
            if waiting.contains(s.rootScriptId), let mine = scripts.first(where: { $0.rootScriptId == s.rootScriptId }) {
                s.takes = mine.takes
                s.takeNo = mine.takeNo
                s.takeFileName = mine.takeFileName
                s.lastTakeFileName = mine.lastTakeFileName
                s.gotIt = mine.gotIt
            }
            return s
        }
    }

    func script(root: String) -> Script? { scripts.first { $0.rootScriptId == root } }

    var shootId: String? { answer?.shoot?.id }

    var listTitle: String {
        if let s = answer?.shoot { return s.shootDate.map { "Shoot · \($0)" } ?? "Shoot" }
        return "Approved scripts"
    }

    // MARK: - Edits (one store: POST marketing/scripts/edit)

    /// Chris changed paragraph `index` of a script. Shows at once; saves through the queue.
    func edit(root: String, index: Int, newText: String) {
        guard let i = scripts.firstIndex(where: { $0.rootScriptId == root }) else { return }
        let shown = scripts[i]
        let paras = ScriptText.paragraphs(shown)
        guard let res = ScriptText.applyEdit(shown, paragraphs: paras, index: index, newText: newText,
                                              bullets: ScriptText.isBullets(shown)), res.changed else { return }
        // The base is the version the words were changed on: `shown` carries the
        // server's id and version (saved() moves them on after every save). When
        // an edit is already waiting, the queue keeps that item's own base.
        queue.edit(root: root, base: shown, body: res.body, parts: res.parts)
        scripts[i] = ScriptText.withWords(shown, body: res.body, parts: res.parts)
        Task { await queue.flush() }
    }

    private func saved(root: String, script: Script, warnings: [EditAnswer.Warning]) {
        guard let i = scripts.firstIndex(where: { $0.rootScriptId == root }) else { return }
        var s = scripts[i]
        s.id = script.id
        s.version = script.version
        s.body = queue.items[root]?.body ?? script.body
        s.parts = queue.items[root]?.parts ?? script.parts
        s.teleprompterText = nil
        s.teleprompterText = ScriptText.rolledText(s)
        scripts[i] = s
        let notes = warnings.compactMap { $0.message }
        if !notes.isEmpty { self.warnings = notes }
    }

    func keepMine(_ root: String) async { await queue.keepMine(root) }

    func keepTheirs(_ root: String) {
        let theirs = queue.keepTheirs(root)
        guard let i = scripts.firstIndex(where: { $0.rootScriptId == root }) else { return }
        if let t = theirs {
            scripts[i] = ScriptText.withWords(scripts[i], body: t.body, parts: t.parts)
            scripts[i].id = t.id
            scripts[i].version = t.version
        } else if let server = answer?.filmList.first(where: { $0.rootScriptId == root }) {
            scripts[i] = server
        }
    }

    // MARK: - Got it / Another take

    /// Counts the take just rolled. The next take name moves to the next number.
    func mark(root: String, gotIt: Bool) {
        guard let shoot = shootId, let i = scripts.firstIndex(where: { $0.rootScriptId == root }) else { return }
        queue.mark(shootId: shoot, root: root, mark: gotIt ? "got_it" : "another_take")
        scripts[i] = ScriptText.afterMark(scripts[i], gotIt: gotIt)
        Task { await queue.flush() }
    }

    /// The next script in film order with no Got it, else simply the next one.
    func nextRoot(after root: String) -> String? {
        guard let i = scripts.firstIndex(where: { $0.rootScriptId == root }) else { return nil }
        for k in 1..<max(1, scripts.count) {
            let j = (i + k) % scripts.count
            if scripts[j].gotIt != true { return scripts[j].rootScriptId }
        }
        return i + 1 < scripts.count ? scripts[i + 1].rootScriptId : nil
    }
}
