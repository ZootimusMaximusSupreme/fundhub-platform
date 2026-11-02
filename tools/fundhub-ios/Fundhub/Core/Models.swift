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
    static func canRegisterNativePush(principal: String, role: String?) -> Bool {
        if principal == "client" { return true }
        guard principal == "staff", let role else { return false }
        return ["owner", "admin", "sales_manager", "setter", "closer", "outbound_rep",
                "inquiry_specialist", "funding_advisor", "csm"].contains(role)
    }

    static func workspacePath(principal: String, role: String?) -> String {
        guard principal == "staff" else { return "/app/client-portal.html" }
        switch role {
        case "setter": return "/app/setter-dashboard.html"
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

// HTTPS staff SMS links carry context, never authority or a bearer token.
// The existing dashboard APIs still enforce role, tenant and lead assignment.
enum StaffDashboardLink {
    static let lifetime: TimeInterval = 5 * 60

    struct Target: Equatable {
        let path: String
        let clientId: String
        var workspacePath: String { "\(path)?client_id=\(clientId)" }

        func permits(principal: String, role: String?) -> Bool {
            guard principal == "staff", let role else { return false }
            switch path {
            case "/app/setter-dashboard.html": return ["owner", "admin", "setter"].contains(role)
            case "/app/closer-dashboard.html": return ["owner", "admin", "sales_manager", "closer"].contains(role)
            default: return false
            }
        }
    }

    static func parse(_ url: URL) -> Target? {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme == "https", parts.host?.lowercased() == "fundhub.ai",
              parts.user == nil, parts.password == nil, parts.port == nil, parts.fragment == nil,
              ["/app/setter-dashboard.html", "/app/closer-dashboard.html"].contains(parts.percentEncodedPath),
              let items = parts.queryItems, items.count == 1, items[0].name == "client_id",
              let rawId = items[0].value, rawId.count == 36, let id = UUID(uuidString: rawId),
              parts.percentEncodedQuery == "client_id=\(rawId)" else { return nil }
        return Target(path: parts.percentEncodedPath, clientId: id.uuidString.lowercased())
    }

    struct Resolution {
        let target: Target
        let bearer: String
        let generation: Int
        var path: String { target.workspacePath }

        func isCurrent(bearer current: String?, generation currentGeneration: Int,
                       principal: String?, role: String?, verified: Bool,
                       taskCancelled: Bool) -> Bool {
            !taskCancelled && verified && current == bearer && currentGeneration == generation &&
                target.permits(principal: principal ?? "", role: role)
        }
    }

    struct Pending {
        let id: UUID
        let target: Target
        let receivedAt: Date
        let bearerAtReceipt: String?
    }

    struct Queue {
        private(set) var generation = 0
        private(set) var pending: Pending?
        private var lastDelivery: Pending?

        @discardableResult
        mutating func receive(_ url: URL, bearer: String?, now: Date = Date()) -> Bool {
            guard let target = StaffDashboardLink.parse(url) else { return false }
            // SwiftUI can deliver the same OS event to both URL/activity hooks.
            if let lastDelivery, lastDelivery.target == target,
               lastDelivery.bearerAtReceipt == bearer,
               (0...1).contains(now.timeIntervalSince(lastDelivery.receivedAt)) { return true }
            generation &+= 1
            let request = Pending(id: UUID(), target: target, receivedAt: now, bearerAtReceipt: bearer)
            pending = request
            lastDelivery = request
            return true
        }

        mutating func clear() {
            generation &+= 1
            pending = nil
            lastDelivery = nil
        }

        mutating func consume(requestId: UUID, generation expected: Int,
                              bearerAtStart: String, bearerAfterRefresh: String?,
                              principal: String?, role: String?, verified: Bool,
                              taskCancelled: Bool, now: Date = Date()) -> Resolution? {
            guard let request = pending, request.id == requestId, generation == expected else { return nil }
            // One attempt only, including a refused role. Never resurrect it on a later sign-in.
            pending = nil
            let age = now.timeIntervalSince(request.receivedAt)
            guard !taskCancelled, verified, !bearerAtStart.isEmpty,
                  bearerAfterRefresh == bearerAtStart,
                  request.bearerAtReceipt == nil || request.bearerAtReceipt == bearerAtStart,
                  age >= 0, age <= StaffDashboardLink.lifetime,
                  request.target.permits(principal: principal ?? "", role: role) else { return nil }
            return Resolution(target: request.target, bearer: bearerAtStart, generation: generation)
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
