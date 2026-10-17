import SwiftUI
import WebKit

struct WorkspacePresentationState {
    var isOpen = false
    var reloadId = 0

    mutating func openAfterVerifiedNotification() {
        // Changing the web view identity reloads the portal even when its
        // sheet is already open. A fresh page reads the current call again.
        reloadId &+= 1
        isOpen = true
    }
}

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

        init(onWebSignOut: @escaping () -> Void) {
            self.onWebSignOut = onWebSignOut
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
    static func isSignOutDestination(_ url: URL) -> Bool {
        url.scheme == "https" && url.host == "fundhub.ai"
            && (url.path == "/login.html" || url.path == "/portal-login.html")
    }
}
