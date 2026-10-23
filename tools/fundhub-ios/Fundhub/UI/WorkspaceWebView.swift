import SwiftUI
import WebKit

struct WorkspaceWebView: UIViewRepresentable {
    let token: String
    let principal: String
    let identity: FundhubIdentity
    let path: String
    let onWebSignOut: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onWebSignOut: onWebSignOut) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        let client = identity.clientId ?? ""
        let account = principal == "client"
            ? "{\"clientId\":\"\(client)\",\"kind\":\"client\"}"
            : "null"
        let script = """
        if (location.hostname === 'fundhub.ai') {
          localStorage.setItem('fh_token', \(json(token)));
          localStorage.setItem('fh_role', \(json(principal == "client" ? "client" : (identity.role ?? "staff"))));
          if (\(principal == "client" ? "true" : "false")) localStorage.setItem('fh_account', \(json(account)));
          else localStorage.removeItem('fh_account');
          localStorage.removeItem('fh_demo');
          localStorage.removeItem('fh_demo_staff');
        }
        """
        config.userContentController.addUserScript(
            WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        context.coordinator.webView = webView
        webView.load(URLRequest(url: FundhubAPI.base.appendingPathComponent(String(path.dropFirst()))))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    private func json(_ value: String) -> String {
        guard let data = try? JSONEncoder().encode(value) else { return "\"\"" }
        return String(decoding: data, as: UTF8.self)
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        let onWebSignOut: () -> Void
        weak var webView: WKWebView?
        private var leftAt: Date?

        init(onWebSignOut: @escaping () -> Void) {
            self.onWebSignOut = onWebSignOut
            super.init()
            let center = NotificationCenter.default
            center.addObserver(self, selector: #selector(didLeave),
                               name: UIApplication.didEnterBackgroundNotification, object: nil)
            center.addObserver(self, selector: #selector(didReturn),
                               name: UIApplication.willEnterForegroundNotification, object: nil)
        }

        @objc private func didLeave() { leftAt = Date() }

        // Pick up CRM updates when the app comes back after a while away.
        @objc private func didReturn() {
            defer { leftAt = nil }
            guard let leftAt, let webView,
                  WorkspaceNavigation.shouldReload(url: webView.url, awaySeconds: Date().timeIntervalSince(leftAt))
            else { return }
            webView.reload()
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
            if url.scheme == "https", url.host == "fundhub.ai" {
                if WorkspaceNavigation.isSignOutDestination(url) {
                    onWebSignOut()
                    decisionHandler(.cancel)
                    return
                }
                decisionHandler(.allow)
            } else {
                if ["https", "mailto", "tel"].contains(url.scheme ?? "") { UIApplication.shared.open(url) }
                decisionHandler(.cancel)
            }
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = navigationAction.request.url,
               ["https", "mailto", "tel"].contains(url.scheme ?? "") {
                UIApplication.shared.open(url)
            }
            return nil
        }
    }
}

enum WorkspaceNavigation {
    static let reloadAfterSeconds: TimeInterval = 5 * 60

    static func shouldReload(url: URL?, awaySeconds: TimeInterval) -> Bool {
        guard let url, url.scheme == "https", url.host == "fundhub.ai" else { return false }
        return awaySeconds >= reloadAfterSeconds
    }

    static func isSignOutDestination(_ url: URL) -> Bool {
        url.scheme == "https" && url.host == "fundhub.ai"
            && (url.path == "/login.html" || url.path == "/portal-login.html")
    }
}
