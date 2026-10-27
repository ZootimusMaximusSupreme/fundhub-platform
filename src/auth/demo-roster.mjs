// The nine demo logins, as data.
//
// WHY THIS EXISTS. There are nine roles in public/app/shell.js ROLE_TABS
// (shell.js:120) and, before this file, not one account existed to sign in as.
// The owner could not open the affiliate portal or the white-label partner
// portal to look at them, because he could not get past the login form. Every
// review of every screen was blocked behind that.
//
// WHY A MODULE AND NOT JUST SQL. Same reason src/auth/seed-staff.mjs keeps
// FOUNDING_STAFF as an exported array: a roster that is data can be asserted in
// a test without a database. src/http/demo-logins.test.mjs reads this list and
// public/app/shell.js side by side and fails if a role here is not a role the
// shell grants tabs to — which is the mistake that would produce a demo account
// that signs in and then bounces straight back to the login page.
//
// THE SQL IS STILL THE AUTHORITY for what is actually in the database:
// db/migrations/094_demo_logins.sql writes the rows. This module and that file
// must agree, and the test above is what keeps them agreeing.
//
// ─────────────────────────────────────────────────────────────────────────────
// THESE ARE NOT REAL PEOPLE AND MUST NEVER LOOK LIKE THEM.
//
//   · every address is on demo.fundhub.local — a reserved-style .local name
//     that resolves nowhere and can never receive mail, so one of these can
//     never be confused with an employee's or a customer's address;
//   · every name starts with "DEMO ", so a demo row in a staff list, a client
//     list or an assignment dropdown reads as a demo row at a glance;
//   · every row carries is_demo = true (094), so the refusal in
//     src/auth/demo-logins.mjs can key on the ROW and not merely on a string
//     match against the address.
//
// The failure this is written against: a demo account that quietly survives to
// production, on a system holding real consumer-finance customers, and is
// discovered by somebody signing in as "owner" with a password printed on the
// login page. DEMO_LOGINS_ENABLED is the switch that makes that impossible;
// this naming is what makes it obvious before anybody has to look for the
// switch.
// ─────────────────────────────────────────────────────────────────────────────

/** The domain every demo address lives on. Nothing else may use it. */
export const DEMO_EMAIL_DOMAIN = "demo.fundhub.local";

/** One shared password across all nine, printed on the login page on purpose —
 *  the owner is switching between nine portals in one sitting and typing nine
 *  different passwords is how that review session stops.
 *
 *  Sixteen characters because src/auth/hash.mjs:MIN_PASSWORD_LENGTH is 12 and
 *  hashPassword() throws below it. (Note for whoever hits this next: the
 *  "demo1234" pre-filled in public/login.html before this change was 8
 *  characters, so it could never have been seeded by hashPassword at all.) */
export const DEMO_PASSWORD = "demo-portal-2026";

// ─────────────────────────────────────────────────────────────────────────────
// `label` AND `portal` ARE THE SWITCHER'S BUTTON TEXT, AND THEY ARE HERE ON
// PURPOSE.
//
// The owner's actual workflow is: open a portal, look at it, judge it, switch to
// the next one, repeat — nine times in one sitting. A button that says "setter"
// asks him to know what a setter sees before he clicks it; a button that says
// "Setter — Setter Dashboard" tells him what opens. So every entry carries the role in
// his words (`label`) and the SCREEN NAME it opens (`portal`, taken verbatim
// from that file's <title>), and public/login.html renders them as
// "<label> — <portal>".
//
// `lands` stays the machine half and must equal public/app/shell.js HOME[role].
// src/http/demo-logins.test.mjs parses that map out of the shell and fails if
// the two disagree, because a button that signs in and then lands somewhere the
// role cannot open bounces back to the login page — which reads as "the login is
// broken" and is not.
// ─────────────────────────────────────────────────────────────────────────────

/** The six employees. `role` values are the catalog keys from
 *  db/schema/020_auth.sql and must match public/app/shell.js ROLE_TABS exactly —
 *  the shell folds with lower(btrim()) and an unrecognised role falls back to
 *  the shared staff tabs, which would silently hide the very thing being
 *  reviewed. */
export const DEMO_STAFF = Object.freeze([
  { email: `owner@${DEMO_EMAIL_DOMAIN}`,   role: "owner",              name: "DEMO Owner",              lands: "pipeline.html",         label: "Owner",             portal: "Pipeline" },
  { email: `admin@${DEMO_EMAIL_DOMAIN}`,   role: "admin",              name: "DEMO Admin",              lands: "pipeline.html",         label: "Admin",             portal: "Pipeline" },
  { email: `advisor@${DEMO_EMAIL_DOMAIN}`, role: "funding_advisor",    name: "DEMO Funding Advisor",    lands: "client-control-panel.html", label: "Funding advisor",   portal: "Client Control Panel" },
  { email: `closer@${DEMO_EMAIL_DOMAIN}`,  role: "closer",             name: "DEMO Closer",             lands: "closer-dashboard.html", label: "Closer",            portal: "Closer Dashboard" },
  { email: `inquiry@${DEMO_EMAIL_DOMAIN}`, role: "inquiry_specialist", name: "DEMO Specialist", lands: "inquiry-remover.html",  label: "Specialist", portal: "Inquiries and repair" },
  { email: `setter@${DEMO_EMAIL_DOMAIN}`,  role: "setter",             name: "DEMO Setter",             lands: "setter-dashboard.html", label: "Setter",            portal: "Setter Dashboard" },
  { email: `sales@${DEMO_EMAIL_DOMAIN}`,   role: "sales_manager",      name: "DEMO Sales Manager",      lands: "sales-floor.html",      label: "Sales manager",     portal: "Sales floor" },
  /* Lands on the CSM's own call queue, not on the client chooser. This must
     stay equal to public/app/shell.js HOME.csm — see the note above. */
  { email: `csm@${DEMO_EMAIL_DOMAIN}`,     role: "csm",                name: "DEMO Client Success Manager", lands: "csm-queue.html", label: "Client success",    portal: "Client Success" },
  { email: `outbound@${DEMO_EMAIL_DOMAIN}`, role: "outbound_rep",       name: "DEMO Outbound Rep", lands: "bank-outreach.html", label: "Outbound rep", portal: "Bank outreach" }
]);

/** The three principals who are not employees. These live in `accounts`
 *  (db/migrations/044_accounts.sql), not in `staff` — a client is not an
 *  employee, does not draw commission and must not appear in a staff list. Each
 *  one needs its SUBJECT row too (clients / affiliates / partners), because a
 *  principal with no subject id can see nothing: src/partners/scope.mjs refuses
 *  to build a query for a partner with no partnerId, by design. */
export const DEMO_ACCOUNTS = Object.freeze([
  { email: `client@${DEMO_EMAIL_DOMAIN}`,    kind: "client",    name: "DEMO Client",    lands: "client-portal.html",   label: "Client",              portal: "Client Portal" },
  { email: `affiliate@${DEMO_EMAIL_DOMAIN}`, kind: "affiliate", name: "DEMO Affiliate", lands: "affiliate.html",       label: "Affiliate",           portal: "Affiliate Portal" },
  { email: `partner@${DEMO_EMAIL_DOMAIN}`,   kind: "partner",   name: "DEMO Partner",   lands: "partner-galaxy.html",  label: "White-label partner", portal: "Partner Galaxy" }
]);

/** All nine, in the order the login page lists them. */
export const DEMO_LOGINS = Object.freeze([
  ...DEMO_STAFF.map((s) => ({ ...s, principal: "staff" })),
  ...DEMO_ACCOUNTS.map((a) => ({ ...a, role: a.kind, principal: a.kind }))
]);

/** Where /app/ lives. Split out so the one string the browser navigates to is
 *  built in one place rather than concatenated at four call sites. */
export const DEMO_APP_BASE = "/app/";

/**
 * demoSwitcherOptions() → the roster as the login page needs it, and NOTHING
 * ELSE.
 *
 * This is what GET /api/auth/login sends to the browser, so it is deliberately
 * a projection and not the roster object spread wholesale: `principal` and any
 * field added here later stay server-side unless somebody adds them on purpose.
 * The browser gets exactly the five things it renders and posts.
 *
 * `home` is absolute and pre-joined ("/app/affiliate.html") so the click handler
 * assigns it to location.href without doing any string work on a value that
 * came off the wire. A `lands` that is already absolute is used as-is; every
 * role currently uses a relative one under /app/.
 */
export function demoSwitcherOptions() {
  return DEMO_LOGINS.map((d) => ({
    role: d.role,
    email: d.email,
    name: d.name,
    label: d.label,
    portal: d.portal,
    home: d.lands.charAt(0) === "/" ? d.lands : DEMO_APP_BASE + d.lands
  }));
}

export default DEMO_LOGINS;
