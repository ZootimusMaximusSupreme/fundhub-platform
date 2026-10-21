import SwiftUI
import UIKit
import WebKit

/// The existing public Shoot Day read serves the default company's current shoot.
/// The separate iPhone app opens that same filming page directly.
enum TeleprompterDestination {
    static let url = URL(string: "https://fundhub.ai/app/teleprompter.html")!
}

/// Chris's teleprompter screen, exactly as Safari shows it, with the iPhone's
/// own camera filming behind it (NativeCameraBridge).
struct LivePrompterView: View {
    @StateObject private var bridge = NativeCameraBridge()

    var body: some View {
        ZStack {
            CameraPreview(session: bridge.camera.session)
                .ignoresSafeArea()
            WebPrompter(url: TeleprompterDestination.url, bridge: bridge)
                .ignoresSafeArea()
        }
        .background(Color.black.ignoresSafeArea())
    }
}

private struct WebPrompter: UIViewRepresentable {
    let url: URL
    let bridge: NativeCameraBridge

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.websiteDataStore = .default()
        bridge.install(into: configuration)
        let view = WKWebView(frame: .zero, configuration: configuration)
        // Clear, so the camera behind shows through where the screen is clear.
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.backgroundColor = .clear
        bridge.webView = view
        view.scrollView.isScrollEnabled = false
        view.uiDelegate = context.coordinator
        view.navigationDelegate = context.coordinator
        view.load(URLRequest(url: url))
        context.coordinator.loadedURL = url
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        if context.coordinator.loadedURL != url {
            context.coordinator.loadedURL = url
            view.load(URLRequest(url: url))
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, WKUIDelegate, WKNavigationDelegate, WKDownloadDelegate {
        var loadedURL: URL?

        func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                     initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                     decisionHandler: @escaping (WKPermissionDecision) -> Void) {
            decisionHandler(origin.protocol == "https" && origin.host == "fundhub.ai" ? .grant : .deny)
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if action.shouldPerformDownload {
                decisionHandler(.download)
            } else if let url = action.request.url,
                      url.scheme == "https", url.host != "fundhub.ai" {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
            } else {
                decisionHandler(.allow)
            }
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = action.request.url, url.scheme == "https" {
                UIApplication.shared.open(url)
            }
            return nil
        }

        func webView(_ webView: WKWebView, navigationAction: WKNavigationAction,
                     didBecome download: WKDownload) {
            download.delegate = self
        }

        func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse,
                     didBecome download: WKDownload) {
            download.delegate = self
        }

        func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                      suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
            let files = FileManager.default
            let folder = files.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("Takes")
            try? files.createDirectory(at: folder, withIntermediateDirectories: true)
            let safeName = URL(fileURLWithPath: suggestedFilename).lastPathComponent
            let base = URL(fileURLWithPath: safeName).deletingPathExtension().lastPathComponent
            let ext = URL(fileURLWithPath: safeName).pathExtension
            var destination = folder.appendingPathComponent(safeName)
            var number = 2
            while files.fileExists(atPath: destination.path) {
                destination = folder.appendingPathComponent("\(base) \(number).\(ext)")
                number += 1
            }
            completionHandler(destination)
        }
    }
}
