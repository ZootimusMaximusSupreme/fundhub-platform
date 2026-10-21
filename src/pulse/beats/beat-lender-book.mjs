// lender-book: every hour, is the bank book loaded, does the bank list read return banks, and does the
// bank match read answer for a client on file?
//
// Same SQL, same verdicts as the morning lane gap-crm-links.mjs (the truth lives in
// lib/crm-lenders-truth.mjs). Two checks:
//
//   crm-data:lenders          the bank book is empty, or banks are on file and the bank list read is empty
//   crm-data:lender-matches   the newest real client's bank match read throws, finds no such client, or
//                             says the book is empty while banks are on file
//
// THE READERS. The morning lane runs the real listLenders and matchForClient (src/lenders/store.mjs). A
// beat may import only from ./lib, so this beat runs lib/lender-store.mjs: those two readers and the
// lender matcher, copied word for word and held equal to the originals by lib/lender-store.test.mjs.
//
// NOTHING TO JUDGE IS NOT GREEN. With no real client on file, crm-data:lender-matches is skipped (the
// morning lane skips it too). The beat says so in its detail; it never counts that as a pass.
//
// What it guards (the exact deep checks src/pulse/tripwires.mjs names):
//   desk:money-banks.html   crm-data:lenders, crm-data:lender-matches
// desk:lenders.html also names apply-links and bureau-config:complete, which this beat does not run, so
// it is not on `covers`.
//
// Read only: every read goes through ctx.read (the read box). No send, no write, no web call. The match
// read selects the client's state from pii_identity.addresses, as the real reader does; nothing it reads
// is printed, only counts.

import { SELF_TEST_NOW, SELF_TEST_ORG, runLaneBeat } from "./lib/money-hourly.mjs";
import { LENDER_CHECK_IDS, runLenderBookChecks } from "./lib/crm-lenders-truth.mjs";
import { listLenders, matchForClient } from "./lib/lender-store.mjs";

export const HOURLY_CHECK_IDS = LENDER_CHECK_IDS;

/** The readers this beat hands the shared checks: the word-for-word copies in lib/lender-store.mjs. */
export const READERS = Object.freeze({ listLenders, matchForClient });

export const LANE = Object.freeze({
  checks: Object.freeze(HOURLY_CHECK_IDS.map((checkId) => Object.freeze({ id: checkId, step: checkId.replaceAll(":", "-") }))),
  run: async (io) => runLenderBookChecks({
    db: Object.freeze({ query: (sql, params) => io.read(sql, params) }),
    orgId: io.orgId,
    readers: READERS
  })
});

const SELF_TEST_CLIENT = "00000000-0000-4000-8000-0000000000c1";
const SELF_TEST_BANK = Object.freeze({
  id: "00000000-0000-4000-8000-0000000000b1",
  org_id: SELF_TEST_ORG,
  lender_table: "PersonalCC",
  name: "Self-test bank",
  eligible_states: "All",
  bureaus_pulled: "Experian",
  active: true,
  is_demo: false,
  priority_tier: 1
});

/**
 * Canned answers for every read the beat makes, so a self test fails loudly on a read nobody expected.
 * over: { count, list, active, client } changes one answer. Order matters: the first match answers.
 */
export function selfTestReads({ count = 3, list = [SELF_TEST_BANK], active = [SELF_TEST_BANK], client = true } = {}) {
  return [
    { match: /FROM orgs WHERE is_default/, rows: [{ id: SELF_TEST_ORG }] },
    { match: /SELECT demo_mode_enabled FROM orgs/, rows: [{ demo_mode_enabled: false }] },
    { match: /gap:crm-lender-count/, rows: [{ n: count }] },
    { match: /gap:crm-client\b/, rows: client ? [{ id: SELF_TEST_CLIENT }] : [] },
    { match: /FROM lenders[\s\S]*\bactive = \$2/, rows: active },
    { match: /FROM lenders/, rows: list },
    { match: /SELECT id, custom_fields\s+FROM clients/, rows: client ? [{ id: SELF_TEST_CLIENT, custom_fields: {} }] : [] },
    { match: /FROM businesses/, rows: [] },
    { match: /FROM pii_identity/, rows: [] },
    { match: /FROM crs_results/, rows: [] },
    { match: /FROM inquiry_log/, rows: [] },
    { match: /FROM inquiry_removal_cases/, rows: [] }
  ];
}

export function selfTestSpec(over = {}) {
  return { now: new Date(SELF_TEST_NOW.getTime()), read: selfTestReads(over), env: {}, http: {} };
}

export const id = "lender-book";
export const title = "Bank book loads and client bank matches answer";
export const kind = "probe";
export const covers = ["desk:money-banks.html"];
export const box = false;
export const reads = [];
export const checkIds = HOURLY_CHECK_IDS;
export const steps = ["read", ...LANE.checks.map((check) => check.step)];
export const damp = 1;
export const deadlineMs = 9000;

export async function run(ctx) {
  return runLaneBeat(ctx, LANE, { noun: "bank book" });
}

export const fixGuide = [
  "The bank book is empty or will not list, or the client bank match read broke.",
  "",
  "Likely causes:",
  "- The lender book was wiped or never loaded (it loads from docs/legacy-strong/lenders-legacy-strong.csv).",
  "- Every bank was marked inactive or demo, so the match read sees an empty book.",
  "- A column on lenders, clients, crs_results, inquiry_log or inquiry_removal_cases changed, so a read throws.",
  "",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs lender-book and read the red step: it names the count or the error.",
  "- Count active, non-demo rows in lenders for the default company. The loader is scripts/lenders-import-alec.mjs.",
  "- Open the client control panel bank list for the newest client. Do not change rows from the pulse.",
  "Files: src/pulse/beats/lib/crm-lenders-truth.mjs, src/pulse/beats/lib/lender-store.mjs, src/lenders/store.mjs, src/lenders/match.mjs, src/pulse/coverage/gap-crm-links.mjs"
].join("\n");

export const selfTest = {
  pass: () => selfTestSpec(),
  // The bank book is empty: the beat must stop at crm-data-lenders.
  fail: () => selfTestSpec({ count: 0, list: [], active: [] })
};
