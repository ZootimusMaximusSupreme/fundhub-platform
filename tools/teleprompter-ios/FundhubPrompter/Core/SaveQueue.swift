import Foundation

/// The waiting list on this phone. ONE STORE: every change to the words goes
/// through the shipped route POST marketing/scripts/edit — the same route the
/// dashboard uses — so the server keeps a new version (the old one too), the
/// voice pairs and the repo copy. Nothing here is a second copy of a script;
/// it only holds what has not reached the server yet.
///
/// - One item per script (root_script_id), holding the newest words and the
///   version they were written on.
/// - A save cut off mid-way is sent again EXACTLY as it was, with the SAME
///   request_id, so the server answers it once (spec §2: a repeat request_id
///   returns the saved answer and nothing runs twice).
/// - 409 stale: the server has newer words. Both texts are kept and Chris picks.
/// - 401: signed out. The waiting list is kept and sent after he signs in.
/// - Got it / Another take presses wait here too, in order, each with its own request_id.
@MainActor
final class SaveQueue: ObservableObject {

    struct Sent: Codable, Equatable {
        var requestId: String
        var body: String
        var parts: [ScriptPart]?
        var baseId: String
        var baseVersion: Int
        var edits: Int
    }

    struct Conflict: Codable, Equatable {
        /// The live version on the server (has the id a new save needs), when it could be read.
        var theirs: Script?
        var theirBody: String
        var theirVersion: Int?
    }

    struct PendingEdit: Codable, Equatable {
        var root: String
        var title: String?
        var baseId: String
        var baseVersion: Int
        var body: String
        var parts: [ScriptPart]?
        /// The words the server already has.
        var savedBody: String
        var savedParts: [ScriptPart]?
        /// Edits made and not yet saved ("2 edits waiting").
        var edits: Int
        var sent: Sent?
        var conflict: Conflict?
        var failed: String?
        var at: Date
    }

    struct PendingMark: Codable, Equatable {
        var requestId: String
        var shootId: String
        var rootScriptId: String
        var mark: String
    }

    struct Stored: Codable {
        var edits: [String: PendingEdit] = [:]
        var marks: [PendingMark] = []
        var savedAt: Date?
    }

    enum Net: Equatable { case ok, offline, signedOut }

    struct Pulse: Equatable {
        enum Tone: Equatable { case good, busy, warn, bad }
        var text: String
        var tone: Tone
    }

    @Published private(set) var items: [String: PendingEdit] = [:]
    @Published private(set) var marks: [PendingMark] = []
    @Published private(set) var savedAt: Date?
    @Published private(set) var net: Net = .ok
    @Published private(set) var inFlight: Set<String> = []
    @Published private(set) var lastMarkError: String?

    let transport: Transport
    let fileURL: URL?
    var now: () -> Date = { Date() }
    var timeZone: TimeZone = .current

    /// A save landed: the new live version (new id, next version).
    var onSaved: ((String, Script, [EditAnswer.Warning]) -> Void)?
    /// A Got it / Another take press landed: the shoot's marks as the server counts them.
    var onMarked: ((PendingMark) -> Void)?

    private var flushingMarks = false

    init(transport: Transport, fileURL: URL?) {
        self.transport = transport
        self.fileURL = fileURL
        if let url = fileURL, let data = try? Data(contentsOf: url),
           let s = try? JSONDecoder().decode(Stored.self, from: data) {
            items = s.edits
            marks = s.marks
            savedAt = s.savedAt
        }
    }

    static func defaultFileURL() -> URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("waiting-list.json")
    }

    private func persist() {
        guard let url = fileURL else { return }
        let s = Stored(edits: items, marks: marks, savedAt: savedAt)
        if let data = try? JSONEncoder().encode(s) { try? data.write(to: url, options: .atomic) }
    }

    // MARK: - Edits

    /// Chris changed the words. `base` is the version shown when he changed them.
    func edit(root: String, base: Script, body: String, parts: [ScriptPart]?) {
        var it = items[root] ?? PendingEdit(root: root, title: base.angleName ?? base.title, baseId: base.id,
                                            baseVersion: base.version, body: base.body, parts: base.parts,
                                            savedBody: base.body, savedParts: base.parts, edits: 0,
                                            sent: nil, conflict: nil, failed: nil, at: now())
        it.body = body
        it.parts = parts
        it.edits += 1
        it.failed = nil
        it.at = now()
        items[root] = it
        persist()
    }

    /// The words to show for a script: the waiting words win over what the server sent.
    func overlay(_ s: Script) -> Script {
        guard let it = items[s.rootScriptId] else { return s }
        return ScriptText.withWords(s, body: it.body, parts: it.parts)
    }

    func flush() async {
        for root in Array(items.keys) { await sendOne(root) }
        await flushMarks()
    }

    private func sendOne(_ root: String) async {
        guard var it = items[root], !inFlight.contains(root), it.conflict == nil, it.failed == nil else { return }
        if it.sent == nil {
            if it.body == it.savedBody && (it.parts == nil || it.parts == it.savedParts) {
                items[root] = nil
                persist()
                return
            }
            it.sent = Sent(requestId: RequestID.make(), body: it.body, parts: it.parts,
                           baseId: it.baseId, baseVersion: it.baseVersion, edits: it.edits)
            items[root] = it
            persist()
        }
        guard let sent = it.sent else { return }
        var body: [String: Any] = ["request_id": sent.requestId, "id": sent.baseId,
                                   "version": sent.baseVersion, "body": sent.body]
        if let p = sent.parts { body["parts"] = p.map { $0.json } }
        inFlight.insert(root)
        let r = await transport.send("POST", "marketing/scripts/edit", body: body)
        inFlight.remove(root)
        guard var cur = items[root] else { return }

        switch r.status {
        case 200..<300:
            net = .ok
            guard let answer = r.decode(EditAnswer.self) else {
                cur.failed = "The server saved it but sent back something the app could not read. Pull to refresh."
                cur.sent = nil
                items[root] = cur
                persist()
                return
            }
            savedAt = now()
            cur.baseId = answer.script.id
            cur.baseVersion = answer.script.version
            cur.savedBody = sent.body
            cur.savedParts = answer.script.parts
            cur.edits = max(0, cur.edits - sent.edits)
            cur.sent = nil
            if cur.body == cur.savedBody && (cur.parts == nil || cur.parts == answer.script.parts) {
                items[root] = nil
            } else {
                items[root] = cur
            }
            persist()
            onSaved?(root, answer.script, answer.warnings ?? [])
            if items[root] != nil { await sendOne(root) }
        case 0, 500...:
            if r.status == 0 { net = .offline }
            items[root] = cur
            persist()
        case 401:
            net = .signedOut
            items[root] = cur
            persist()
        case 409:
            net = .ok
            let err = r.decode(ErrorAnswer.self)
            let live = await fetchLive(sent.baseId)
            cur.conflict = Conflict(theirs: live,
                                    theirBody: live?.body ?? err?.current?.body ?? "",
                                    theirVersion: live?.version ?? err?.current?.version)
            cur.sent = nil
            items[root] = cur
            persist()
        case 403:
            net = .ok
            cur.failed = "This login cannot change scripts. Only the owner and admins can."
            cur.sent = nil
            items[root] = cur
            persist()
        default:
            net = .ok
            cur.failed = r.message ?? "The server did not save it (code \(r.status))."
            cur.sent = nil
            items[root] = cur
            persist()
        }
    }

    private func fetchLive(_ id: String) async -> Script? {
        let q = id.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? id
        let r = await transport.send("GET", "marketing/script?id=" + q, body: nil)
        guard r.ok else { return nil }
        return r.decode(ScriptAnswer.self)?.live
    }

    /// Two versions: keep Chris's words. They are saved on top of the newer version.
    func keepMine(_ root: String) async {
        guard var it = items[root], let c = it.conflict else { return }
        var live = c.theirs
        if live == nil { live = await fetchLive(it.baseId) }
        guard let base = live else { return } // still offline: keep both, ask again later
        it.baseId = base.id
        it.baseVersion = base.version
        it.savedBody = base.body
        it.savedParts = base.parts
        it.conflict = nil
        it.edits = max(1, it.edits)
        items[root] = it
        persist()
        await sendOne(root)
    }

    /// Two versions: keep the server's words. Chris's waiting words are dropped.
    @discardableResult
    func keepTheirs(_ root: String) -> Script? {
        let theirs = items[root]?.conflict?.theirs
        items[root] = nil
        persist()
        return theirs
    }

    /// A refused save: try again.
    func retry(_ root: String) async {
        guard var it = items[root] else { return }
        it.failed = nil
        items[root] = it
        persist()
        await sendOne(root)
    }

    /// A refused save: throw the waiting words away.
    func throwAway(_ root: String) {
        items[root] = nil
        persist()
    }

    // MARK: - Got it / Another take

    func mark(shootId: String, root: String, mark: String) {
        marks.append(PendingMark(requestId: RequestID.make(), shootId: shootId, rootScriptId: root, mark: mark))
        persist()
    }

    private func flushMarks() async {
        guard !flushingMarks else { return }
        flushingMarks = true
        defer { flushingMarks = false }
        while let m = marks.first {
            let r = await transport.send("POST", "marketing/shoot/mark", body: [
                "request_id": m.requestId, "shoot_id": m.shootId, "root_script_id": m.rootScriptId, "mark": m.mark
            ])
            switch r.status {
            case 200..<300:
                net = .ok
                marks.removeFirst()
                persist()
                onMarked?(m)
            case 0, 500...:
                if r.status == 0 { net = .offline }
                return
            case 401:
                net = .signedOut
                return
            default:
                lastMarkError = r.message ?? "A take mark was refused (code \(r.status))."
                marks.removeFirst()
                persist()
            }
        }
    }

    // MARK: - The pulse

    var waitingEdits: Int {
        items.values.filter { $0.conflict == nil && $0.failed == nil }.reduce(0) { $0 + max($1.edits, $1.sent == nil ? 0 : 1) }
    }

    func clock(_ d: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = timeZone
        f.dateFormat = "h:mm"
        return f.string(from: d)
    }

    /// One line that never hides: "Saved 12:04", "Saving…", "Offline — 2 edits waiting".
    var pulse: Pulse {
        let edits = waitingEdits
        let word = edits == 1 ? "edit" : "edits"
        if items.values.contains(where: { $0.conflict != nil }) {
            return Pulse(text: "Two versions — pick one", tone: .bad)
        }
        if items.values.contains(where: { $0.failed != nil }) {
            return Pulse(text: "Not saved — tap to see why", tone: .bad)
        }
        let markWord = marks.count == 1 ? "take mark" : "take marks"
        if net == .offline && (edits > 0 || !marks.isEmpty) {
            if edits > 0 { return Pulse(text: "Offline — \(edits) \(word) waiting", tone: .warn) }
            return Pulse(text: "Offline — \(marks.count) \(markWord) waiting", tone: .warn)
        }
        if net == .signedOut && (edits > 0 || !marks.isEmpty) {
            let n = edits > 0 ? "\(edits) \(word)" : "\(marks.count) \(markWord)"
            return Pulse(text: "Sign in again — \(n) waiting", tone: .warn)
        }
        if !inFlight.isEmpty { return Pulse(text: "Saving…", tone: .busy) }
        if edits > 0 { return Pulse(text: "\(edits) \(word) waiting", tone: .busy) }
        if let at = savedAt { return Pulse(text: "Saved \(clock(at))", tone: .good) }
        return Pulse(text: "No changes yet", tone: .good)
    }

    /// Mark the connection as back (the phone's network came back).
    func networkCameBack() {
        if net == .offline { net = .ok }
    }

    /// After a new sign-in.
    func signedIn() {
        if net == .signedOut { net = .ok }
    }
}
