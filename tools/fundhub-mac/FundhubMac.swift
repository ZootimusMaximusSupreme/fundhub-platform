import AppKit
import SwiftUI
import WebKit

private enum Brand {
    static let ink = Color(red: 12 / 255, green: 16 / 255, blue: 20 / 255)
    static let paper = Color(red: 248 / 255, green: 248 / 255, blue: 246 / 255)
    static let muted = Color(red: 99 / 255, green: 106 / 255, blue: 111 / 255)
    static let spectrum: [Color] = [
        Color(red: 42 / 255, green: 153 / 255, blue: 227 / 255),
        Color(red: 44 / 255, green: 185 / 255, blue: 173 / 255),
        Color(red: 132 / 255, green: 198 / 255, blue: 99 / 255),
        Color(red: 236 / 255, green: 197 / 255, blue: 78 / 255),
        Color(red: 239 / 255, green: 143 / 255, blue: 85 / 255),
        Color(red: 216 / 255, green: 96 / 255, blue: 146 / 255)
    ]
}

private enum SignInRoute {
    case team
    case client

    var url: URL {
        switch self {
        case .team: URL(string: "https://fundhub.ai/login.html")!
        case .client: URL(string: "https://fundhub.ai/portal-login.html")!
        }
    }
}

@MainActor
private final class FundhubBrowser: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate {
    @Published var route: SignInRoute?
    @Published var loading = false
    @Published var loadedOnce = false
    @Published var canGoBack = false
    @Published var loadFailed = false

    lazy var view: WKWebView = {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = self
        view.uiDelegate = self
        view.allowsBackForwardNavigationGestures = true
        return view
    }()

    func open(_ route: SignInRoute) {
        self.route = route
        loadFailed = false
        loadedOnce = false
        loading = true
        view.load(URLRequest(url: route.url))
    }

    func reload() {
        loadFailed = false
        loading = true
        if view.url == nil, let route {
            view.load(URLRequest(url: route.url))
        } else {
            view.reload()
        }
    }

    func goHome() {
        view.stopLoading()
        route = nil
        loading = false
        loadFailed = false
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        loading = true
        loadFailed = false
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loading = false
        loadedOnce = true
        canGoBack = webView.canGoBack
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        recordFailure(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        recordFailure(error)
    }

    private func recordFailure(_ error: Error) {
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        loading = false
        loadFailed = true
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }
        // No frame (including an embedded payment return) may render the
        // marketing homepage. Other subframes remain in WebKit as normal.
        if isPublicMarketingHome(url) {
            if navigationAction.targetFrame?.isMainFrame != false {
                // A blocked redirect must not leave the Mac loading forever.
                loading = false
                if !loadedOnce { loadFailed = true }
            }
            decisionHandler(.cancel)
            return
        }
        if navigationAction.targetFrame?.isMainFrame == false {
            decisionHandler(.allow)
            return
        }
        if isFundhub(url) {
            decisionHandler(.allow)
        } else {
            openAllowedExternal(url)
            decisionHandler(.cancel)
        }
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        guard let url = navigationAction.request.url else { return nil }
        // target=_blank/window.open must not bypass the same rule.
        guard !isPublicMarketingHome(url) else { return nil }
        if isFundhub(url) {
            webView.load(URLRequest(url: url))
        } else {
            openAllowedExternal(url)
        }
        return nil
    }

    // Redirects can replace an allowed workspace or iframe URL with public
    // marketing content. Refuse that final response before WebKit displays it.
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        if let finalURL = navigationResponse.response.url,
           isPublicMarketingHome(finalURL) {
            if navigationResponse.isForMainFrame {
                // Final redirect was denied; preserve the existing workspace
                // rather than leaving a perpetual loading bar on the Mac.
                loading = false
                if !loadedOnce { loadFailed = true }
            }
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    private func isPublicMarketingHome(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "https",
              let hostname = url.host?.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: ".")),
              hostname == "fundhub.ai" || hostname == "www.fundhub.ai" else { return false }
        // URL.standardized does not remove decoded percent-encoded dot
        // segments on every Foundation/WebKit route (e.g. /%2e/index.html).
        // Resolve dot segments once so equivalent public-home URLs cannot slip
        // into a signed-in native workspace.
        let path = url.standardized.path.lowercased()
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        var segments: [Substring] = []
        for segment in path.split(separator: "/") {
            if segment == "." { continue }
            if segment == ".." {
                if !segments.isEmpty { segments.removeLast() }
                continue
            }
            segments.append(segment)
        }
        let page = segments.joined(separator: "/")
        return page.isEmpty || page == "index.html"
    }

    private func openAllowedExternal(_ url: URL) {
        // A remote page must not be able to launch file:, javascript:,
        // custom app handlers or other privileged system URL schemes.
        guard ["https", "mailto", "tel"].contains(url.scheme?.lowercased() ?? "") else { return }
        NSWorkspace.shared.open(url)
    }

    private func isFundhub(_ url: URL) -> Bool {
        guard url.scheme == "https", let host = url.host?.lowercased() else {
            return false
        }
        return host == "fundhub.ai" || host.hasSuffix(".fundhub.ai")
    }
}

private struct FundhubWebView: NSViewRepresentable {
    @ObservedObject var browser: FundhubBrowser

    func makeNSView(context: Context) -> WKWebView { browser.view }
    func updateNSView(_ view: WKWebView, context: Context) {}
}

private struct SpectrumBar: View {
    var body: some View {
        HStack(spacing: 0) {
            ForEach(Brand.spectrum.indices, id: \.self) { index in
                Brand.spectrum[index].frame(height: 4)
            }
        }
        .accessibilityHidden(true)
    }
}

private struct FundhubMark: View {
    var body: some View {
        HStack(spacing: 12) {
            Text("f.")
                .font(.system(size: 22, weight: .black, design: .rounded))
                .foregroundStyle(.white)
                .frame(width: 42, height: 42)
                .background(Brand.ink, in: RoundedRectangle(cornerRadius: 11))
            Text("fundhub")
                .font(.system(size: 22, weight: .bold, design: .rounded))
                .tracking(-0.8)
                .foregroundStyle(Brand.ink)
        }
    }
}

private struct WelcomeView: View {
    let open: (SignInRoute) -> Void

    var body: some View {
        ZStack {
            Brand.paper.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 0) {
                FundhubMark()
                Spacer(minLength: 48)
                Text("Your work,\nin focus.")
                    .font(.system(size: 58, weight: .semibold, design: .rounded))
                    .tracking(-2.6)
                    .lineSpacing(-5)
                    .foregroundStyle(Brand.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text("Your Fundhub workspace, right here on your Mac.")
                    .font(.system(size: 17))
                    .foregroundStyle(Brand.muted)
                    .padding(.top, 24)

                VStack(spacing: 12) {
                    Button { open(.team) } label: {
                        HStack {
                            Text("Team sign-in")
                            Spacer()
                            Image(systemName: "arrow.up.right")
                        }
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 20)
                        .frame(height: 52)
                        .background(Brand.ink, in: RoundedRectangle(cornerRadius: 12))
                    }
                    .buttonStyle(.plain)
                    .keyboardShortcut(.defaultAction)

                    Button { open(.client) } label: {
                        HStack {
                            Text("Client sign-in")
                            Spacer()
                            Image(systemName: "arrow.up.right")
                        }
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Brand.ink)
                        .padding(.horizontal, 20)
                        .frame(height: 52)
                        .background(.white, in: RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Brand.ink.opacity(0.18)))
                    }
                    .buttonStyle(.plain)
                }
                .frame(maxWidth: 420)
                .padding(.top, 48)

                Spacer(minLength: 48)
                HStack(spacing: 20) {
                    Link("Privacy", destination: URL(string: "https://fundhub.ai/privacy/")!)
                    Link("Support", destination: URL(string: "mailto:support@fundhub.ai")!)
                }
                .font(.system(size: 13))
                .foregroundStyle(Brand.muted)
            }
            .padding(48)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .overlay(alignment: .bottom) { SpectrumBar() }
    }
}

private struct ContentView: View {
    @StateObject private var browser = FundhubBrowser()

    var body: some View {
        Group {
            if browser.route != nil {
                VStack(spacing: 0) {
                    HStack(spacing: 16) {
                        FundhubMark()
                            .frame(width: 160, alignment: .leading)
                        Rectangle()
                            .fill(Brand.ink.opacity(0.12))
                            .frame(width: 1, height: 24)
                        Text("Fundhub workspace")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(Brand.muted)
                        Spacer()
                        Button { browser.view.goBack() } label: {
                            Image(systemName: "chevron.left").frame(width: 32, height: 32)
                        }
                            .help("Back")
                            .accessibilityLabel("Back")
                            .disabled(!browser.canGoBack)
                        Button { browser.reload() } label: {
                            Image(systemName: "arrow.clockwise").frame(width: 32, height: 32)
                        }
                            .help("Reload")
                            .accessibilityLabel("Reload")
                        Button { browser.goHome() } label: {
                            Image(systemName: "house").frame(width: 32, height: 32)
                        }
                            .help("Home")
                            .accessibilityLabel("Home")
                    }
                    .buttonStyle(.borderless)
                    .foregroundStyle(Brand.ink)
                    .padding(.horizontal, 24)
                    .frame(height: 56)
                    .background(Brand.paper)

                    if browser.loading {
                        ProgressView().controlSize(.small).frame(maxWidth: .infinity)
                    }
                    ZStack {
                        FundhubWebView(browser: browser)
                        if browser.loadFailed {
                            VStack(spacing: 16) {
                                Text("Fundhub did not load.")
                                    .font(.system(size: 24, weight: .semibold))
                                Text("Check your connection, then try again.")
                                    .foregroundStyle(Brand.muted)
                                Button("Try again") { browser.reload() }
                                    .buttonStyle(.borderedProminent)
                            }
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .background(Brand.paper)
                        } else if !browser.loadedOnce {
                            VStack(alignment: .leading, spacing: 16) {
                                RoundedRectangle(cornerRadius: 8)
                                    .fill(Brand.ink.opacity(0.08))
                                    .frame(width: 300, height: 32)
                                RoundedRectangle(cornerRadius: 8)
                                    .fill(Brand.ink.opacity(0.05))
                                    .frame(width: 420, height: 20)
                                Text("Opening Fundhub…")
                                    .font(.system(size: 14))
                                    .foregroundStyle(Brand.muted)
                            }
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .background(Brand.paper)
                        }
                    }
                    SpectrumBar()
                }
            } else {
                WelcomeView(open: browser.open)
            }
        }
        .frame(minWidth: 900, minHeight: 640)
    }
}

@main
private struct FundhubMacApp: App {
    var body: some Scene {
        WindowGroup("Fundhub") {
            ContentView()
        }
        .windowStyle(.titleBar)
    }
}
