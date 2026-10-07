import AVFoundation
import Photos
import UIKit

/// The front camera. Chris picks the size. Each size runs at the highest
/// frame rate that size really has: 4K is 3840×2160 (VSLs, thank-you videos,
/// testimonials) and 1080p is 1920×1080 (ads). A smaller picture is never
/// called the bigger name. H.264 or HEVC, a fixed frame rate, mirrored,
/// steady video, and an exposure lock. Each take is saved to Photos under
/// its take name (marketing/ads/NAMING.md). Sources in tools/teleprompter-ios/README.md.
final class CameraController: NSObject, ObservableObject {

    enum State: Equatable {
        case idle
        case noPermission(String)
        case unavailable(String)
        case ready
        case recording(started: Date)
        case saving
    }

    @Published private(set) var state: State = .idle
    /// What the camera is really set to, in plain words: "4K 3840×2160 · 60 fps · H.264".
    @Published private(set) var summary: String = ""
    /// When the camera could not give what Chris picked. Shown in red.
    @Published private(set) var shortfall: String?
    /// The last take saved, or what went wrong.
    @Published private(set) var lastSaved: String?
    @Published private(set) var lastError: String?

    let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "ai.fundhub.prompter.camera")
    private var device: AVCaptureDevice?
    private var videoInput: AVCaptureDeviceInput?
    private var audioInput: AVCaptureDeviceInput?
    private let movieOutput = AVCaptureMovieFileOutput()
    private var rotation: AVCaptureDevice.RotationCoordinator?
    private var settings = PrompterSettings()
    private var pendingName: String = "Take.mp4"
    private var configured = false

    /// Ask for camera and microphone, then set the camera up.
    func start(with s: PrompterSettings) {
        settings = s
        guard s.recordOnThisDevice else {
            state = .unavailable("Recording is off on this device. The camera behind the glass films.")
            return
        }
        Task { @MainActor in
            let cam = await AVCaptureDevice.requestAccess(for: .video)
            let mic = await AVCaptureDevice.requestAccess(for: .audio)
            guard cam else {
                self.state = .noPermission("The camera is off for Fundhub Prompter. Turn it on in Settings › Fundhub Prompter.")
                return
            }
            if !mic { self.lastError = "The microphone is off. Takes will have no sound." }
            self.queue.async { self.configure(withAudio: mic) }
        }
    }

    func stop() {
        queue.async {
            if self.session.isRunning { self.session.stopRunning() }
        }
    }

    /// Settings changed (quality, frame rate, codec, steady, exposure, mirror).
    func apply(_ s: PrompterSettings) {
        settings = s
        guard configured else { return }
        queue.async { self.configureFormat() }
    }

    private func frontCamera() -> AVCaptureDevice? {
        AVCaptureDevice.DiscoverySession(deviceTypes: [.builtInTrueDepthCamera, .builtInWideAngleCamera],
                                         mediaType: .video, position: .front).devices.first
    }

    private func configure(withAudio: Bool) {
        guard let cam = frontCamera() else {
            DispatchQueue.main.async { self.state = .unavailable("No front camera here. The words still roll.") }
            return
        }
        device = cam
        session.beginConfiguration()
        session.sessionPreset = .inputPriority
        do {
            if videoInput == nil {
                let vi = try AVCaptureDeviceInput(device: cam)
                if session.canAddInput(vi) { session.addInput(vi); videoInput = vi }
            }
            if withAudio, audioInput == nil, let mic = AVCaptureDevice.default(for: .audio) {
                let ai = try AVCaptureDeviceInput(device: mic)
                if session.canAddInput(ai) { session.addInput(ai); audioInput = ai }
            }
        } catch {
            session.commitConfiguration()
            DispatchQueue.main.async { self.state = .unavailable("The camera did not start: \(error.localizedDescription)") }
            return
        }
        if !session.outputs.contains(movieOutput), session.canAddOutput(movieOutput) {
            session.addOutput(movieOutput)
        }
        session.commitConfiguration()
        configured = true
        configureFormat()
        rotation = AVCaptureDevice.RotationCoordinator(device: cam, previewLayer: nil)
        if !session.isRunning { session.startRunning() }
        DispatchQueue.main.async { self.state = .ready }
    }

    /// Pick and lock the format, frame rate, steady mode and exposure. Runs on the camera queue.
    private func configureFormat() {
        guard let cam = device else { return }
        let s = settings
        let want = stabilizationMode(s.stabilization)
        let infos: [CaptureChoice.FormatInfo] = cam.formats.enumerated().map { i, f in
            let dims = CMVideoFormatDescriptionGetDimensions(f.formatDescription)
            let sub = CMFormatDescriptionGetMediaSubType(f.formatDescription)
            return CaptureChoice.FormatInfo(
                index: i, width: Int(dims.width), height: Int(dims.height),
                maxFPS: f.videoSupportedFrameRateRanges.map { $0.maxFrameRate }.max() ?? 0,
                stabilization: want == .off || f.isVideoStabilizationModeSupported(want),
                videoRange: sub == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
                hdr: f.isVideoHDRSupported && sub != kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange && sub != kCVPixelFormatType_420YpCbCr8BiPlanarFullRange)
        }
        guard let pick = CaptureChoice.pickHighest(infos, width: s.quality.width, height: s.quality.height,
                                                   wantStabilization: want != .off) else {
            DispatchQueue.main.async { self.shortfall = "This camera has no 16:9 video format." }
            return
        }
        let format = cam.formats[pick.index]
        session.beginConfiguration()
        do {
            try cam.lockForConfiguration()
            cam.activeFormat = format
            let frame = CMTime(value: 1, timescale: CMTimeScale(pick.fps))
            cam.activeVideoMinFrameDuration = frame
            cam.activeVideoMaxFrameDuration = frame
            if s.lockExposure {
                if cam.isExposureModeSupported(.locked) { cam.exposureMode = .locked }
            } else if cam.isExposureModeSupported(.continuousAutoExposure) {
                cam.exposureMode = .continuousAutoExposure
            }
            cam.unlockForConfiguration()
        } catch {
            DispatchQueue.main.async { self.lastError = "The camera would not change: \(error.localizedDescription)" }
        }
        if let conn = movieOutput.connection(with: .video) {
            if conn.isVideoMirroringSupported {
                conn.automaticallyAdjustsVideoMirroring = false
                conn.isVideoMirrored = s.recordMirrored
            }
            if conn.isVideoStabilizationSupported {
                conn.preferredVideoStabilizationMode = want
            }
            applyOutputSettings(conn, width: pick.width, fps: pick.fps)
        }
        session.commitConfiguration()
        let codecWord = s.codec == .h264 ? "H.264" : "HEVC"
        let size: String
        if pick.width == 3840 && pick.height == 2160 { size = "4K \(pick.width)×\(pick.height)" }
        else if pick.width == 1920 && pick.height == 1080 { size = "1080p \(pick.width)×\(pick.height)" }
        else { size = "\(pick.width)×\(pick.height)" }
        DispatchQueue.main.async {
            self.summary = "\(size) · \(pick.fps) fps · \(codecWord)\(s.recordMirrored ? " · mirrored" : "")"
            self.shortfall = pick.shortfall
        }
    }

    private func stabilizationMode(_ s: PrompterSettings.Steady) -> AVCaptureVideoStabilizationMode {
        switch s {
        case .off: return .off
        case .standard: return .standard
        case .cinematic: return .cinematic
        }
    }

    /// Codec and bitrate. On iOS only keys the output lists may be set, or it
    /// throws (Apple: AVCaptureMovieFileOutput.setOutputSettings(_:for:)), so
    /// every key is checked first.
    private func applyOutputSettings(_ conn: AVCaptureConnection, width: Int, fps: Int) {
        let codec: AVVideoCodecType = settings.codec == .h264 ? .h264 : .hevc
        guard movieOutput.availableVideoCodecTypes.contains(codec) else { return }
        let keys = Set(movieOutput.supportedOutputSettingsKeys(for: conn))
        guard keys.contains(AVVideoCodecKey) else { return }
        var out: [String: Any] = [AVVideoCodecKey: codec]
        if keys.contains(AVVideoCompressionPropertiesKey) {
            out[AVVideoCompressionPropertiesKey] = [
                AVVideoAverageBitRateKey: CaptureChoice.bitrate(width: width, fps: fps, hevc: codec == .hevc)
            ]
        }
        movieOutput.setOutputSettings(out, for: conn)
    }

    // MARK: - Recording

    var isRecording: Bool { if case .recording = state { return true } else { return false } }

    /// Start a take. `name` is the take file name from the server.
    func startRecording(name: String) {
        guard case .ready = state else { return }
        pendingName = name
        let angle = rotation?.videoRotationAngleForHorizonLevelCapture ?? 90
        queue.async {
            guard let conn = self.movieOutput.connection(with: .video) else { return }
            if conn.isVideoRotationAngleSupported(angle) { conn.videoRotationAngle = angle }
            if conn.isVideoMirroringSupported {
                conn.automaticallyAdjustsVideoMirroring = false
                conn.isVideoMirrored = self.settings.recordMirrored
            }
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent(UUID().uuidString)
                .appendingPathExtension("mov")
            self.movieOutput.startRecording(to: url, recordingDelegate: self)
            DispatchQueue.main.async { self.state = .recording(started: Date()) }
        }
    }

    func stopRecording() {
        queue.async {
            if self.movieOutput.isRecording { self.movieOutput.stopRecording() }
        }
    }
}

extension CameraController: AVCaptureFileOutputRecordingDelegate {
    func fileOutput(_ output: AVCaptureFileOutput, didFinishRecordingTo url: URL,
                    from connections: [AVCaptureConnection], error: Error?) {
        let name = pendingName
        // A recording that stopped with an error can still hold a good file
        // (for example the phone ran low on space); keep it if it says so.
        let finished = (error as NSError?)?.userInfo[AVErrorRecordingSuccessfullyFinishedKey] as? Bool ?? (error == nil)
        DispatchQueue.main.async { self.state = .saving }
        guard finished else {
            DispatchQueue.main.async {
                self.state = .ready
                self.lastError = "The take did not record: \(error?.localizedDescription ?? "unknown")"
            }
            return
        }
        Task {
            let result = await PhotosSaver.save(movie: url, takeName: name)
            await MainActor.run {
                self.state = .ready
                switch result {
                case .success(let saved): self.lastSaved = "Saved to Photos: \(saved)"; self.lastError = nil
                case .failure(let e): self.lastError = e.message
                }
            }
        }
    }
}

/// The camera keeps its own serial queue for every AVFoundation call and
/// publishes only on the main queue.
extension CameraController: @unchecked Sendable {}
