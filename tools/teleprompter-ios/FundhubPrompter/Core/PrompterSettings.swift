import Foundation

/// Every setting is kept on this device only (an iPad in the rig and the
/// iPhone each keep their own), in UserDefaults.
struct PrompterSettings: Codable, Equatable {
    // Words
    var wpm: Int = PromptClock.defaultWPM
    var fontSize: Double = 44
    /// How wide the words run, as a share of the screen (0.4 ... 1.0).
    var lineWidth: Double = 0.9
    var pauseSeconds: Double = 0.8
    var countdown: Bool = true
    /// Beam-splitter glass: flip left-right.
    var mirror: Bool = false
    /// Some rigs also need up-down.
    var flipVertical: Bool = false

    // Camera
    var recordOnThisDevice: Bool = true
    var quality: VideoQuality = .uhd4K
    var fps: Int = 30
    var codec: VideoCodecChoice = .h264
    /// Record the picture mirrored, like the preview (owner default).
    var recordMirrored: Bool = true
    var stabilization: Steady = .standard
    var lockExposure: Bool = false
    /// Seconds the small camera box stays before it fades to dark glass.
    var previewSeconds: Double = 5

    // Remote
    var learnedKeys: [String: [String]] = [:]

    // Server
    var serverAddress: String = "https://fundhub.ai"

    static let fontRange: ClosedRange<Double> = 20...120
    static let lineWidthRange: ClosedRange<Double> = 0.4...1.0

    enum VideoQuality: String, Codable, CaseIterable, Identifiable {
        case uhd4K = "4k"
        case hd1080 = "1080p"
        var id: String { rawValue }
        var label: String {
            switch self {
            case .uhd4K: return "4K — VSLs, testimonials, portal videos"
            case .hd1080: return "1080p — ads"
            }
        }
        var short: String { self == .uhd4K ? "4K" : "1080p" }
        var width: Int { self == .uhd4K ? 3840 : 1920 }
        var height: Int { self == .uhd4K ? 2160 : 1080 }
    }

    enum VideoCodecChoice: String, Codable, CaseIterable, Identifiable {
        case h264
        case hevc
        var id: String { rawValue }
        var label: String {
            switch self {
            case .h264: return "H.264 — Meta likes this best"
            case .hevc: return "HEVC — smaller files"
            }
        }
    }

    enum Steady: String, Codable, CaseIterable, Identifiable {
        case off, standard, cinematic
        var id: String { rawValue }
        var label: String {
            switch self {
            case .off: return "Off"
            case .standard: return "Normal"
            case .cinematic: return "Extra smooth"
            }
        }
    }

    init() {}

    /// Lenient: a setting added later never wipes the ones already saved.
    init(from decoder: Decoder) throws {
        let d = PrompterSettings()
        let c = try decoder.container(keyedBy: CodingKeys.self)
        wpm = (try? c.decode(Int.self, forKey: .wpm)) ?? d.wpm
        fontSize = (try? c.decode(Double.self, forKey: .fontSize)) ?? d.fontSize
        lineWidth = (try? c.decode(Double.self, forKey: .lineWidth)) ?? d.lineWidth
        pauseSeconds = (try? c.decode(Double.self, forKey: .pauseSeconds)) ?? d.pauseSeconds
        countdown = (try? c.decode(Bool.self, forKey: .countdown)) ?? d.countdown
        mirror = (try? c.decode(Bool.self, forKey: .mirror)) ?? d.mirror
        flipVertical = (try? c.decode(Bool.self, forKey: .flipVertical)) ?? d.flipVertical
        recordOnThisDevice = (try? c.decode(Bool.self, forKey: .recordOnThisDevice)) ?? d.recordOnThisDevice
        quality = (try? c.decode(VideoQuality.self, forKey: .quality)) ?? d.quality
        fps = (try? c.decode(Int.self, forKey: .fps)) ?? d.fps
        codec = (try? c.decode(VideoCodecChoice.self, forKey: .codec)) ?? d.codec
        recordMirrored = (try? c.decode(Bool.self, forKey: .recordMirrored)) ?? d.recordMirrored
        stabilization = (try? c.decode(Steady.self, forKey: .stabilization)) ?? d.stabilization
        lockExposure = (try? c.decode(Bool.self, forKey: .lockExposure)) ?? d.lockExposure
        previewSeconds = (try? c.decode(Double.self, forKey: .previewSeconds)) ?? d.previewSeconds
        learnedKeys = (try? c.decode([String: [String]].self, forKey: .learnedKeys)) ?? d.learnedKeys
        serverAddress = (try? c.decode(String.self, forKey: .serverAddress)) ?? d.serverAddress
    }

    private static let key = "fundhub.prompter.settings"

    /// A tablet gets bigger words by default (read from the camera distance).
    static func load(defaults: UserDefaults = .standard, bigScreen: Bool) -> PrompterSettings {
        if let data = defaults.data(forKey: key), let s = try? JSONDecoder().decode(PrompterSettings.self, from: data) {
            return s
        }
        var s = PrompterSettings()
        if bigScreen { s.fontSize = 64 }
        return s
    }

    func save(defaults: UserDefaults = .standard) {
        if let data = try? JSONEncoder().encode(self) { defaults.set(data, forKey: Self.key) }
    }
}
