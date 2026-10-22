import Foundation

/// Sends each finished take, byte for byte, to its offer's Google Drive folder
/// through POST/PUT /api/marketing/shoot/take (api/marketing/shoot/take.mjs).
/// No login: that route takes an open upload, same as the website teleprompter.
///
/// Every take is saved in the app's Takes folder BEFORE the first request, and
/// the waiting list is written to disk, so a closed app or a dropped network
/// picks up where it stopped. One upload at a time, oldest first. The phone's
/// copy is removed only after Drive has every byte AND Photos holds its own copy.
@MainActor
final class TakeUploader: ObservableObject {

    struct Item: Codable, Equatable, Identifiable {
        var id: String
        /// The file in the Takes folder (its last path part).
        var file: String
        /// The take name from the server (marketing/ads/NAMING.md).
        var name: String
        var offerKey: String?
        var contentType: String
        var bytes: Int
        var inPhotos: Bool
        /// Measured camera settings, sent as the Drive file's description.
        var diagnostics: [String: AnyCodable]
        var token: String?
        var chunk: Int?
        var sent: Int = 0
        var error: String?
    }

    @Published private(set) var items: [Item] = []
    /// One line for the screen: "Uploading Ad 105 Take 1 · 42%", "All takes in Drive".
    @Published private(set) var status: String = ""

    private let baseURL: () -> URL
    private let session: URLSession
    private let listURL: URL
    let folder: URL
    private var running = false

    init(baseURL: @escaping () -> URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        folder = docs.appendingPathComponent("Takes", isDirectory: true)
        listURL = support.appendingPathComponent("take-uploads.json")
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: support, withIntermediateDirectories: true)
        if let d = try? Data(contentsOf: listURL), let saved = try? JSONDecoder().decode([Item].self, from: d) {
            items = saved.filter { FileManager.default.fileExists(atPath: folder.appendingPathComponent($0.file).path) }
        }
        paint()
    }

    /// Keep this take on the phone and put it on the list. `file` is moved into the Takes folder.
    func add(file: URL, name: String, offerKey: String?, inPhotos: Bool, diagnostics: [String: AnyCodable]) {
        let id = UUID().uuidString.lowercased()
        let ext = file.pathExtension.isEmpty ? "mp4" : file.pathExtension.lowercased()
        let dest = folder.appendingPathComponent("\(id).\(ext)")
        do {
            if file.standardizedFileURL != dest.standardizedFileURL {
                try FileManager.default.moveItem(at: file, to: dest)
            }
        } catch {
            status = "The take could not be kept for upload: \(error.localizedDescription)"
            return
        }
        let size = (try? FileManager.default.attributesOfItem(atPath: dest.path)[.size] as? NSNumber)?.intValue ?? 0
        var upName = name
        if ext == "mov", upName.lowercased().hasSuffix(".mp4") { upName = String(upName.dropLast(4)) + ".mov" }
        items.append(Item(id: id, file: dest.lastPathComponent, name: upName, offerKey: offerKey,
                          contentType: ext == "mov" ? "video/quicktime" : "video/mp4", bytes: size,
                          inPhotos: inPhotos, diagnostics: diagnostics))
        persist()
        paint()
        Task { await run() }
    }

    /// Send everything waiting, one at a time. Safe to call often.
    func run() async {
        guard !running else { return }
        running = true
        defer { running = false; paint() }
        while let i = items.firstIndex(where: { $0.error == nil }) {
            let ok = await upload(index: i)
            if !ok { break }
        }
    }

    /// Try the failed ones again (network back, app open again, a tap).
    func retry() async {
        for i in items.indices { items[i].error = nil }
        persist()
        await run()
    }

    // MARK: - One take

    private func upload(index: Int) async -> Bool {
        var it = items[index]
        let url = folder.appendingPathComponent(it.file)
        guard let handle = try? FileHandle(forReadingFrom: url) else {
            fail(it.id, "The take file is missing on this phone.")
            return false
        }
        defer { try? handle.close() }

        if it.token == nil {
            var body: [String: Any] = ["name": it.name, "bytes": it.bytes, "content_type": it.contentType]
            if let k = it.offerKey { body["offer_key"] = k }
            body["diagnostics"] = it.diagnostics.mapValues { $0.value }
            let r = await send("POST", body: body, headers: [:], data: nil)
            guard r.status == 200, let d = r.json, d["ok"] as? Bool == true, let token = d["token"] as? String else {
                fail(it.id, r.message ?? (r.status == 0 ? "No connection. The take waits on this phone." : "Drive did not start the save (code \(r.status))."))
                return false
            }
            it.token = token
            it.chunk = (d["chunk_bytes"] as? Int) ?? 2 * 1024 * 1024
            it.sent = 0
            update(it)
        }

        let chunk = max(256 * 1024, it.chunk ?? 2 * 1024 * 1024)
        while it.sent < it.bytes {
            let end = min(it.bytes, it.sent + chunk)
            do { try handle.seek(toOffset: UInt64(it.sent)) } catch {
                fail(it.id, "The take file could not be read.")
                return false
            }
            guard let piece = try? handle.read(upToCount: end - it.sent), piece.count == end - it.sent else {
                fail(it.id, "The take file could not be read.")
                return false
            }
            var r = HTTPJSON(status: 0, json: nil)
            for _ in 0..<3 {
                r = await send("PUT", body: nil, headers: [
                    "x-take-token": it.token ?? "",
                    "content-range": "bytes \(it.sent)-\(end - 1)/\(it.bytes)",
                    "content-type": "application/octet-stream"
                ], data: piece)
                if r.status == 200 { break }
                if r.status == 400 { break }
            }
            guard r.status == 200, let d = r.json, d["ok"] as? Bool == true else {
                if r.status == 400 {
                    // The save expired or lost its place: start this take over.
                    it.token = nil
                    it.sent = 0
                    update(it)
                }
                fail(it.id, r.message ?? (r.status == 0 ? "No connection. The take waits on this phone." : "Drive stopped the save (code \(r.status))."))
                return false
            }
            if d["done"] as? Bool == true { it.sent = it.bytes; break }
            let received = (d["received"] as? Int) ?? end
            it.sent = received > it.sent && received <= it.bytes ? received : end
            update(it)
        }
        finished(it)
        return true
    }

    private func finished(_ it: Item) {
        if it.inPhotos {
            try? FileManager.default.removeItem(at: folder.appendingPathComponent(it.file))
            items.removeAll { $0.id == it.id }
        } else {
            // Photos has no copy: keep the file in Files › Fundhub Prompter › Takes.
            items.removeAll { $0.id == it.id }
        }
        persist()
        lastDone = it.name
        paint()
    }

    private var lastDone: String?

    private func update(_ it: Item) {
        if let i = items.firstIndex(where: { $0.id == it.id }) { items[i] = it }
        persist()
        paint()
    }

    private func fail(_ id: String, _ why: String) {
        if let i = items.firstIndex(where: { $0.id == id }) { items[i].error = why }
        persist()
        paint()
    }

    private func paint() {
        if let now = items.first(where: { $0.error == nil }) {
            let pct = now.bytes > 0 ? Int(Double(now.sent) / Double(now.bytes) * 100) : 0
            let more = items.count > 1 ? " · \(items.count - 1) more waiting" : ""
            status = "Uploading \(now.name) · \(min(99, pct))%\(more)"
        } else if let bad = items.first(where: { $0.error != nil }) {
            status = "\(items.count) take\(items.count == 1 ? "" : "s") not in Drive yet. \(bad.error ?? "") Tap to try again."
        } else if let done = lastDone {
            status = "In Drive: \(done)"
        } else {
            status = ""
        }
    }

    private func persist() {
        if let d = try? JSONEncoder().encode(items) { try? d.write(to: listURL, options: .atomic) }
    }

    // MARK: - HTTP

    struct HTTPJSON {
        var status: Int
        var json: [String: Any]?
        var message: String? { json?["message"] as? String }
    }

    private func send(_ method: String, body: [String: Any]?, headers: [String: String], data: Data?) async -> HTTPJSON {
        var base = baseURL().absoluteString
        while base.hasSuffix("/") { base.removeLast() }
        guard let url = URL(string: base + "/api/marketing/shoot/take") else { return HTTPJSON(status: 0, json: nil) }
        var r = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 120)
        r.httpMethod = method
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        for (k, v) in headers { r.setValue(v, forHTTPHeaderField: k) }
        if let b = body {
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            r.httpBody = try? JSONSerialization.data(withJSONObject: b, options: [.sortedKeys])
        } else if let d = data {
            r.httpBody = d
        }
        do {
            let (d, resp) = try await session.data(for: r)
            let json = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any]
            return HTTPJSON(status: (resp as? HTTPURLResponse)?.statusCode ?? 0, json: json)
        } catch {
            return HTTPJSON(status: 0, json: nil)
        }
    }
}

/// A number, a word or a yes/no, kept on disk with the take.
struct AnyCodable: Codable, Equatable {
    let value: Any

    init(_ value: Any) { self.value = value }

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let b = try? c.decode(Bool.self) { value = b }
        else if let i = try? c.decode(Int.self) { value = i }
        else if let d = try? c.decode(Double.self) { value = d }
        else { value = (try? c.decode(String.self)) ?? "" }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch value {
        case let b as Bool: try c.encode(b)
        case let i as Int: try c.encode(i)
        case let d as Double: try c.encode(d)
        default: try c.encode(String(describing: value))
        }
    }

    static func == (a: AnyCodable, b: AnyCodable) -> Bool {
        String(describing: a.value) == String(describing: b.value)
    }
}
