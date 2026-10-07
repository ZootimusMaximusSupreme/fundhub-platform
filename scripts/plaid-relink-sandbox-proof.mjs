#!/usr/bin/env node
// Proof, against Plaid's SANDBOX, of the bank-login repair path (FinanceOS F2):
//   a login breaks -> the daily refresh marks it -> the client is given a Link token in
//   UPDATE MODE -> the repair is checked by reading the bank again.
//
//   node --env-file=/path/to/.env scripts/plaid-relink-sandbox-proof.mjs
//
// WHAT IT DOES, step by step, on THROWAWAY Plaid sandbox Items (fake bank, fake
// money, linked to no client):
//   1. makes an Item (Plaid's stock user_good at First Platypus Bank) and reads it:
//      the real refresh works and the login stays active;
//   2. Plaid's /sandbox/item/reset_login forces it into ITEM_LOGIN_REQUIRED;
//   3. the real refresh reads it again and marks it link_state='error',
//      last_error_code='ITEM_LOGIN_REQUIRED', relinkNeeded;
//   4. the status read says "Needs reconnect" in plain words;
//   5. startRelink makes a Link token in update mode for it — Plaid accepts it;
//   6. finishRelink, with nobody having signed in again, says STILL BROKEN and leaves
//      it in 'error' (a button press does not make a broken login healthy);
//   7. a SECOND Item that is healthy at Plaid but marked 'error' in our row — what the
//      database looks like after the client finishes Link — goes through finishRelink:
//      it comes back active with its accounts.
//
// WHAT IT CANNOT DO. Plaid Link's update-mode screen is a browser step: a person (or
// Plaid's sandbox login page) has to sign in again. Plaid offers no API to repair an
// Item that was reset, so step 6 can only prove the "still broken" answer for the
// reset Item, and step 7 stands in for the repaired state with an Item that never broke.
//
// NO DATABASE. The rows live in an in-memory stand-in (src/banking/plaid-fake-db.mjs),
// DATABASE_URL is dropped before anything loads, no client is touched and no text is
// queued. NO TOKEN IS EVER PRINTED: the access tokens exist only in memory, and what is
// printed is counts, booleans, Plaid's codes and the plain sentences a client would read.
//
// Refuses unless PLAID_ENV is sandbox. The Items it makes are left at Plaid (sandbox
// Items cost nothing and expire on their own).

delete process.env.DATABASE_URL;

const { default: crypto } = await import("node:crypto");
const { sandboxPublicToken, exchangePublicToken, sandboxResetLogin } = await import("../src/banking/providers/plaid-http.mjs");
const { encryptPlaidToken } = await import("../src/banking/plaid.mjs");
const { refreshClientAccounts } = await import("../src/banking/plaid-refresh.mjs");
const { startRelink, finishRelink, listBankLoginStatus } = await import("../src/banking/plaid-relink.mjs");
const { fakeBankDb } = await import("../src/banking/plaid-fake-db.mjs");

const src = process.env;
if ((src.PLAID_ENV || "sandbox") !== "sandbox") {
  console.error("PLAID_ENV is not sandbox — this script only uses fake banks.");
  process.exit(1);
}
// Only what the Plaid code reads. No DATABASE_URL, nothing else.
const env = {
  PLAID_CLIENT_ID: src.PLAID_CLIENT_ID,
  PLAID_SECRET: src.PLAID_SECRET,
  PLAID_ENV: "sandbox",
  PLAID_TOKEN_ENC_KEY: src.PLAID_TOKEN_ENC_KEY,
  ADAPTERS_DRY_RUN: src.ADAPTERS_DRY_RUN
};
const plaid = { environment: "sandbox", clientId: env.PLAID_CLIENT_ID, secret: env.PLAID_SECRET, env };

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(name);
  return ok;
};
const stop = (why) => {
  console.error(`\nSTOPPED: ${why}`);
  process.exit(1);
};

const orgId = crypto.randomUUID();
const clientId = crypto.randomUUID();

/* A throwaway sandbox Item, sealed the way completeLink seals it (AAD = Plaid's item id). */
async function throwawayItem(label) {
  const pt = await sandboxPublicToken({ institutionId: "ins_109508", products: ["transactions"] }, plaid);
  if (!pt.ok) stop(`Plaid sandbox refused to make an Item: ${pt.errorCode ?? ""} ${pt.error ?? ""}`);
  const ex = await exchangePublicToken(pt.publicToken, plaid);
  if (!ex.ok) stop(`Plaid refused the exchange: ${ex.errorCode ?? ""} ${ex.error ?? ""}`);
  return {
    accessToken: ex.accessToken,
    row: {
      id: crypto.randomUUID(), org_id: orgId, client_id: clientId, plaid_item_id: ex.itemId,
      institution_name: `First Platypus Bank ${label} (Plaid sandbox — test data)`,
      encrypted_access_token: encryptPlaidToken(ex.accessToken, { itemId: ex.itemId, env }),
      consent_granted_at: new Date().toISOString(), created_at: new Date().toISOString(),
      link_state: "active"
    }
  };
}

const asOf = () => new Date().toISOString();
const words = (x) => (x ? `"${x}"` : "none");

console.log("FinanceOS F2 — bank-login repair, Plaid sandbox, throwaway Items, in-memory rows, no database\n");

/* ── Item A: the one that breaks ────────────────────────────────────────────── */
const a = await throwawayItem("A");
const db = fakeBankDb({ items: [a.row], now: () => new Date() });
const itemA = db.state.items[0];

const healthy = await refreshClientAccounts(db, { orgId, clientId, env, asOf: asOf() });
check("1. a healthy Item reads through the real refresh", healthy.ok === true && healthy.accounts.length > 0,
  `${healthy.accounts.length} accounts`);
check("1. and stays active", itemA.link_state === "active");

const reset = await sandboxResetLogin(a.accessToken, plaid);
check("2. Plaid's /sandbox/item/reset_login forces ITEM_LOGIN_REQUIRED", reset.ok === true && reset.resetLogin === true,
  reset.ok ? "reset_login: true" : `${reset.errorCode ?? ""} ${reset.error ?? ""}`);
if (!reset.ok) stop("cannot continue without a broken Item");

const broken = await refreshClientAccounts(db, { orgId, clientId, env, asOf: asOf() });
const item0 = broken.items[0];
check("3. the real refresh marks it for re-link", item0.relinkNeeded === true && item0.errorCode === "ITEM_LOGIN_REQUIRED",
  `code ${item0.errorCode}`);
check("3. link_state is 'error' and last_error_code is stored", itemA.link_state === "error" && itemA.last_error_code === "ITEM_LOGIN_REQUIRED");

const status = (await listBankLoginStatus(db, { orgId, clientId }))[0];
check("4. the status read says Needs reconnect, in plain words, with the action",
  status.state === "needs_reconnect" && status.error?.fix === "reconnect" && status.error?.plain === "Your bank needs you to sign in again.",
  `${status.state_label}; ${words(status.error?.plain)}; fix ${status.error?.fix}`);
check("4. last good refresh is the healthy read", typeof status.last_good_refresh_at === "string", status.last_good_refresh_at ?? "never");

const started = await startRelink(db, { orgId, clientId, itemRowId: a.row.id, env });
check("5. Plaid makes an UPDATE-MODE link token for the broken Item",
  started.ok === true && typeof started.linkToken === "string" && started.linkToken.startsWith("link-"),
  started.ok ? `${started.linkToken.slice(0, 13)}… (${started.linkToken.length} chars), environment ${started.environment}` : `${started.reason} ${started.errorCode ?? ""} ${started.error ?? ""}`);
check("5. the answer carries no credential",
  !JSON.stringify(started).includes(a.accessToken) && !JSON.stringify(started).includes(a.row.encrypted_access_token));

if (started.ok) {
  const minutes = (Date.parse(started.expiration) - Date.now()) / 60_000;
  console.log(`INFO  the update-mode link token expires in about ${minutes.toFixed(0)} minutes (docs/finance/bank-relink.md says about 30)`);
}

const picker = await startRelink(db, { orgId, clientId, itemRowId: a.row.id, env, accountSelection: true });
console.log(`INFO  with account selection (update.account_selection_enabled): ${picker.ok ? "Plaid accepted it" : `${picker.reason} ${picker.errorCode ?? ""} ${picker.error ?? ""}`}`);

const still = await finishRelink(db, { orgId, clientId, itemRowId: a.row.id, asOf: asOf(), env });
check("6. finish with nobody signed in again is STILL BROKEN, not fixed",
  still.ok === false && still.reason === "still_needs_reconnect" && still.fix === "reconnect",
  `${still.reason}; ${words(still.plain)}`);
check("6. and the login stays in 'error'", itemA.link_state === "error" && itemA.last_error_code === "ITEM_LOGIN_REQUIRED");

/* ── Item B: healthy at Plaid, marked 'error' in our row — the state after Link ── */
const b = await throwawayItem("B");
const rowB = { ...b.row, link_state: "error", last_error_code: "ITEM_LOGIN_REQUIRED", last_error_at: new Date(Date.now() - 3_600_000).toISOString(),
  reconnect_notified_at: new Date(Date.now() - 3_000_000).toISOString() };
const dbB = fakeBankDb({ items: [rowB], now: () => new Date() });
const fixed = await finishRelink(dbB, { orgId, clientId, itemRowId: rowB.id, asOf: asOf(), env });
const itemB = dbB.state.items[0];
check("7. a login Plaid says is healthy comes back active through finishRelink",
  fixed.ok === true && fixed.state === "active" && itemB.link_state === "active" && itemB.last_error_code === null,
  fixed.ok ? `${fixed.accounts.length} accounts refreshed` : `${fixed.reason} ${fixed.errorCode ?? ""}`);
check("7. its 'texted' marker is cleared — the episode is over", itemB.reconnect_notified_at === null);
check("7. a second finish is a no-op and does not ask Plaid again",
  (await finishRelink(dbB, { orgId, clientId, itemRowId: rowB.id, asOf: asOf(), env })).alreadyActive === true);

console.log("\nNOT RUN HERE: the Plaid Link update-mode screen itself (a person signing in again in a browser).");
console.log(failures.length === 0 ? "\nALL CHECKS PASSED" : `\n${failures.length} CHECK(S) FAILED: ${failures.join(" | ")}`);
process.exit(failures.length === 0 ? 0 : 1);
