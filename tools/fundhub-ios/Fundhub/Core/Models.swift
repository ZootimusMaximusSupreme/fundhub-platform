import Foundation

struct FundhubIdentity: Decodable, Equatable {
    let id: String?
    let name: String?
    let email: String?
    let role: String?
    let clientId: String?

    enum CodingKeys: String, CodingKey {
        case id, name, email, role
        case clientId = "client_id"
    }
}

struct LoginReply: Decodable {
    let ok: Bool
    let token: String?
    let principal: String?
    let account: FundhubIdentity?
    let staff: FundhubIdentity?
    let message: String?
}

struct SessionReply: Decodable {
    let ok: Bool
    let principal: String
    let staff: FundhubIdentity
}

struct PortalStage: Decodable {
    let key: String

    var title: String {
        switch key {
        case "booked": return "Getting started"
        case "soft_pull": return "Your file is being reviewed"
        case "call_held": return "Your call is complete"
        case "agreement_signed": return "Your agreement is signed"
        case "paid": return "Your payment is recorded"
        default: return "Your file is in progress"
        }
    }
}

struct PortalAdvisor: Decodable {
    let name: String
}

struct PortalInvoiceDue: Decodable {
    let count: Int
    let totalDisplay: String

    enum CodingKeys: String, CodingKey {
        case count
        case totalDisplay = "total_display"
    }
}

struct PortalDocument: Decodable, Identifiable {
    let id: String
    let title: String?
}

struct PortalSummary: Decodable {
    let ok: Bool
    let stage: PortalStage
    let advisor: PortalAdvisor?
    let documents: [PortalDocument]
    let invoiceDue: PortalInvoiceDue?

    enum CodingKeys: String, CodingKey {
        case ok, stage, advisor, documents
        case invoiceDue = "invoice_due"
    }
}

struct NativePushStatusReply: Decodable {
    let ok: Bool
    let configured: Bool
    let registered: Bool
}

struct NativePushWriteReply: Decodable {
    let ok: Bool
}

enum FundhubRole {
    static func workspacePath(principal: String, role: String?) -> String {
        guard principal == "staff" else { return "/app/client-portal.html" }
        switch role {
        case "funding_advisor": return "/app/client-control-panel.html"
        case "closer": return "/app/closer-dashboard.html"
        case "inquiry_specialist": return "/app/inquiry-remover.html"
        case "sales_manager": return "/app/sales-floor.html"
        case "csm": return "/app/csm-queue.html"
        default: return "/app/pipeline.html"
        }
    }

    static func title(_ role: String?) -> String {
        switch role {
        case "funding_advisor": return "Funding advisor"
        case "inquiry_specialist": return "Inquiry specialist"
        case "sales_manager": return "Sales manager"
        case "csm": return "Client success"
        case "closer": return "Closer"
        case "setter": return "Setter"
        case "admin": return "Admin"
        case "owner": return "Owner"
        default: return "Team member"
        }
    }
}

enum MagicLink {
    static func token(from pasted: String) -> String? {
        guard let url = URL(string: pasted.trimmingCharacters(in: .whitespacesAndNewlines)),
              url.scheme == "https", url.host == "fundhub.ai",
              url.path == "/portal-login.html",
              let token = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "t" })?.value,
              !token.isEmpty else { return nil }
        return token
    }
}
