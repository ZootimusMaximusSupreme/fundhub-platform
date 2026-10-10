import Foundation

// The shapes the Fundhub server sends. Contract: docs/specs/marketing-machine-api.md
// §4 (the Script object S) and §7.1 (GET marketing/shoot, POST marketing/shoot/mark).
// Decoding is lenient on purpose: an extra key never breaks the app, and a
// missing optional key is nil (unknown), never a made-up default.

struct ScriptPart: Codable, Equatable, Hashable {
    var kind: String
    var text: String
}

struct Script: Codable, Equatable, Identifiable {
    var id: String
    var rootScriptId: String
    var version: Int
    var status: String?
    var adId: String?
    var title: String?
    var body: String
    var parts: [ScriptPart]?
    var scriptFormat: String?
    var style: String?
    var filmOrder: Int?
    var needsRetake: Bool?
    var updatedAt: String?

    // Shoot plan fields (only on GET marketing/shoot).
    var angleName: String?
    var offerWord: String?
    var takeNo: Int?
    var takeFileName: String?
    var takeNameProblem: String?
    var lastTakeFileName: String?
    var takes: Int?
    var gotIt: Bool?
    var firstLineOnly: Bool?
    var teleprompterText: String?
    var words: Int?
    var readSeconds: Double?

    enum CodingKeys: String, CodingKey {
        case id
        case rootScriptId = "root_script_id"
        case version, status
        case adId = "ad_id"
        case title, body, parts
        case scriptFormat = "script_format"
        case style
        case filmOrder = "film_order"
        case needsRetake = "needs_retake"
        case updatedAt = "updated_at"
        case angleName = "angle_name"
        case offerWord = "offer_word"
        case takeNo = "take_no"
        case takeFileName = "take_file_name"
        case takeNameProblem = "take_name_problem"
        case lastTakeFileName = "last_take_file_name"
        case takes
        case gotIt = "got_it"
        case firstLineOnly = "first_line_only"
        case teleprompterText = "teleprompter_text"
        case words
        case readSeconds = "read_seconds"
    }

    init(id: String, rootScriptId: String, version: Int, status: String? = nil, adId: String? = nil,
         title: String? = nil, body: String, parts: [ScriptPart]? = nil, style: String? = nil) {
        self.id = id
        self.rootScriptId = rootScriptId
        self.version = version
        self.status = status
        self.adId = adId
        self.title = title
        self.body = body
        self.parts = parts
        self.style = style
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        rootScriptId = (try? c.decode(String.self, forKey: .rootScriptId)) ?? id
        version = Lenient.int(c, .version) ?? 1
        status = try? c.decodeIfPresent(String.self, forKey: .status)
        adId = Lenient.string(c, .adId)
        title = try? c.decodeIfPresent(String.self, forKey: .title)
        body = (try? c.decodeIfPresent(String.self, forKey: .body)) ?? ""
        parts = try? c.decodeIfPresent([ScriptPart].self, forKey: .parts)
        scriptFormat = try? c.decodeIfPresent(String.self, forKey: .scriptFormat)
        style = try? c.decodeIfPresent(String.self, forKey: .style)
        filmOrder = Lenient.int(c, .filmOrder)
        needsRetake = try? c.decodeIfPresent(Bool.self, forKey: .needsRetake)
        updatedAt = try? c.decodeIfPresent(String.self, forKey: .updatedAt)
        angleName = try? c.decodeIfPresent(String.self, forKey: .angleName)
        offerWord = try? c.decodeIfPresent(String.self, forKey: .offerWord)
        takeNo = Lenient.int(c, .takeNo)
        takeFileName = try? c.decodeIfPresent(String.self, forKey: .takeFileName)
        takeNameProblem = try? c.decodeIfPresent(String.self, forKey: .takeNameProblem)
        lastTakeFileName = try? c.decodeIfPresent(String.self, forKey: .lastTakeFileName)
        takes = Lenient.int(c, .takes)
        gotIt = try? c.decodeIfPresent(Bool.self, forKey: .gotIt)
        firstLineOnly = try? c.decodeIfPresent(Bool.self, forKey: .firstLineOnly)
        teleprompterText = try? c.decodeIfPresent(String.self, forKey: .teleprompterText)
        words = Lenient.int(c, .words)
        readSeconds = try? c.decodeIfPresent(Double.self, forKey: .readSeconds)
    }

    /// "Ad 91 · Lenders read two files" — the name Chris sees in the list.
    var displayName: String {
        let angle = angleName ?? title ?? "No name yet"
        if let ad = adId, !ad.isEmpty { return "Ad \(ad) · \(angle)" }
        return angle
    }
}

/// Small helpers so a number sent as a string (or the other way round) still reads.
enum Lenient {
    static func int<K: CodingKey>(_ c: KeyedDecodingContainer<K>, _ k: K) -> Int? {
        if let v = try? c.decodeIfPresent(Int.self, forKey: k) { return v }
        if let s = try? c.decodeIfPresent(String.self, forKey: k) { return Int(s) }
        if let d = try? c.decodeIfPresent(Double.self, forKey: k) { return Int(d) }
        return nil
    }
    static func string<K: CodingKey>(_ c: KeyedDecodingContainer<K>, _ k: K) -> String? {
        if let s = try? c.decodeIfPresent(String.self, forKey: k) { return s }
        if let i = try? c.decodeIfPresent(Int.self, forKey: k) { return String(i) }
        return nil
    }
}

struct Shoot: Codable, Equatable {
    var id: String
    var shootDate: String?
    var status: String?
    var scripts: [Script]

    enum CodingKeys: String, CodingKey {
        case id
        case shootDate = "shoot_date"
        case status, scripts
    }

    init(id: String, shootDate: String?, status: String?, scripts: [Script]) {
        self.id = id
        self.shootDate = shootDate
        self.status = status
        self.scripts = scripts
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        shootDate = try? c.decodeIfPresent(String.self, forKey: .shootDate)
        status = try? c.decodeIfPresent(String.self, forKey: .status)
        scripts = (try? c.decodeIfPresent([Script].self, forKey: .scripts)) ?? []
    }
}

/// GET marketing/shoot
struct ShootAnswer: Codable, Equatable {
    var shoot: Shoot?
    var planCandidates: [Script]
    var wpm: Int?
    var asOf: String?

    enum CodingKeys: String, CodingKey {
        case shoot
        case planCandidates = "plan_candidates"
        case wpm
        case asOf = "as_of"
    }

    init(shoot: Shoot?, planCandidates: [Script], wpm: Int? = nil, asOf: String? = nil) {
        self.shoot = shoot
        self.planCandidates = planCandidates
        self.wpm = wpm
        self.asOf = asOf
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        shoot = try? c.decodeIfPresent(Shoot.self, forKey: .shoot)
        planCandidates = (try? c.decodeIfPresent([Script].self, forKey: .planCandidates)) ?? []
        wpm = Lenient.int(c, .wpm)
        asOf = try? c.decodeIfPresent(String.self, forKey: .asOf)
    }

    /// What to film, in film order: the open shoot's scripts, or — when no shoot
    /// is planned — every approved script the server lists for the next shoot.
    var filmList: [Script] {
        if let s = shoot, !s.scripts.isEmpty { return s.scripts }
        return planCandidates
    }
}

/// POST marketing/scripts/edit -> {script, warnings}
struct EditAnswer: Decodable {
    struct Warning: Decodable, Equatable { var rule: String?; var message: String? }
    var script: Script
    var warnings: [Warning]?
}

/// GET marketing/script?id= -> {script, versions}
struct ScriptAnswer: Decodable {
    var script: Script?
    var versions: [Script]?

    /// The live version: the one not replaced (spec: newest first).
    var live: Script? {
        if let v = versions, let hit = v.first(where: { $0.status != "superseded" }) { return hit }
        return script ?? versions?.first
    }
}

/// Every error the server sends: {error, message, field?, current?}
struct ErrorAnswer: Decodable {
    struct Current: Decodable { var version: Int?; var body: String?; var parts: [ScriptPart]? }
    var error: String?
    var message: String?
    var field: String?
    var current: Current?
}

/// POST auth/login -> {ok, token, expiresAt, principal, staff}
struct LoginAnswer: Decodable {
    struct Staff: Decodable { var id: String?; var role: String?; var email: String?; var name: String? }
    var ok: Bool?
    var token: String?
    var expiresAt: String?
    var principal: String?
    var staff: Staff?
    var error: String?
    var message: String?
}
