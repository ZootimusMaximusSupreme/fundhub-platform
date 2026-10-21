import AVKit
import Combine
import Foundation
import Network
import UIKit
import WebKit

/// Joins Chris's teleprompter screen (public/app/teleprompter.html, the same
/// screen Safari shows) to the iPhone's own camera. The screen keeps every
/// button and every step it has; only the camera underneath is native, so
/// long form films 4K 60 fps and ads film 1080p up to 120 fps (owner call
/// 2026-10-21).
///
/// The screen talks to the app through `fundhubCamera` messages; the app
/// answers through `window.FundhubNativeCamera.receive(event)`. Contract v1:
///   screen → app  {type:"open", mode:"4k"|"1080p", facing:"user"|"environment"}
///                 {type:"record", name, offer_key, funnel_tag} · {type:"stop"}
///                 {type:"keep", id} · {type:"discard", id}
///   app → screen  {type:"camera", state:"ready", facing, mode, width, height, fps, summary, shortfall}
///                 {type:"camera", state:"error", message} · {type:"recording"}
///                 {type:"take", id, name, url, bytes, diagnostics} · {type:"take-error", message}
///                 {type:"upload", text, state:"saving"|"saved"|"error"}
/// A finished take plays in the screen's save dialog from fundhub-take://take/<id>.mp4.
@MainActor
final class NativeCameraBridge: NSObject, ObservableObject {
    static let handlerName = "fundhubCamera"
    static let scheme = "fundhub-take"

    let camera = CameraController()
    let uploader: TakeUploader
    weak var webView: WKWebView?

    private struct Take {
        var file: URL
        var name: String
        var offerKey: String?
        var diagnostics: [String: AnyCodable]
    }
    /// Finished takes waiting for Yes or No on the screen.
    private var takes: [String: Take] = [:]
    private var started = false
    private var watching: AnyCancellable?
    private let monitor = NWPathMonitor()

    override init() {
        uploader = TakeUploader(baseURL: { URL(string: "https://fundhub.ai")! })
        super.init()
        camera.onReady = { [weak self] info in
            self?.send(["type": "camera", "state": "ready", "facing": info.back ? "environment" : "user",
                        "mode": info.longForm ? "4k" : "1080p", "width": info.width, "height": info.height,
                        "fps": info.fps, "summary": info.summary, "shortfall": info.shortfall ?? NSNull()])
        }
        camera.onRecordingStarted = { [weak self] in self?.send(["type": "recording"]) }
        camera.onTakeFailed = { [weak self] why in self?.send(["type": "take-error", "message": why]) }
        camera.onTake = { [weak self] file, name, offerKey, diagnostics in
            self?.finished(file: file, name: name, offerKey: offerKey, diagnostics: diagnostics)
        }
        watching = uploader.$status.removeDuplicates().sink { [weak self] text in
            Task { @MainActor in self?.sendUpload(text) }
        }
        monitor.pathUpdateHandler = { [weak self] path in
            guard path.status == .satisfied else { return }
            Task { @MainActor in await self?.uploader.retry() }
        }
        monitor.start(queue: DispatchQueue(label: "ai.fundhub.prompter.net"))
        NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in await self?.uploader.run() }
        }
        Task { await uploader.run() }
    }

    /// The page settings the screen needs before its own script runs.
    func install(into config: WKWebViewConfiguration) {
        let js = "window.FundhubNativeCamera = {version: 1, queue: [], receive: function (e) { this.queue.push(e); }};"
        config.userContentController.addUserScript(WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController.add(WeakHandler(self), name: Self.handlerName)
        config.setURLSchemeHandler(TakeFileServer(bridge: self), forURLScheme: Self.scheme)
    }

    // MARK: - Screen → app

    func handle(_ body: Any) {
        guard let m = body as? [String: Any], let type = m["type"] as? String else { return }
        switch type {
        case "open":
            camera.setLongForm((m["mode"] as? String) == "4k")
            camera.setFacing(back: (m["facing"] as? String) == "environment")
            if !started {
                started = true
                camera.start(with: PrompterSettings.load(bigScreen: false))
            } else {
                camera.apply(PrompterSettings.load(bigScreen: false))
            }
        case "record":
            guard camera.state == .ready else {
                send(["type": "take-error", "message": camera.lastError ?? "The camera is not ready yet."])
                return
            }
            let name = (m["name"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Take.mp4"
            let offer = (m["offer_key"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            camera.startRecording(name: name, offerKey: offer)
        case "stop":
            camera.stopRecording()
        case "keep":
            if let id = m["id"] as? String { keep(id) }
        case "discard":
            if let id = m["id"] as? String, let t = takes.removeValue(forKey: id) {
                try? FileManager.default.removeItem(at: t.file)
            }
        default:
            break
        }
    }

    /// One press of a phone volume button: +1 up, -1 down. The screen walks
    /// its speed ladder (owner law 2026-10-10, public/app/teleprompter.js volumeLadder).
    func volume(_ dir: Int) {
        send(["type": "volume", "dir": dir > 0 ? 1 : -1])
    }

    // MARK: - Takes

    private func finished(file: URL, name: String, offerKey: String?, diagnostics: [String: AnyCodable]) {
        let id = UUID().uuidString.lowercased()
        takes[id] = Take(file: file, name: name, offerKey: offerKey, diagnostics: diagnostics)
        let bytes = (try? FileManager.default.attributesOfItem(atPath: file.path)[.size] as? NSNumber)?.intValue ?? 0
        send(["type": "take", "id": id, "name": name, "url": "\(Self.scheme)://take/\(id).mp4", "bytes": bytes,
              "diagnostics": diagnostics.mapValues { $0.value }])
    }

    /// Yes on the screen: Photos keeps a copy, then the original goes to Drive.
    private func keep(_ id: String) {
        guard let t = takes.removeValue(forKey: id) else { return }
        sendUpload("Saving \(t.name)")
        Task {
            let saved = await PhotosSaver.save(movie: t.file, takeName: t.name, moveFile: false)
            var inPhotos = false
            if case .success = saved { inPhotos = true }
            if case .failure(let e) = saved { send(["type": "upload", "text": e.message, "state": "error"]) }
            uploader.add(file: t.file, name: t.name, offerKey: t.offerKey, inPhotos: inPhotos, diagnostics: t.diagnostics)
        }
    }

    /// The file behind fundhub-take://take/<id>.mp4, only while it waits for Yes or No.
    func fileFor(id: String) -> URL? { takes[id]?.file }

    // MARK: - App → screen

    private func sendUpload(_ text: String) {
        guard !text.isEmpty else { return }
        let failed = uploader.items.contains { $0.error != nil }
        let state = failed ? "error" : (uploader.items.isEmpty ? "saved" : "saving")
        send(["type": "upload", "text": text, "state": state])
    }

    private func send(_ event: [String: Any]) {
        guard let web = webView,
              let data = try? JSONSerialization.data(withJSONObject: event),
              let json = String(data: data, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.FundhubNativeCamera && window.FundhubNativeCamera.receive(\(json));")
    }
}

/// WKUserContentController keeps its handler strongly; this keeps the bridge free to go.
private final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var bridge: NativeCameraBridge?
    init(_ bridge: NativeCameraBridge) { self.bridge = bridge }
    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.host == "fundhub.ai" else { return }
        let body = message.body
        Task { @MainActor in self.bridge?.handle(body) }
    }
}

/// Plays a finished take in the screen's save dialog. Answers byte ranges,
/// which a video element needs to play and seek.
private final class TakeFileServer: NSObject, WKURLSchemeHandler {
    weak var bridge: NativeCameraBridge?
    private var stopped = Set<ObjectIdentifier>()

    init(bridge: NativeCameraBridge) { self.bridge = bridge }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        let key = ObjectIdentifier(task)
        let url = task.request.url
        let range = task.request.value(forHTTPHeaderField: "Range")
        Task { @MainActor in
            let id = url?.deletingPathExtension().lastPathComponent ?? ""
            guard let file = self.bridge?.fileFor(id: id),
                  let handle = try? FileHandle(forReadingFrom: file),
                  let size = (try? FileManager.default.attributesOfItem(atPath: file.path)[.size] as? NSNumber)?.intValue,
                  size > 0, let reqURL = url else {
                if !self.stopped.contains(key) { task.didFailWithError(URLError(.fileDoesNotExist)) }
                return
            }
            defer { try? handle.close() }
            var start = 0, end = size - 1, partial = false
            if let r = range, let m = r.range(of: #"bytes=(\d*)-(\d*)"#, options: .regularExpression) {
                let parts = r[m].dropFirst(6).split(separator: "-", omittingEmptySubsequences: false)
                if let a = Int(parts.first ?? "") { start = a }
                if parts.count > 1, let b = Int(parts[1]) { end = min(b, size - 1) }
                if parts.first?.isEmpty == true, parts.count > 1, let n = Int(parts[1]) { start = max(0, size - n); end = size - 1 }
                end = min(end, start + 8 * 1024 * 1024 - 1)
                partial = true
            }
            guard start <= end, start < size else {
                if !self.stopped.contains(key) { task.didFailWithError(URLError(.badServerResponse)) }
                return
            }
            try? handle.seek(toOffset: UInt64(start))
            let data = (try? handle.read(upToCount: end - start + 1)) ?? Data()
            var headers = ["Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Length": "\(data.count)"]
            if partial { headers["Content-Range"] = "bytes \(start)-\(start + data.count - 1)/\(size)" }
            let resp = HTTPURLResponse(url: reqURL, statusCode: partial ? 206 : 200, httpVersion: "HTTP/1.1", headerFields: headers)!
            guard !self.stopped.contains(key) else { return }
            task.didReceive(resp)
            task.didReceive(data)
            task.didFinish()
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        stopped.insert(ObjectIdentifier(task))
    }
}
