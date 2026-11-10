import UIKit
import Capacitor
import AuthenticationServices
import StoreKit

/// The iPhone app's own view controller: the live site (capacitor.config.json
/// server.url) plus the native bits the site asks for through Capacitor:
///   AppleSignIn   Sign in with Apple (firebase.js finishes it with Firebase)
///   ExternalLink  opens a page in Safari (Grizzly checkout, Google sign-in)
class FTBViewController: CAPBridgeViewController {
    static let appURL = "https://www.feed-the-bear.com/app.html"

    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(AppleSignInPlugin())
        bridge?.registerPluginInstance(ExternalLinkPlugin())
    }

    /// What opens the app, routed into the site (like MainActivity.java on Android):
    ///   com.feedthebear.app://signin            back from Google sign-in in Safari
    ///   com.feedthebear.app://upgrade?...       back from Grizzly checkout in Safari
    ///   https://www.feed-the-bear.com/...       a Feed The Bear link
    func route(_ url: URL) {
        var target: String?
        if url.scheme == "com.feedthebear.app" {
            if url.host == "signin" {
                target = FTBViewController.appURL + "#native-signin-done"
            } else if url.host == "upgrade" {
                let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
                var parts = URLComponents(string: FTBViewController.appURL)
                parts?.queryItems = [URLQueryItem(name: "upgrade", value: query.first { $0.name == "status" }?.value ?? "success")]
                    + query.filter { $0.name == "session_id" }
                target = parts?.url?.absoluteString
            }
        } else if url.scheme == "https", url.host == "www.feed-the-bear.com" {
            target = url.absoluteString
        }
        guard let link = target, let dest = URL(string: link) else { return }
        DispatchQueue.main.async { self.bridge?.webView?.load(URLRequest(url: dest)) }
    }
}

@objc(AppleSignInPlugin)
public class AppleSignInPlugin: CAPPlugin, CAPBridgedPlugin, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    public let identifier = "AppleSignInPlugin"
    public let jsName = "AppleSignIn"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise),
    ]
    private var pending: CAPPluginCall?

    /// nonce: already SHA-256 hashed by firebase.js, which keeps the raw one for Firebase.
    @objc func signIn(_ call: CAPPluginCall) {
        let nonce = call.getString("nonce") ?? ""
        DispatchQueue.main.async {
            if let earlier = self.pending { earlier.reject("Sign-in was cancelled.", "canceled") }
            self.pending = call
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.fullName, .email]
            if !nonce.isEmpty { request.nonce = nonce }
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }

    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        return bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let call = pending else { return }
        pending = nil
        guard let cred = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = cred.identityToken,
              let idToken = String(data: tokenData, encoding: .utf8) else {
            call.reject("Apple did not send a sign-in token. Please try again.", "failed")
            return
        }
        let code = cred.authorizationCode.flatMap { String(data: $0, encoding: .utf8) } ?? ""
        let name = [cred.fullName?.givenName, cred.fullName?.familyName].compactMap { $0 }.joined(separator: " ")
        call.resolve(["idToken": idToken, "authorizationCode": code, "name": name, "email": cred.email ?? ""])
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        guard let call = pending else { return }
        pending = nil
        if let authError = error as? ASAuthorizationError, authError.code == .canceled {
            call.reject("Sign-in was cancelled.", "canceled")
            return
        }
        call.reject(error.localizedDescription, "failed")
    }
}

@objc(ExternalLinkPlugin)
public class ExternalLinkPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ExternalLinkPlugin"
    public let jsName = "ExternalLink"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestReview", returnType: CAPPluginReturnPromise),
    ]

    /// Opens an https page in Safari itself (not inside the app).
    @objc func open(_ call: CAPPluginCall) {
        guard let link = call.getString("url"), let url = URL(string: link), url.scheme == "https" else {
            call.reject("That link can't be opened.", "bad-url")
            return
        }
        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [:]) { ok in
                if ok { call.resolve() } else { call.reject("Safari could not open it.", "failed") }
            }
        }
    }

    /// Apple's own "Rate this app" card (iOS decides whether it shows).
    @objc func requestReview(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let scene = self.bridge?.viewController?.view.window?.windowScene {
                SKStoreReviewController.requestReview(in: scene)
            }
            call.resolve()
        }
    }
}
