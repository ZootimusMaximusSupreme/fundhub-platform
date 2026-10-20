// Company login emails. This is a login name, not a mailbox.
// A real inbox is a later add-on (Google Workspace costs money per seat).

export const COMPANY_EMAIL_DOMAIN = "fundhub.ai";

/* The catalog keys an owner may invite somebody into, plus the labels the
   Staff screen prints for them. A label folds to a key by lower-casing and
   turning runs of whitespace into underscores, so most roles need only one
   entry — "Funding Advisor" already folds to funding_advisor.

   csm is the exception and needs both spellings. Its catalog key is the
   three-letter abbreviation (db/migrations/290_csm_role.sql) while its printed
   name is "Client Success Manager", and those do not fold onto each other.
   Without the alias, an owner choosing Client Success Manager on the Staff
   screen gets `unknown_role` from POST /api/auth/invite and no CSM can be
   created through the app at all — measured live 2026-09-17, when the only
   staff row holding role='csm' in production was the seeded demo one, which
   refuses to authenticate (src/auth/demo-logins.mjs).

   This widens WHO MAY BE CREATED, not what anybody may reach. Every gate the
   role passes through was already open to it before this line existed:
   staff_roles carries csm as active, ROLE_SETS.STAFF in src/http/read-api.mjs
   lists it, and shell.js ROLE_TABS maps it. This was the one place that did
   not, and it sat on the creation path rather than on an access path. */
const ROLE_KEYS = {
  owner: "owner",
  admin: "admin",
  closer: "closer",
  funding_advisor: "funding_advisor",
  inquiry_specialist: "inquiry_specialist",
  setter: "setter",
  sales_manager: "sales_manager",
  outbound_rep: "outbound_rep",
  csm: "csm",
  client_success_manager: "csm"
};

export function staffRoleKey(label) {
  const raw = String(label || "").trim().toLowerCase().replace(/\s+/g, "_");
  return ROLE_KEYS[raw] || null;
}

function slugPart(s) {
  return String(s || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 32);
}

// "Sam Rivera" → sam.rivera@fundhub.ai
// If that login is taken → sam.rivera2@fundhub.ai, then 3, …
export function suggestCompanyEmail(name, taken = []) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  const first = slugPart(parts[0] || "");
  const last = slugPart(parts.slice(1).join(" ") || "");
  const base = [first, last].filter(Boolean).join(".") || "staff";
  const used = new Set(
    (taken || []).map((e) => String(e || "").trim().toLowerCase()).filter(Boolean)
  );
  let n = 0;
  for (;;) {
    const local = n === 0 ? base : base + String(n + 1);
    const email = `${local}@${COMPANY_EMAIL_DOMAIN}`;
    if (!used.has(email)) return email;
    n += 1;
    if (n > 99) return `${base}.${Date.now()}@${COMPANY_EMAIL_DOMAIN}`;
  }
}
