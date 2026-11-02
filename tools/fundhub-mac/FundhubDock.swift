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
        FundhubAudienceWindows.shared.closeAll()
        sessionGeneration += 1
        panel?.orderOut(nil)
        workspaceWebView = nil
        dockWebView?.loadHTMLString("", baseURL: nil)
        dockWebView = nil
        panel?.close()
        panel = nil
        expanded = false
        lastUrgentCount = nil
        roleCount = 1
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
        let height = min(frame.height * 0.72, max(288, CGFloat(150 + roleCount * 120)))
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
        guard message.webView === dockWebView, message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.protocol == "https",
              message.frameInfo.securityOrigin.host == "fundhub.ai",
              message.name == "dock", let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
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
        case "present":
            guard let href = body["href"] as? String, let url = URL(string: href),
                  FundhubAudienceWindows.allows(url), let workspace = workspaceWebView,
                  let rawRequestID = body["requestId"] as? String, let requestUUID = UUID(uuidString: rawRequestID) else { return }
            let requestID = requestUUID.uuidString.lowercased()
            let generation = sessionGeneration
            Task {
                let opened = await FundhubAudienceWindows.shared.open(url, from: workspace)
                guard generation == sessionGeneration else { FundhubAudienceWindows.shared.closeAll(); return }
                dockWebView?.evaluateJavaScript("window.dispatchEvent(new MessageEvent('message',{origin:location.origin,data:{type:'dock-present-result',requestId:'\(requestID)',ok:\(opened)}}))", completionHandler: nil)
            }
        case "joinMeet":
            guard let href = body["href"] as? String, let url = URL(string: href),
                  url.scheme == "https", url.host == "meet.google.com", url.user == nil, url.password == nil,
                  url.path.range(of: "^/[a-z]{3}-[a-z]{4}-[a-z]{3}/?$", options: .regularExpression) != nil else { return }
            NSWorkspace.shared.open(url)
        case "sessionChanged": hide()
        case "openExternal":
            guard let href = body["href"] as? String,
                  href == "https://adsmanager.facebook.com/adsmanager/manage/campaigns?business_id=1475597360226485&nav_entry_point=mbs_sub_nav&act=982103620742368#",
                  let url = URL(string: href) else { return }
            NSWorkspace.shared.open(url)
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

    private var hotKeyCode: UInt32 {
        switch UserDefaults.standard.string(forKey: "fundhubDockShortcut") {
        case "K": return UInt32(kVK_ANSI_K)
        case "J": return UInt32(kVK_ANSI_J)
        default: return UInt32(kVK_ANSI_D)
        }
    }

    func setShortcut(_ key: String) {
        guard ["D", "K", "J"].contains(key) else { return }
        if let hotKey { UnregisterEventHotKey(hotKey) }
        hotKey = nil
        UserDefaults.standard.set(key, forKey: "fundhubDockShortcut")
        registerHotKey()
    }

    private func registerHotKey() {
        let hotKeyID = EventHotKeyID(signature: 0x4648444B, id: 1)
        RegisterEventHotKey(hotKeyCode, UInt32(cmdKey | optionKey | shiftKey), hotKeyID, GetApplicationEventTarget(), 0, &hotKey)
    }

    private func installHotKey() {
        registerHotKey()
        var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: OSType(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, _, _ in
            Task { @MainActor in FundhubDock.shared.toggle() }
            return noErr
        }, 1, &eventType, nil, &hotKeyHandler)
    }
}

// A client-only presentation gets its own window and the existing WebKit session.
// The private workspace is never navigated to make room for it.
@MainActor
final class FundhubAudienceWindows: NSObject, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    static let shared = FundhubAudienceWindows()
    private var windows: [NSWindow: WKWebView] = [:]
    private var generation = 0

    static func allows(_ url: URL) -> Bool {
        guard url.scheme == "https", url.host == "fundhub.ai", url.path == "/app/present.html",
              url.user == nil, url.password == nil,
              let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let items = parts.queryItems, items.count == 2,
              items.filter({ $0.name == "audience" && $0.value == "1" }).count == 1,
              let contact = items.first(where: { $0.name == "contact" })?.value,
              UUID(uuidString: contact) != nil else { return false }
        return items.allSatisfy { ["contact", "audience"].contains($0.name) }
    }

    func open(_ url: URL, from source: WKWebView) async -> Bool {
        let generation = self.generation
        guard Self.allows(url), let sourceURL = source.url,
              sourceURL.scheme == "https", sourceURL.host == "fundhub.ai",
              let token = (try? await source.evaluateJavaScript("localStorage.getItem('fh_token')")) as? String,
              !token.isEmpty, token != "demo", token.utf8.count <= 4096 else { return false }
        var request = URLRequest(url: URL(string: "https://fundhub.ai/api/auth/session")!)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 10
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              json["ok"] as? Bool == true, let staff = json["staff"] as? [String: Any],
              let staffID = staff["id"] as? String, UUID(uuidString: staffID) != nil,
              !staffID.isEmpty else { return false }
        let finalToken = (try? await source.evaluateJavaScript("localStorage.getItem('fh_token')")) as? String
        guard generation == self.generation, source.url == sourceURL, finalToken == token else { return false }
        let controller = WKUserContentController()
        for script in source.configuration.userContentController.userScripts { controller.addUserScript(script) }
        controller.add(self, name: "audienceSession")
        controller.addUserScript(WKUserScript(source: """
        (() => { const bearer = localStorage.getItem('fh_token');
          const check = () => { if (localStorage.getItem('fh_token') !== bearer)
            window.webkit.messageHandlers.audienceSession.postMessage('changed'); };
          window.addEventListener('storage', check); setInterval(check, 1000);
        })();
        """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = source.configuration.websiteDataStore
        configuration.processPool = source.configuration.processPool
        configuration.userContentController = controller
        let web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self; web.uiDelegate = self
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 800),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Fundhub — Client presentation"
        window.isReleasedWhenClosed = false; window.delegate = self
        window.contentView = web; windows[window] = web
        window.center(); window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
        web.load(URLRequest(url: url))
        return true
    }

    func closeAll() { generation += 1; for window in Array(windows.keys) { window.close() } }
    func windowWillClose(_ notification: Notification) {
        guard let window = notification.object as? NSWindow, let web = windows.removeValue(forKey: window) else { return }
        web.stopLoading(); web.navigationDelegate = nil; web.uiDelegate = nil
        web.configuration.userContentController.removeScriptMessageHandler(forName: "audienceSession")
        web.loadHTMLString("", baseURL: nil)
    }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "audienceSession", message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.protocol == "https", message.frameInfo.securityOrigin.host == "fundhub.ai",
              windows.values.contains(where: { $0 === message.webView }) else { return }
        closeAll()
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if action.targetFrame?.isMainFrame == false { decisionHandler(url.scheme == "https" ? .allow : .cancel); return }
        decisionHandler(Self.allows(url) ? .allow : .cancel)
    }
    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        guard !response.isForMainFrame || response.response.url.map(Self.allows) == true else { decisionHandler(.cancel); return }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = action.request.url, Self.allows(url) else { return nil }
        Task { _ = await open(url, from: webView) }; return nil
    }
}
