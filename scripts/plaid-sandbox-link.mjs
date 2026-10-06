#!/usr/bin/env node
// Link a Plaid SANDBOX bank to one client, with no browser, and save its accounts.
//
//   node scripts/plaid-sandbox-link.mjs --client <uuid> [--preset mixed|good]
//
// --preset mixed (default): a custom sandbox user with personal checking,
//   business checking, a personal credit card and a business credit card.
// --preset good: Plaid's stock user_good at First Platypus Bank.
//
// Refuses unless PLAID_ENV is sandbox. Reads DATABASE_URL and PLAID_* from env.
// Rows land with "(Plaid sandbox — test data)" on the institution name.
import pg from "pg";
import { sandboxPublicToken } from "../src/banking/providers/plaid-http.mjs";
import { completeLink } from "../src/banking/plaid-link.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, v, i, a) => (v.startsWith("--") ? [...acc, [v.slice(2), a[i + 1]]] : acc), [])
);
const clientId = args.client;
const preset = args.preset || "mixed";
const env = process.env;

if ((env.PLAID_ENV || "sandbox") !== "sandbox") {
  console.error("PLAID_ENV is not sandbox — this script only links fake banks.");
  process.exit(1);
}
if (!clientId) { console.error("--client <uuid> is required"); process.exit(1); }
if (!env.DATABASE_URL) { console.error("DATABASE_URL is not set"); process.exit(1); }

/* Plaid sandbox custom user. Names say business/personal so a person can tell
   them apart on screen; entity_kind still stays 'unknown' until a human sets it. */
const MIXED = {
  override_accounts: [
    { type: "depository", subtype: "checking", starting_balance: 4210.55,
      meta: { name: "Personal Checking", mask: "1101" } },
    { type: "depository", subtype: "checking", starting_balance: 18750.0,
      meta: { name: "Business Checking", mask: "2202" } },
    { type: "credit", subtype: "credit card", starting_balance: 1320.4,
      meta: { name: "Personal Visa", mask: "3303", limit: 8000 } },
    { type: "credit", subtype: "credit card", starting_balance: 5400.0,
      meta: { name: "Business Amex", mask: "4404", limit: 25000 } }
  ]
};

const options = preset === "good"
  ? undefined
  : { override_username: "user_custom", override_password: JSON.stringify(MIXED) };

const institution = { institution_id: "ins_109508", name: "First Platypus Bank" };

const pt = await sandboxPublicToken({ institutionId: institution.institution_id, options }, {
  environment: "sandbox", clientId: env.PLAID_CLIENT_ID, secret: env.PLAID_SECRET, env
});
if (!pt.ok) { console.error("Plaid sandbox refused:", pt.errorCode, pt.error); process.exit(1); }

const db = new pg.Pool({ connectionString: env.DATABASE_URL, max: 2 });
try {
  const client = await db.query(`SELECT id, org_id FROM clients WHERE id = $1`, [clientId]);
  if (!client.rows[0]) throw new Error(`no client ${clientId}`);
  const r = await completeLink(db, {
    orgId: client.rows[0].org_id,
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
  }
} finally {
  await db.end();
}
