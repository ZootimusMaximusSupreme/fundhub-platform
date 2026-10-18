import Security
import SwiftUI
import UIKit
import WebKit

/// The Shoot Day link is the web teleprompter's existing, single-shoot access key.
/// No staff login or second native teleprompter is involved.
enum ShootFilmLink {
    static func parse(_ text: String) -> URL? {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let absolute = value.hasPrefix("/app/teleprompter.html?") ? "https://fundhub.ai" + value : value
        guard let parts = URLComponents(string: absolute),
              parts.scheme == "https", parts.host == "fundhub.ai", parts.port == nil,
              parts.user == nil, parts.password == nil, parts.fragment == nil,
              parts.path == "/app/teleprompter.html",
              let items = parts.queryItems,
              let key = items.first(where: { $0.name == "k" })?.value else { return nil }
        let fields = key.split(separator: ".", omittingEmptySubsequences: false)
        let uuid = /^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/
        guard fields.count == 4,
              fields[0].wholeMatch(of: uuid) != nil,
              fields[1].wholeMatch(of: uuid) != nil,
              fields[2].range(of: #"^[0-9]{1,12}$"#, options: .regularExpression) != nil,
              fields[3].range(of: #"^[0-9a-fA-F]{64}$"#, options: .regularExpression) != nil else { return nil }
        return parts.url
    }
}

enum FilmLinkStore {
    private static let service = "ai.fundhub.prompter"
    private static let account = "shoot-film-link"

    static func load() -> URL? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data,
              let text = String(data: data, encoding: .utf8) else { return nil }
        return ShootFilmLink.parse(text)
    }

    static func save(_ url: URL) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let attributes: [String: Any] = [
            kSecValueData as String: Data(url.absoluteString.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        if SecItemUpdate(query as CFDictionary, attributes as CFDictionary) == errSecItemNotFound {
            var addition = query
            addition.merge(attributes) { _, new in new }
            SecItemAdd(addition as CFDictionary, nil)
        }
    }
}

struct LivePrompterView: View {
    @State private var filmURL = FilmLinkStore.load()
    @State private var enteredLink = ""
    @State private var invalidLink = false
    @State private var showingLinkEntry = false

    var body: some View {
        Group {
            if let filmURL, !showingLinkEntry {
                WebPrompter(url: filmURL)
                    .ignoresSafeArea()
                    .overlay(alignment: .topTrailing) {
                        Button {
                            showingLinkEntry = true
                        } label: {
                            Image(systemName: "link")
                                .font(.system(size: 14, weight: .semibold))
                                .frame(width: 44, height: 44)
                                .background(.black.opacity(0.75), in: Circle())
                        }
                        .accessibilityLabel("Change Shoot link")
                        .padding(.top, 55)
                        .padding(.trailing, 8)
                    }
            } else {
                VStack(alignment: .leading, spacing: 20) {
                    Text("Fundhub Prompter")
                        .font(.largeTitle.bold())
                    Text("Open the teleprompter from Shoot Day, then paste its film link here. No login is needed in this app.")
                        .foregroundStyle(.secondary)
                    TextField("Shoot Day film link", text: $enteredLink, axis: .vertical)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("shoot-film-link")
                    if invalidLink {
                        Text("Paste the teleprompter link from Shoot Day.")
                            .foregroundStyle(.red)
                    }
                    Button("Paste link") {
                        enteredLink = UIPasteboard.general.string ?? ""
                        openLink()
                    }
                    Button("Open teleprompter") { openLink() }
                        .buttonStyle(.borderedProminent)
                    Spacer()
                }
                .padding(24)
            }
        }
    }

    private func openLink() {
        guard let url = ShootFilmLink.parse(enteredLink) else {
            invalidLink = true
            return
        }
        FilmLinkStore.save(url)
        filmURL = url
        invalidLink = false
        showingLinkEntry = false
    }
}

private struct WebPrompter: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.websiteDataStore = .default()
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.isOpaque = false
        view.backgroundColor = .black
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
