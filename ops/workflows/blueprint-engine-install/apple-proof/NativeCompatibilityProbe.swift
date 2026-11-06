import UIKit
import WebKit
import ObjectiveC

final class ProbeLog {
    static let shared = ProbeLog()
    var events: [[String: Any]] = []
    func add(_ event: [String: Any]) {
        events.append(event)
        let record: [String: Any] = ["checkedAt":ISO8601DateFormatter().string(from:Date()),"platform":"iOS simulator WKWebView","actualProductionCoordinator":true,"externalOpenTransport":"swizzled to record only; no external app or provider request","events":events]
        if let bytes=try? JSONSerialization.data(withJSONObject:record,options:[.prettyPrinted,.sortedKeys]) {
            let dir=FileManager.default.urls(for:.documentDirectory,in:.userDomainMask)[0]
            try? bytes.write(to:dir.appendingPathComponent("native-compatibility.json"))
        }
    }
}
extension UIApplication {
    @objc func probeOpen(_ url:URL, options:[UIApplication.OpenExternalURLOptionsKey:Any],completionHandler:((Bool)->Void)?) {
        ProbeLog.shared.add(["kind":"external_destination","url":url.absoluteString]); completionHandler?(true)
    }
}
final class ProbeNavigation: NSObject, WKNavigationDelegate {
    let production=WorkspaceWebView.Coordinator(onWebSignOut:{ProbeLog.shared.add(["kind":"signout"] )})
    var started=false
    func webView(_ webView:WKWebView,decidePolicyFor action:WKNavigationAction,decisionHandler:@escaping(WKNavigationActionPolicy)->Void){
        production.webView(webView,decidePolicyFor:action){ policy in
            if let u=action.request.url, u.host == "fundhub.ai",u.path.hasPrefix("/api/documents/") {
                ProbeLog.shared.add(["kind":"first_party_document_policy","url":u.absoluteString,"productionAllowed":policy == .allow]);decisionHandler(.cancel)
            } else {decisionHandler(policy)}
        }
    }
    func webView(_ webView:WKWebView,decidePolicyFor response:WKNavigationResponse,decisionHandler:@escaping(WKNavigationResponsePolicy)->Void){production.webView(webView,decidePolicyFor:response,decisionHandler:decisionHandler)}
    func webView(_ webView:WKWebView,didFinish navigation:WKNavigation!){
        guard !started else{return};started=true
        ProbeLog.shared.add(["kind":"loaded_fixture","url":webView.url?.absoluteString ?? "nil"])
        Task { @MainActor in
            let cases:[(String,String)] = [
                ("direct_bureau_portal","document.getElementById('bureau').click(); 'clicked'"),
                ("direct_bureau_upload","document.getElementById('upload').click(); 'clicked'"),
                ("blank_then_bank","(() => {const w=window.open('about:blank','_blank'); if(w){w.opener=null;setTimeout(()=>w.location.href='https://bank.example.invalid/apply',20);} return !!w;})()"),
                ("blank_then_document","(() => {const w=window.open('about:blank','_blank'); if(w){w.opener=null;setTimeout(()=>w.location.href='https://fundhub.ai/api/documents/synthetic?exp=2000000000&sig=synthetic-fixture',20);} return !!w;})()"),
                ("direct_signed_document","document.getElementById('document').click(); 'clicked'"),
                ("direct_bank","document.getElementById('bank').click(); 'clicked'")
            ]
            for (label,script) in cases {
                do { let value=try await webView.evaluateJavaScript(script);ProbeLog.shared.add(["kind":"javascript_result","case":label,"result":value ?? "nil"])}
                catch{ProbeLog.shared.add(["kind":"javascript_error","case":label,"message":error.localizedDescription])}
                try? await Task.sleep(nanoseconds:400_000_000)
            }
            ProbeLog.shared.add(["kind":"complete","caseCount":cases.count])
        }
    }
}
@main
final class ProbeApp: UIResponder,UIApplicationDelegate {
    func application(_ application:UIApplication,didFinishLaunchingWithOptions options:[UIApplication.LaunchOptionsKey:Any]?) -> Bool {
        if let original=class_getInstanceMethod(UIApplication.self,#selector(UIApplication.open(_:options:completionHandler:))),let replacement=class_getInstanceMethod(UIApplication.self,#selector(UIApplication.probeOpen(_:options:completionHandler:))){method_exchangeImplementations(original,replacement)}
        return true
    }
    func application(_ application:UIApplication,configurationForConnecting connectingSceneSession:UISceneSession,options:UIScene.ConnectionOptions)->UISceneConfiguration {
        let config=UISceneConfiguration(name:"Probe",sessionRole:connectingSceneSession.role);config.delegateClass=ProbeScene.self;return config
    }
}
final class ProbeScene: UIResponder,UIWindowSceneDelegate {
    var window:UIWindow?
    let navigation=ProbeNavigation()
    func scene(_ scene:UIScene,willConnectTo session:UISceneSession,options connectionOptions:UIScene.ConnectionOptions) {
        guard let windowScene=scene as? UIWindowScene else{return}
        let config=WKWebViewConfiguration();config.preferences.javaScriptCanOpenWindowsAutomatically=true
        let web=WKWebView(frame:.zero,configuration:config);web.navigationDelegate=navigation;web.uiDelegate=navigation.production
        let controller=UIViewController();controller.view=web;window=UIWindow(windowScene:windowScene);window?.rootViewController=controller;window?.makeKeyAndVisible()
        web.loadHTMLString("""
        <!doctype html><meta name="viewport" content="width=device-width"><h1>Synthetic native compatibility proof</h1>
        <a id="bureau" target="_blank" href="https://www.experian.com/help/dispute-credit/">Bureau portal</a>
        <a id="upload" target="_blank" href="https://www.experian.com/consumer/upload/">Supporting documents</a>
        <a id="document" target="_blank" href="https://fundhub.ai/api/documents/synthetic?exp=2000000000&amp;sig=synthetic-fixture">Scoped document</a>
        <a id="bank" target="_blank" href="https://bank.example.invalid/apply">Synthetic bank</a>
        """,baseURL:URL(string:"https://fundhub.ai/app/native-compatibility-fixture.html"))
    }
}
