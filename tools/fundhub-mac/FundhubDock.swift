import AppKit
import Carbon
import WebKit

@MainActor
final class FundhubDock: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    static let shared = FundhubDock()

    private var panel: NSPanel?
    private var dockWebView: WKWebView?
    private weak var workspaceWebView: WKWebView?
    private var expanded = false
    private var roleCount = 1
    private var lastUrgentCount: Int?
    private var sessionGeneration = 0
    private var side: String { UserDefaults.standard.string(forKey: "fundhubDockSide") == "left" ? "left" : "right" }
    private var hotKey: EventHotKeyRef?
    private var hotKeyHandler: EventHandlerRef?

    private override init() {
        super.init()
        installHotKey()
    }

    func refreshVisibility(from workspace: WKWebView) async {
        let generation = sessionGeneration
        guard let page = workspace.url,
              page.scheme == "https",
              page.host == "fundhub.ai",
              !["/login.html", "/portal-login.html"].contains(page.path) else {
            hide()
            return
        }
        let token = (try? await workspace.evaluateJavaScript("window.localStorage.getItem('fh_token')")) as? String
        guard generation == sessionGeneration, workspace.url == page else { return }
        guard let token, !token.isEmpty, token != "demo" else {
            hide()
            return
        }
        workspaceWebView = workspace
        show()
    }

    func hide() {
        sessionGeneration += 1
        panel?.orderOut(nil)
        workspaceWebView = nil
        dockWebView?.loadHTMLString("", baseURL: nil)
        dockWebView = nil
        panel?.close()
        panel = nil
        expanded = false
        lastUrgentCount = nil
    }

    private func show() {
        if panel == nil { makePanel() }
        placePanel()
        panel?.orderFrontRegardless()
    }

    private func makePanel() {
        let controller = WKUserContentController()
        controller.add(self, name: "dock")
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.userContentController = controller
        let web = WKWebView(frame: .zero, configuration: config)
        web.underPageBackgroundColor = .clear
        web.navigationDelegate = self
        dockWebView = web

        let created = NSPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        created.isOpaque = false
        created.backgroundColor = .clear
        created.hasShadow = true
        created.level = .floating
        created.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        created.isMovable = false
        created.hidesOnDeactivate = false
        created.contentView = web
        panel = created
        if let url = URL(string: "https://fundhub.ai/app/role-dock.html") {
            web.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
        }
    }

    private func placePanel() {
        guard let panel else { return }
        let screen = workspaceWebView?.window?.screen ?? panel.screen ?? NSScreen.main ?? NSScreen.screens.first
        guard let frame = screen?.visibleFrame else { return }
        let height = min(frame.height * 0.72, max(224, CGFloat(150 + roleCount * 120)))
        let width: CGFloat = expanded ? 346 : 58
        let x = side == "left" ? frame.minX : frame.maxX - width
        let y = frame.midY - height / 2
        panel.setFrame(NSRect(x: x, y: y, width: width, height: height), display: true, animate: false)
    }

    private func setExpanded(_ value: Bool) {
        expanded = value
        placePanel()
    }

    private func toggle() {
        guard panel != nil else { return }
        dockWebView?.evaluateJavaScript("window.dispatchEvent(new MessageEvent('message', {origin: location.origin, data: {type: 'dock-toggle'}}))", completionHandler: nil)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "dock", let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "expand": setExpanded(true)
        case "collapse": setExpanded(false)
        case "side":
            guard let value = body["side"] as? String, ["left", "right"].contains(value) else { return }
            UserDefaults.standard.set(value, forKey: "fundhubDockSide")
            placePanel()
        case "count":
            roleCount = max(1, min(8, body["count"] as? Int ?? 1))
            if let urgent = body["urgent"] as? Int {
                if let previous = lastUrgentCount, urgent > previous { NSSound.beep() }
                lastUrgentCount = urgent
            }
            placePanel()
        case "open":
            guard let href = body["href"] as? String,
                  let url = URL(string: href), url.scheme == "https", url.host == "fundhub.ai",
                  (url.path.hasPrefix("/app/") || url.path == "/progress.html") else { return }
            if let workspaceWebView {
                workspaceWebView.load(URLRequest(url: url))
                NSApp.activate(ignoringOtherApps: true)
                NSApp.windows.first(where: { $0 !== panel && $0.title == "Fundhub" })?.makeKeyAndOrderFront(nil)
            } else {
                NSWorkspace.shared.open(url)
            }
        case "authExpired": hide()
        default: break
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let quotedSide = side == "left" ? "left" : "right"
        webView.evaluateJavaScript("document.body.dataset.side='\(quotedSide)'", completionHandler: nil)
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "https", url.host == "fundhub.ai", url.path == "/app/role-dock.html" {
            decisionHandler(.allow)
        } else {
            decisionHandler(.cancel)
        }
    }

    private func installHotKey() {
        let hotKeyID = EventHotKeyID(signature: 0x4648444B, id: 1)
        RegisterEventHotKey(UInt32(kVK_ANSI_D), UInt32(cmdKey | optionKey | shiftKey), hotKeyID, GetApplicationEventTarget(), 0, &hotKey)
        var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: OSType(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, _, _ in
            Task { @MainActor in FundhubDock.shared.toggle() }
            return noErr
        }, 1, &eventType, nil, &hotKeyHandler)
    }
}
