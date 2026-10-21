// lender-book: every hour, does the bank book read back, and does the bank match answer for a client?
//
// Same reads, same verdicts as the morning lane gap-crm-links.mjs. The truth lives in
// lib/lenders-truth.mjs: the real listLenders and matchForClient (the reads behind the money banks desk,
// the lender desk list and the client control panel's bank match), the pure matcher (lib/lender-match.mjs)
// and the credit-file readers it screens on (lib/lenders-credit.mjs). Nothing is copied: the product code
// (src/lenders/store.mjs, src/lenders/match.mjs) and the morning lane import the same files back.
//
//   crm-data:lenders          banks are on file and the bank list read returns banks
//   crm-data:lender-matches   for the newest real client, the bank match answers with a match list, and
//                             it does not call the book empty while banks are on file
//
// What it guards, and why it is on `covers` (the exact deep checks tripwires.mjs names):
//   desk:money-banks.html   crm-data:lenders, crm-data:lender-matches
// desk:lenders.html also names crm-data:lenders, but it names apply-links and bureau-config:complete too,
// and it is already the apply-links beat's surface, so it is not on `covers` here.
//
// The client it reads for is the lane's own pick (the newest client that is not a demo row). Reading a
// client's rows is all it does: no contact, no write. Read only: every read goes through ctx.read.

import { DEFAULT_ORG_SQL, SELF_TEST_NOW, SELF_TEST_ORG, runLaneBeat } from "./lib/money-hourly.mjs";
import { CHECK_IDS, CLIENT_PICK_SQL, LENDER_COUNT_SQL, readLenderBook } from "./lib/lenders-truth.mjs";

export const HOURLY_CHECK_IDS = CHECK_IDS;

export const LANE = Object.freeze({
  checks: Object.freeze(HOURLY_CHECK_IDS.map((checkId) => Object.freeze({ id: checkId, step: checkId.replaceAll(":", "-") }))),
  run: (io) => readLenderBook({ db: { query: (sql, params) => io.read(sql, params) }, orgId: io.orgId })
});

/* ── the self test: a fake database that answers each read the two checks make ── */

const SELF_TEST_CLIENT = "22222222-2222-4222-8222-222222222222";

const SELF_TEST_BANKS = Object.freeze([
  Object.freeze({ id: "b1", name: "Bank One", lender_table: "OnlineBizCC", active: true, priority_tier: 1, bureaus_pulled: "EX", eligible_states: "", is_demo: false }),
  Object.freeze({ id: "b2", name: "Bank Two", lender_table: "PersonalCC", active: true, priority_tier: 2, bureaus_pulled: "EQ", eligible_states: "", is_demo: false }),
  Object.freeze({ id: "b3", name: "Bank Three", lender_table: "PersonalLOC", active: true, priority_tier: 3, bureaus_pulled: "TU", eligible_states: "", is_demo: false })
]);

const squash = (sql) => String(sql).replace(/\s+/g, " ").trim();
const same = (a, b) => squash(a) === squash(b);

/** The answers a healthy book gives. `swap(sql)` may return rows (or throw) to change one answer. */
export function selfTestRead({ bankCount = SELF_TEST_BANKS.length, banks = SELF_TEST_BANKS, client = true, swap = null } = {}) {
  return async (sql) => {
    const text = squash(sql);
    const swapped = swap ? swap(text) : undefined;
    const rows = swapped !== undefined ? swapped
      : same(text, DEFAULT_ORG_SQL) ? [{ id: SELF_TEST_ORG }]
        : same(text, LENDER_COUNT_SQL) ? [{ n: bankCount }]
          : same(text, CLIENT_PICK_SQL) ? (client ? [{ id: SELF_TEST_CLIENT }] : [])
            : text.includes("SELECT demo_mode_enabled FROM orgs") ? [{ demo_mode_enabled: false }]
              : /FROM lenders WHERE org_id = \$1::uuid/.test(text) ? banks.map((bank) => ({ ...bank }))
                : /SELECT id, custom_fields FROM clients/.test(text) ? (client ? [{ id: SELF_TEST_CLIENT, custom_fields: {} }] : [])
                  : [];
    return { rows, rowCount: rows.length };
  };
}

const spec = (read) => ({ now: new Date(SELF_TEST_NOW.getTime()), read, env: {}, http: {} });

export const id = "lender-book";
export const title = "The bank book reads back and the bank match answers";
export const kind = "probe";
export const covers = ["desk:money-banks.html"];
export const box = false;
export const reads = [];
export const checkIds = HOURLY_CHECK_IDS;
export const steps = ["read", ...LANE.checks.map((check) => check.step)];
export const damp = 1;
export const deadlineMs = 10000;

export async function run(ctx) {
  return runLaneBeat(ctx, LANE, { noun: "lender book" });
}

export const fixGuide = [
  "The bank book is empty or will not read back, or the bank match for a client does not answer.",
  "",
  "Likely causes:",
  "- The lenders table was emptied, or every bank was marked demo, so the desk and the match have no bank to show.",
  "- A column the lender list selects (SELECT_COLS) was renamed or dropped, so the list read throws.",
  "- The bank match read for a client throws: a renamed column in clients, businesses, crs_results, inquiry_log or inquiry_removal_cases.",
  "",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs lender-book and read the red step: it names the read that failed.",
  "- Open the money banks desk and the client control panel for the newest client; the bank list should show.",
  "- Load the lender book on Lenders if it is empty (docs/legacy-strong/lenders-legacy-strong.csv, scripts/lenders-import-alec.mjs). Do not change rows from the pulse.",
  "Files: src/pulse/beats/lib/lenders-truth.mjs, src/pulse/beats/lib/lender-match.mjs, src/pulse/beats/lib/lenders-credit.mjs, src/lenders/store.mjs, src/pulse/coverage/gap-crm-links.mjs"
].join("\n");

export const selfTest = {
  pass: () => spec(selfTestRead()),
  // The book is empty: red at crm-data-lenders.
  fail: () => spec(selfTestRead({ bankCount: 0, banks: [] }))
};
