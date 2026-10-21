// client-portal: every hour, do the customer pages load whole, does every paid client hold what they
// paid for, does the checklist open, do the portal summary reads run, and has every paying client
// signed in?
//
// Same SQL, same page reads, same verdicts as the morning lane gap-portal.mjs (the truth lives in
// lib/portal-truth.mjs). Five checks, side by side:
//   portal:page-scripts-load            the six customer pages and every script and style file they
//                                       name, read live with GET (a page over 64 KB is read to the end
//                                       in byte ranges; one that cannot be read whole is not judged)
//   portal:paid-entitlement             every paid mapped product has its entitlement row
//   portal:next-step                    a paid checklist client or repair enrolment has journey steps
//   portal:summary                      the reads that 500 the portal summary run for one client
//   portal:paid-client-never-signed-in  a paying client has held access for 72 hours and not signed in.
//                                       When every waiting client is on the owner's no-contact hold
//                                       (src/pulse/beats/lib/owner-hold.mjs, today Braum FH-000507), the
//                                       step is "nothing to judge", never red. Any other waiting client
//                                       makes it red by name count.
//
// What it guards, and why each surface is on `covers` (the exact deep checks tripwires.mjs names):
//   desk:client-portal.html     portal:page-scripts-load, portal:paid-entitlement, portal:next-step
//   route:read/portal-summary   portal:summary
//   route:read/entitlements     portal:paid-entitlement here; payments:paid-no-entitlement is the
//                               payments-paid-no-entitlement step of the pay-links beat
//   page:portal-login.html      portal:paid-client-never-signed-in here; gap:auth-magic-link-dead is the
//                               gap-auth-magic-link-dead step of the auth-links beat
// page:progress.html and route:read/client-progress name portal:progress-read-real-client, which runs
// the real src/progress/read.mjs (a beat may not import it, and the live door needs a signed-in client),
// so it stays on the morning pulse and those two are not on `covers`.
//
// Read only: every read goes through ctx.read (the read box), the web through ctx.http (GET, our own
// site only). No send, no write, no sign-in.

import { laneSelfTest, runLaneBeat } from "./lib/money-hourly.mjs";
import {
  CUSTOMER_PAGES, HOURLY_CHECK_IDS, NEVER_SIGNED_IN_SQL, PAID_ENTITLEMENT_SQL, PAGES_BUDGET_HOURLY_MS,
  SUMMARY_CLIENT_SQL, runPortalHourly, webFromProbe
} from "./lib/portal-truth.mjs";

export { HOURLY_CHECK_IDS };

/** The deep checks a covered surface names that run hourly in another beat: check id -> [beat id, step]. */
export const RUNS_ELSEWHERE = Object.freeze({
  "payments:paid-no-entitlement": Object.freeze(["pay-links", "payments-paid-no-entitlement"]),
  "gap:auth-magic-link-dead": Object.freeze(["auth-links", "gap-auth-magic-link-dead"])
});

const ONE = (row) => Object.freeze([Object.freeze(row)]);
const SELF_CLIENT = "22222222-2222-4222-8222-222222222222";
const SITE = "https://fundhub.ai";

/* A whole customer page for the self test: a title, the few things each page must keep, one script,
   one style file and the closing tag, padded past the 500-byte floor. Made-up text only. */
function selfTestPage(path) {
  const keeps = '<form><input type="email"><input type="password"></form><div data-tile="next"></div>';
  return `<!doctype html><html><head><title>Fundhub ${path}</title>` +
    `<link rel="stylesheet" href="/app/self-test.css"><script src="/app/self-test.js"></script></head>` +
    `<body>${keeps}<p>${"Your portal. ".repeat(60)}</p></body></html>`;
}

/** The self test's web: every customer page answers whole, and both of its files answer with content. */
export function selfTestHttp(method, url) {
  if (method !== "GET") return undefined;
  const { pathname } = new URL(url);
  if (CUSTOMER_PAGES.some((page) => page.path === pathname)) {
    return { status: 200, body: selfTestPage(pathname), headers: { "content-type": "text/html; charset=utf-8" } };
  }
  if (pathname === "/app/self-test.js") return { status: 200, body: "window.portal = 1;", headers: { "content-type": "application/javascript" } };
  if (pathname === "/app/self-test.css") return { status: 200, body: "body { margin: 0; }", headers: { "content-type": "text/css" } };
  return undefined;
}

export const LANE = Object.freeze({
  checks: Object.freeze(HOURLY_CHECK_IDS.map((checkId) => Object.freeze({ id: checkId, step: checkId.replaceAll(":", "-") }))),
  // The web comes from ctx.http in run() below; the self test's fake ctx answers it with selfTestHttp.
  run: (io) => runPortalHourly(io),
  selfTest: Object.freeze({
    passRows: Object.freeze([
      Object.freeze([PAID_ENTITLEMENT_SQL, ONE({ client_id: "c1", is_test: false, has_entitlement: true })]),
      Object.freeze([SUMMARY_CLIENT_SQL, ONE({ id: SELF_CLIENT })])
    ]),
    passHttp: selfTestHttp,
    // A real paying client (not on the owner's hold) has held access for 5 days and never signed in.
    failRows: Object.freeze([
      Object.freeze([NEVER_SIGNED_IN_SQL, ONE({
        client_id: "c9", client_code: "FH-000999", days_held: 5.2, is_test: false,
        paid_through_door: true, signed_in: false, asked_since_access: false
      })])
    ])
  })
});

export const id = "client-portal";
export const title = "Client portal pages load and paid clients get in";
export const kind = "probe";
export const covers = [
  "desk:client-portal.html",
  "route:read/portal-summary",
  "route:read/entitlements",
  "page:portal-login.html"
];
export const box = false;
export const reads = [{ host: "SITE", methods: ["GET"] }];
export const checkIds = HOURLY_CHECK_IDS;
export const steps = ["read", ...LANE.checks.map((check) => check.step)];
export const damp = 1;
export const deadlineMs = 12000;

export async function run(ctx) {
  const web = webFromProbe(ctx.http);
  const lane = Object.freeze({
    ...LANE,
    run: (io) => runPortalHourly({ read: io.read, orgId: io.orgId, web, baseUrl: io.baseUrl || SITE, budgetMs: PAGES_BUDGET_HOURLY_MS })
  });
  return runLaneBeat(ctx, lane, { noun: "portal" });
}

export const fixGuide = [
  "A customer page or file did not load, a paid client lacks access, or a paying client never got into the portal.",
  "",
  "Likely causes:",
  "- A deploy dropped a customer page or a script or style file it names, or a file now answers as a web page.",
  "- A payment succeeded but the entitlement row or the checklist was never written for that product.",
  "- A column or table the portal summary reads was renamed or dropped, so the summary answers 500.",
  "- A paying client got access but never used their sign-in link (the owner-hold client is never red).",
  "",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs client-portal and read the red step: it names the page, file, count or read.",
  "- Pages: open the named address; put the page or file back from git and ship once.",
  "- Access: read transactions, entitlements and client_waypoints for that client; use the existing reconcile.",
  "- Sign-in: send their sign-in link from the staff screen. Never contact FH-000507. Never fix from the pulse.",
  "Files: src/pulse/beats/lib/portal-truth.mjs, src/pulse/coverage/gap-portal.mjs, api/read/portal-summary.mjs, public/app/client-portal.html"
].join("\n");

export const selfTest = {
  pass: () => laneSelfTest(LANE),
  fail: () => laneSelfTest(LANE, true)
};
