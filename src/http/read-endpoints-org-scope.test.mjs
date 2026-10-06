// EVERY STAFF-FACING READ ENDPOINT MUST SCOPE TO THE CALLER'S COMPANY.
//
// *** WHY THIS IS A SOURCE-LEVEL TEST AND NOT A HANDLER TEST. ***
//
// Each api/read/*.mjs module ends with
//
//   export default (req, res) => run(req, res, { db, requireAuth });
//
// which closes over the REAL database handle imported at the top of the file.
// A test cannot inject a recording stub through that closure, so the SQL a
// handler issues cannot be observed without a live database and a real session.
// That is exactly the gap C1 lived in: twelve endpoints, no test that could see
// their WHERE clause, and a comment in src/http/read-api.mjs:150-153 recording
// that scoping was each endpoint's own job — a decision that then went
// unimplemented in ten of them while the comment sat there reading as if it had
// been done.
//
// So this test reads the source. It is a lint with a reason, and it is the only
// shape that catches the NEXT endpoint before it ships rather than after.
//
//
// *** WHAT C1 ACTUALLY WAS. ***
//
// Every table records which company owns each row. Every signed-in request
// already knows which company the caller works for. Almost no staff-facing read
// compared the two. With one company in the database nothing leaks. The day a
// second company exists — an INSERT, not a code change — an employee of company
// A lists documents with no client id, gets rows for every company each
// carrying a client_id, and reads that consumer's credit file, bank balances,
// commissions and dispute history by passing the id back to the next endpoint.
// Nothing in this repository fails when that day arrives, which is why it needs
// a test and not a note.
//
//
// *** THE ALLOW-LIST IS THE POINT, AND IT IS DELIBERATELY SHORT. ***
//
// A few reads genuinely have no company column. They are named here one by one,
// each with the reason it is safe, so that adding to this list is a visible act
// somebody has to justify in a diff. An endpoint that is merely INCONVENIENT to
// scope does not belong here.

import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const READ_DIR = path.join(HERE, "..", "..", "api", "read");

/* Endpoints that legitimately carry no org filter. Each needs a stated reason.
   Keep this list SHORT and keep every entry's justification true. */
const NO_ORG_COLUMN = new Map([
  /* These two write no SQL of their own. Both call listTradelines() from
     src/tradelines/store.mjs and pass `orgId: staff.org_id` from the session,
     and that function THROWS when the org is missing rather than quietly
     dropping the clause (src/tradelines/store.mjs:83-91) — which is a stronger
     guarantee than a WHERE clause a future edit could delete unnoticed.
     Verified by reading both files, not assumed from the filename. */
  ["tradelines.mjs", "scoped in src/tradelines/store.mjs listTradelines(), which throws without an org"],
  ["finance-os.mjs", "scoped in src/tradelines/store.mjs listTradelines(), which throws without an org"],
  /* Writes no SQL of its own either. All four of its reads go through
     src/contracts/: listTemplates() and listContracts() THROW without an org
     (src/contracts/templates.mjs, src/contracts/send.mjs), and getTemplate()
     and getContract() bind `org_id = $2::uuid`, where a NULL matches no row —
     so both shapes fail CLOSED. The handler additionally refuses a session with
     no org with a 400 before any branch runs. Unlike its two neighbours above,
     the outcome is also proved against a real second company with real sessions
     in src/http/contracts-endpoints.pg.test.mjs ("one company cannot reach
     another company's contracts"), rather than argued from the source. Verified
     by reading the files, not assumed from the filename. */
  ["contracts.mjs", "scoped in src/contracts/: the list functions throw without an org, the id lookups bind org_id = $2"],
  /* Company Brain reads write no SQL in the handler. Both pass session
     `orgId: staff.org_id` into retrieveChunks / retrieveAffiliateChunks, which
     bind `c.org_id = $1` and refuse a missing org (src/company-brain/retrieve.mjs).
     Verified by reading those files, not assumed from the filename. */
  ["company-brain.mjs", "scoped in src/company-brain/retrieve.mjs retrieveChunks(), which binds c.org_id = $1 and refuses without an org"],
  ["company-brain-affiliate.mjs", "scoped in src/company-brain/retrieve.mjs retrieveAffiliateChunks(), which binds c.org_id = $1 and refuses without an org"],
  /* Sales dashboards — handlers write no SQL. They pass session orgId into
     src/sales/cockpit.mjs and src/sales/metrics.mjs, which bind org_id on every
     query and refuse a missing org at the handler (403). Verified by reading
     those modules, not assumed from the filename. */
  ["closer-call.mjs", "scoped in src/sales/cockpit.mjs buildCockpit() — every query binds org_id from the session"],
  ["closer-now.mjs", "scoped in src/sales/closer-now.mjs closerNow() — every query binds org_id from the session"],
  ["deal-math.mjs", "no SQL — dealMath() computes from query params and throws without orgId; handler passes orgId: staff.org_id"],
  ["my-numbers.mjs", "scoped in src/sales/metrics.mjs closerMyNumbers() — every query binds org_id from the session"],
  ["sales-floor.mjs", "scoped in src/sales/metrics.mjs salesFloor() — every query binds org_id from the session"],
  ["unrecorded-calls.mjs", "scoped in src/sales/unrecorded.mjs listUnrecordedCalls(), which binds o.org_id = $1 and returns [] without an org"],
  ["ops-pulse.mjs", "scoped in src/ops/pulse.mjs computePulse() — every query binds org_id from the session"],
  ["closer-deck.mjs", "scoped in src/sales/closer-deck.mjs buildCloserDeck() — every query binds org_id from the session"],
  /* Lender reads write no SQL in the handler. listLenders / matchForClient /
     listObservations in src/lenders/store.mjs always bind org_id = $1::uuid from
     the session org passed by the handler (which also 403s when org is missing). */
  ["lenders.mjs", "scoped in src/lenders/store.mjs listLenders(), which binds org_id = $1::uuid"],
  ["lender-matches.mjs", "scoped in src/lenders/store.mjs matchForClient(), which binds org_id on clients/inquiry_log/lenders"],
  ["lender-observations.mjs", "scoped in src/lenders/store.mjs listObservations(), which binds org_id = $1::uuid"],
  /* Parallel inquiry-ops session: handlers delegate to store modules that bind org_id. */
  ["ai-bureau-config.mjs", "scoped in src/inquiry-ops/ai-bureau-config.mjs listAiBureauConfig(), which binds org_id"],
  ["inquiry-cases.mjs", "scoped in src/inquiry-ops/cases.mjs listCases/getActiveCaseForClient, which bind org_id"],
  ["repair-cases.mjs", "scoped in src/repair/cases.mjs listRepairCases/getRepairCase, which bind org_id"],
  /* Oxylabs Apply audit log — handler delegates to src/proxy/sessions.mjs which
     binds org_id = $1::uuid on every list/get. */
  ["proxy-sessions.mjs", "scoped in src/proxy/sessions.mjs listProxySessions/getProxySession, which bind org_id = $1::uuid"],
  /* Agent shadow log — handler delegates to listShadow which binds org_id = $1. */
  ["agent-shadow-log.mjs", "scoped in src/agents/shadow-log.mjs listShadow(), which binds org_id = $1 and throws without an org"],
  /* Galaxy presence feed — handler writes no SQL. companyActivity() in
     src/galaxy/company-activity.mjs binds org_id = $1 on every query and throws
     without an org. Verified by reading that module, not assumed from the name. */
  ["company-activity.mjs", "scoped in src/galaxy/company-activity.mjs companyActivity(), which binds org_id = $1 and throws without an org"],
  /* Customer insight interviews — handler writes no SQL. listInsights() in
     src/insights/store.mjs binds org_id = $1 and throws without an org. */
  ["customer-insights.mjs", "scoped in src/insights/store.mjs listInsights(), which binds org_id = $1 and throws without an org"],
  /* Owner SLO map — handler writes no SQL. listConnections() in
     src/slo/connections.mjs binds org_id = $1::uuid and returns [] without an org. */
  ["slo-connections.mjs", "scoped in src/slo/connections.mjs listConnections(), which binds org_id = $1::uuid and returns [] without an org"],
  /* Ad books — the roll-up SQL lives in src/ads/store.mjs adAttributionRollup(),
     which binds a.org_id = $1 from the session and returns [] without an org. */
  ["ad-books.mjs", "scoped in src/ads/store.mjs adAttributionRollup(), which binds a.org_id = $1 and returns [] without an org"],
  /* Blueprint combined approval — handler writes no SQL. requireClientInOrg()
     checks the client is in the caller's company first, then
     loadCombinedApproval() in src/blueprint/credit-partner.mjs binds
     org_id = $1::uuid on the link read and on the clients read. Read 2026-10-05. */
  ["blueprint-combined-approval.mjs", "scoped by requireClientInOrg() and src/blueprint/credit-partner.mjs loadCombinedApproval(), which binds org_id = $1::uuid on every query"],
  /* EEO aggregates — handler writes no SQL. fetchEeoAggregate() in
     src/hiring/eeo-selfid.mjs binds org_id = $1::uuid and returns [] without an
     org. Until 2026-10-05 it took no org at all and returned every company's
     aggregates; this file is what caught it. */
  ["eeo-aggregate.mjs", "scoped in src/hiring/eeo-selfid.mjs fetchEeoAggregate(), which binds org_id = $1::uuid and returns [] without an org"],
]);

/* An allow-listed endpoint must still prove it hands the SESSION's org to
   whatever does its scoping. Without this, "it's scoped in the store" becomes
   an unfalsifiable claim that survives the call site being changed. */
const DELEGATES_SESSION_ORG = /orgId:\s*(?:staff|principal)\.org_id/;

/* COMMENTS ARE STRIPPED BEFORE ANY MATCHING, and that is not tidiness.
   Every fix in this area carries a long comment QUOTING the defective SQL it
   replaced — including the literal `org_id = (SELECT id FROM orgs WHERE
   is_default LIMIT 1)`. Matching raw source therefore fails a file for
   documenting the bug it fixed, which would teach the next person to delete the
   explanation to get the suite green. Match the code; read the prose. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")   // block comments, including the quoted SQL
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1"); // line comments, without eating https://
}

function readEndpointFiles() {
  if (!fs.existsSync(READ_DIR)) return [];
  return fs.readdirSync(READ_DIR)
    .filter((f) => f.endsWith(".mjs"))
    .map((f) => {
      const raw = fs.readFileSync(path.join(READ_DIR, f), "utf8");
      return { name: f, source: raw, code: stripComments(raw) };
    });
}

/* An endpoint counts as scoped when its SQL compares org_id to a BOUND
   PARAMETER. Two things are checked and both matter:

     org_id = $N        the column is actually in a WHERE/AND clause
     $N is a parameter  never an interpolated string, and never a subselect
                        like `(SELECT id FROM orgs WHERE is_default)`, which is
                        what audit M3 found on three endpoints — they filtered
                        by org, just always the WRONG one.

   The default-org subselect is called out explicitly below because it LOOKS
   like scoping in a casual read and is the exact bug M3 described.

   A placeholder is written two ways in this codebase and BOTH are parameters:

     org_id = $4::uuid          a literal hole, the common case
     org_id = ${orgIdHole}      a hole computed in JS, used where the index
                                depends on how many the scope predicate took
                                (api/read/partners.mjs). The interpolated value
                                is always `$` + a number — never a caller value —
                                and the surrounding params.push() is what this
                                test's sibling cases cover. */
const SCOPED = /org_id\s*=\s*(\$\d+|\$\{[A-Za-z_$][\w$]*\})/;
const DEFAULT_ORG_SUBSELECT = /org_id\s*=\s*\(\s*SELECT[^)]*is_default/i;

test("every read endpoint scopes to the caller's company", () => {
  const files = readEndpointFiles();
  assert.ok(files.length > 0, "no endpoints found under api/read — did the path move?");

  const unscoped = files
    .filter((f) => !NO_ORG_COLUMN.has(f.name))
    .filter((f) => !SCOPED.test(f.code))
    .map((f) => f.name);

  assert.deepEqual(
    unscoped, [],
    "these read endpoints issue SQL with no `org_id = $N` clause. Every table they " +
    "read records its owning company and every request knows the caller's company; " +
    "without the comparison, any employee of company A can read company B's rows by " +
    "passing an id. Add the filter, binding the org from the SESSION (never from the " +
    "query string), or — only with a stated reason — add the file to NO_ORG_COLUMN " +
    "above. This is audit finding C1."
  );
});

test("an endpoint excused from the org filter still passes the session's org to its store", () => {
  const files = readEndpointFiles();
  const excused = files.filter((f) => NO_ORG_COLUMN.has(f.name));

  assert.equal(
    excused.length, NO_ORG_COLUMN.size,
    "NO_ORG_COLUMN names a file that no longer exists under api/read — remove the entry " +
    "rather than leaving an excuse attached to nothing."
  );

  const notDelegating = excused
    .filter((f) => !DELEGATES_SESSION_ORG.test(f.code))
    .map((f) => f.name);

  assert.deepEqual(
    notDelegating, [],
    "these endpoints are excused from writing an org filter because their store applies " +
    "one, but they no longer pass `orgId: staff.org_id` to it. The excuse and the code " +
    "have drifted apart, which means the endpoint is now unscoped while this test says " +
    "it is fine."
  );
});

test("no read endpoint filters on the DEFAULT company instead of the caller's", () => {
  const files = readEndpointFiles();

  const defaulted = files
    .filter((f) => DEFAULT_ORG_SUBSELECT.test(f.code))
    .map((f) => f.name);

  assert.deepEqual(
    defaulted, [],
    "these endpoints filter by company using a hardcoded lookup of the DEFAULT " +
    "company rather than the caller's. That is worse than no filter in one respect: " +
    "it reads as scoped. Once a second company exists its staff see company A's rows " +
    "and none of their own, which gets reported as 'my list is empty' — not the " +
    "symptom that matters. This is audit finding M3."
  );
});

/* The org must come from the authenticated session. An org read off the query
   string is not a scope, it is a parameter the caller chooses — and a caller
   who chooses their own tenancy has none.

   Checked as a separate case so the failure names the real problem: an endpoint
   can satisfy the first test and still be wide open this way. */
test("no read endpoint takes the company from the query string", () => {
  const files = readEndpointFiles();

  const fromQuery = files
    .filter((f) => /query\.org_id|query\.orgId/.test(f.code))
    .map((f) => f.name);

  assert.deepEqual(
    fromQuery, [],
    "these endpoints read the company from the request's query string. Tenancy must " +
    "come from the session, which the caller cannot edit. An org id a caller can " +
    "choose is an org id a caller can lie about."
  );
});
