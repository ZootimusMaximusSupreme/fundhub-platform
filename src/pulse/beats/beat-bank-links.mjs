// bank-links: every hour, are the client's bank logins and merchant connections still refreshing,
// and does every linked bank show on their money screen?
//
// Same SQL, same verdicts as the morning lanes gap-bank-links.mjs and gap-banks.mjs (the truth lives
// in lib/bank-links-truth.mjs and lib/banks-truth.mjs). Five reads of counts. No Plaid call, no token
// exchange; the access token column is never selected.
//
//   banks:login-broken             a bank login in error over a day, and nobody told the client
//   banks:merchant-sync            a live merchant pull connection with an error or no sync in 2 days
//   banks-sync-stale               a live bank login that has not synced in 3 days
//   banks-active-link-no-accounts  a live bank login with no open account under it
//   banks-linked-not-on-screen     a linked open account the money screen read would not return
// (banks-plaid-item-error stays daily: it counts old replaced logins, banks:login-broken judges the newest.)
//
// What it guards, and why each surface is on `covers` (the exact deep checks tripwires.mjs names):
//   job:plaid-transactions-sweeper, route:banking/sync-accounts,
//   route:banking/sync-transactions, route:banking/sync-liabilities   banks-sync-stale, banks:login-broken
//   job:merchant-pull-sweeper, desk:money-connections.html            banks:merchant-sync
//   desk:money-accounts.html          banks:login-broken, banks-linked-not-on-screen, banks-active-link-no-accounts
// route:banking/link-token, route:banking/link-exchange and route:money/connections also name
// keys:launch-secrets-present, which is not hourly yet, so they are not on `covers`.
//
// Read only: every read goes through ctx.read (the read box). No send, no write, no web call.

import { laneSelfTest, runLaneBeat } from "./lib/money-hourly.mjs";
import { LOGIN_SQL, MERCHANT_SQL, runBankLinkChecks } from "./lib/bank-links-truth.mjs";
import { EMPTY_SQL, HIDDEN_SQL, STALE_SQL, runBanksChecks } from "./lib/banks-truth.mjs";

export const LINK_CHECK_IDS = Object.freeze(["banks:login-broken", "banks:merchant-sync"]);
export const SCREEN_CHECK_IDS = Object.freeze(["banks-linked-not-on-screen", "banks-sync-stale", "banks-active-link-no-accounts"]);
export const HOURLY_CHECK_IDS = Object.freeze([...LINK_CHECK_IDS, ...SCREEN_CHECK_IDS]);

/**
 * The daily bank sync's schedule (src/workflows/plaid-transactions-sweeper.mjs SWEEP_CRON, red after
 * STALE_MULTIPLE runs per src/pulse/heartbeats.mjs). A beat cannot import those files, so the values are
 * carried here; beat-bank-links.test.mjs holds them equal to gap-banks.mjs SYNC_SCHEDULE.
 */
export const SYNC_SCHEDULE = Object.freeze({ redAfterMs: 3 * 24 * 60 * 60 * 1000, cron: "0 7 * * *", job: "plaid-transactions-sweeper" });

const ONE = (row) => Object.freeze([Object.freeze(row)]);
const PASS_ROWS = Object.freeze([
  Object.freeze([LOGIN_SQL, ONE({ banks: 3, broken: 0, in_error: 0, clients: 0, oldest: null, last_code: null })]),
  Object.freeze([MERCHANT_SQL, ONE({ live: 1, late: 0, errored: 0, quiet: 0, oldest: null, sample_error: null })]),
  Object.freeze([HIDDEN_SQL, ONE({ n: 0 })]),
  Object.freeze([STALE_SQL, ONE({ active_links: 3, stale_links: 0, oldest: null, last_code: null })]),
  Object.freeze([EMPTY_SQL, ONE({ clients: 0, items: 0 })])
]);

export const LANE = Object.freeze({
  checks: Object.freeze(HOURLY_CHECK_IDS.map((checkId) => Object.freeze({ id: checkId, step: checkId.replaceAll(":", "-") }))),
  run: async (io) => {
    const run = (fn) => fn({ query: (sql, params) => io.read(sql, params) });
    const links = await runBankLinkChecks({ run, now: io.now, orgId: io.orgId });
    const screen = await runBanksChecks({ run, now: io.now, orgId: io.orgId, schedule: SYNC_SCHEDULE }, { only: SCREEN_CHECK_IDS });
    return [...links, ...screen];
  },
  selfTest: Object.freeze({
    passRows: PASS_ROWS,
    // A live bank login has not synced in 4 days: the beat must stop at banks-sync-stale.
    failRows: Object.freeze([
      Object.freeze([STALE_SQL, ONE({ active_links: 3, stale_links: 1, oldest: "2026-10-05T19:07:00.000Z", last_code: "ITEM_LOGIN_REQUIRED" })])
    ])
  })
});

export const id = "bank-links";
export const title = "Client bank logins refresh and show on screen";
export const kind = "probe";
export const covers = [
  "job:plaid-transactions-sweeper",
  "route:banking/sync-accounts",
  "route:banking/sync-transactions",
  "route:banking/sync-liabilities",
  "job:merchant-pull-sweeper",
  "desk:money-connections.html",
  "desk:money-accounts.html"
];
export const box = false;
export const reads = [];
export const checkIds = HOURLY_CHECK_IDS;
export const steps = ["read", ...LANE.checks.map((check) => check.step)];
export const damp = 1;
export const deadlineMs = 9000;

export async function run(ctx) {
  return runLaneBeat(ctx, LANE, { noun: "bank" });
}

export const fixGuide = [
  "A client's bank login or merchant connection stopped refreshing, or a linked bank is missing from the screen.",
  "",
  "Likely causes:",
  "- The bank wants the client to sign in again (Plaid ITEM_LOGIN_REQUIRED) and nobody told them.",
  "- The daily bank sync or merchant pull sweeper skipped a login, or a processor key expired.",
  "- An account row was saved under a different client or company than its bank login.",
  "",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs bank-links and read the red step: it names the count, the age and the code.",
  "- Read plaid_items, bank_accounts and merchant connections for those clients. Never select or print a token.",
  "- Tell the client to connect the bank again, or open a staff task. Do not call Plaid or change rows from the pulse.",
  "Files: src/pulse/beats/lib/bank-links-truth.mjs, src/pulse/beats/lib/banks-truth.mjs, src/workflows/plaid-transactions-sweeper.mjs, src/workflows/merchant-pull-sweeper.mjs"
].join("\n");

export const selfTest = {
  pass: () => laneSelfTest(LANE),
  fail: () => laneSelfTest(LANE, true)
};
