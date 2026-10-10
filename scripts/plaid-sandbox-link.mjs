#!/usr/bin/env node
// Link a Plaid SANDBOX bank to one client, with no browser, save its accounts,
// then pull its charges and deposits.
//
//   node scripts/plaid-sandbox-link.mjs --client <uuid> [--preset mixed|good] [--no-sync]
//
// --preset mixed (default): test bank v3 (src/banking/plaid-sandbox-user.mjs) —
//   personal checking, business checking, a personal credit card and a business
//   credit card, three months of charges and deposits whose sum IS each
//   balance, and card liability data. (The FinanceOS test client itself is
//   linked by scripts/finance-os-sample-v3.mjs, which also closes bank v2.)
// --preset good: Plaid's stock user_good at First Platypus Bank.
// --no-sync: link only; do not pull transactions afterwards.
//
// Products are transactions + liabilities, so card due dates and minimums can
// be read with /liabilities/get.
//
// Refuses unless PLAID_ENV is sandbox. Reads DATABASE_URL and PLAID_* from env.
// Rows land with "(Plaid sandbox — test data)" on the institution name.
import pg from "pg";
import { sandboxPublicToken } from "../src/banking/providers/plaid-http.mjs";
import { completeLink } from "../src/banking/plaid-link.mjs";
import { syncClientTransactions } from "../src/banking/plaid-transactions.mjs";
import { buildMixedSandboxUser } from "../src/banking/plaid-sandbox-user.mjs";

const argv = process.argv.slice(2);
const args = Object.fromEntries(
  argv.reduce((acc, v, i, a) => (v.startsWith("--") ? [...acc, [v.slice(2), a[i + 1]]] : acc), [])
);
const clientId = args.client;
const preset = args.preset || "mixed";
const doSync = !argv.includes("--no-sync");
const env = process.env;

if ((env.PLAID_ENV || "sandbox") !== "sandbox") {
  console.error("PLAID_ENV is not sandbox — this script only links fake banks.");
  process.exit(1);
}
if (!clientId) { console.error("--client <uuid> is required"); process.exit(1); }
if (!env.DATABASE_URL) { console.error("DATABASE_URL is not set"); process.exit(1); }

const options = preset === "good"
  ? undefined
  : { override_username: "user_custom", override_password: JSON.stringify(buildMixedSandboxUser()) };

const institution = { institution_id: "ins_109508", name: "First Platypus Bank" };

const pt = await sandboxPublicToken({
  institutionId: institution.institution_id, products: ["transactions", "liabilities"], options
}, {
  environment: "sandbox", clientId: env.PLAID_CLIENT_ID, secret: env.PLAID_SECRET, env
});
if (!pt.ok) { console.error("Plaid sandbox refused:", pt.errorCode, pt.error); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const db = new pg.Pool({ connectionString: env.DATABASE_URL, max: 2 });
try {
  const client = await db.query(`SELECT id, org_id FROM clients WHERE id = $1`, [clientId]);
  if (!client.rows[0]) throw new Error(`no client ${clientId}`);
  const orgId = client.rows[0].org_id;
  const r = await completeLink(db, {
    orgId,
    clientId,
    publicToken: pt.publicToken,
    institution,
    asOf: new Date().toISOString(),
    env
  });
  if (!r.ok) { console.error("Link failed:", r.reason, r.error ?? "", r.missing ?? ""); process.exitCode = 1; }
  else {
    console.log(`Linked ${r.institutionName} → item ${r.itemRowId}, ${r.written} accounts:`);
    for (const a of r.accounts) {
      console.log(`  ${a.name} ••${a.mask}  ${a.account_type}/${a.account_subtype}  balance ${a.current_balance_cents}c  limit ${a.credit_limit_cents ?? "-"}`);
    }

    /* Plaid builds a new item's history in the background; the first sync can
       answer NOT_READY with nothing in it. Try a few times. Every row upserts,
       so trying again never doubles anything. */
    if (doSync) {
      for (let attempt = 1; attempt <= 6; attempt += 1) {
        const s = await syncClientTransactions(db, { orgId, clientId, env, asOf: new Date().toISOString() });
        if (!s.ok) {
          console.error("Sync failed:", s.reason, JSON.stringify((s.items ?? []).map((i) => [i.errorCode, i.error])));
          process.exitCode = 1;
          break;
        }
        const mine = s.items.find((i) => i.itemRowId === r.itemRowId);
        console.log(`Sync try ${attempt}: status ${mine?.updateStatus ?? "?"}, added ${mine?.added ?? 0}, written ${mine?.written ?? 0}, dropped ${JSON.stringify(mine?.dropped ?? {})}; all items written ${s.totals.written}`);
        if (mine && mine.written > 0) {
          console.log(`Bills: ${JSON.stringify(s.bills)}`);
          break;
        }
        await sleep(5000);
      }
    }
  }
} finally {
  await db.end();
}
