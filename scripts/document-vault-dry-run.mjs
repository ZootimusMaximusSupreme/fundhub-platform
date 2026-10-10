#!/usr/bin/env node
// Read-only look at the application document vault for one client (or the two proof
// clients): every line, its status, what is on file against it, the sentence the
// closer would read, and what the chase WOULD do today. It writes nothing and it
// sends nothing — not one INSERT, UPDATE or message. (Capital Blueprint unit B3.)
//
//   node --env-file=.env scripts/document-vault-dry-run.mjs
//   node --env-file=.env scripts/document-vault-dry-run.mjs --client <uuid> --org <uuid>
//
// HOW IT STAYS READ-ONLY. Every read sits inside BEGIN READ ONLY ... ROLLBACK on one
// connection, so the database itself refuses a write. The chase runs with dryRun:
// it plans and returns; it never enqueues, claims, sends or creates a task.
//
// WHAT IT DOES ABOUT TABLES THAT ARE NOT THERE YET. Migration 472 (the vault's two
// tables) is not on the live database until the next ship (464's money_agent_tasks
// may not be either, depending on when this runs). A read of a table that does not
// exist would abort the transaction, so for those tables — and only those, and only
// when the table is really missing, checked first — the query is answered with no
// rows and the output says so on a line of its own. The documents, businesses,
// containers, identity and messages it reads are the real ones.

import { pool, close } from "../src/db.mjs";
import { readVault, vaultFromFacts, loadVaultFacts, vaultLine } from "../src/finance/document-vault.mjs";
import { runVaultChase } from "../src/finance/document-vault-chase.mjs";
import { vaultNote } from "../src/blueprint/closer-ready.mjs";
import { isCapitalBlueprintBuyer } from "../src/blueprint/coach-exception.mjs";

const PROOF = [
  { label: "FinanceOS test client", org: "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6", client: "f1cb9c27-f858-4db1-b6bb-4eddc898bb8e" },
  { label: "Blueprint sim (Sim Eleven)", org: "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6", client: "029964c5-4d8e-47ed-88c9-53ac13863fd4" }
];

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
};

const NOT_YET = ["document_vault_reviews", "document_vault_items", "money_agent_tasks"];

/** One read-only connection; a query on a table that is missing reads as empty. */
async function withReadOnly(fn) {
  const conn = await pool().connect();
  try {
    await conn.query("BEGIN READ ONLY");
    const have = (await conn.query(
      `SELECT ${NOT_YET.map((t, i) => `to_regclass('public.${t}') IS NOT NULL AS t${i}`).join(", ")}`
    )).rows[0];
    const missing = NOT_YET.filter((_, i) => !have[`t${i}`]);
    // The vault reads several tables at once. One connection runs one query at a
    // time, so the shim lines them up instead of letting pg warn about overlap.
    let tail = Promise.resolve();
    const inOrder = (fn) => {
      const next = tail.then(fn, fn);
      tail = next.catch(() => {});
      return next;
    };
    const shim = {
      query(sql, params) {
        if (missing.some((t) => new RegExp(`\\b${t}\\b`).test(sql)) && /^\s*SELECT/i.test(sql)) {
          return Promise.resolve({ rows: [] });
        }
        return inOrder(() => conn.query(sql, params));
      }
    };
    return await fn(shim, missing);
  } finally {
    await conn.query("ROLLBACK");
    conn.release();
  }
}

const pad = (s, n) => String(s).padEnd(n);

async function show({ label, org, client }, now) {
  await withReadOnly(async (db, missing) => {
    console.log(`\n=== ${label}  client ${client}`);
    if (missing.length) {
      console.log(`    (not on the live database yet, read as empty: ${missing.join(", ")} — they arrive with the next ship)`);
    }
    const view = await readVault(db, { orgId: org, clientId: client, audience: "staff", now });
    if (!view) { console.log("    no such client in this org"); return; }
    console.log(`    ${view.client.name}`);
    console.log(`    complete: ${view.complete}   ${JSON.stringify(view.summary)}`);
    console.log(`    business scopes: ${view.scopes.length ? view.scopes.map((s) => `${s.name || "(unnamed)"}${s.id ? ` [${s.id.slice(0, 8)}]` : " [no container]"}`).join(", ") : "none"}`);
    console.log("");
    for (const it of view.items) {
      const scope = it.scope.kind === "business" ? ` — ${it.scope.name || "business"}` : "";
      console.log(`    ${pad(it.status, 9)} ${pad(`${it.have}/${it.need}`, 5)} ${it.title}${scope}`);
      for (const d of it.documents) {
        console.log(`        file ${d.id.slice(0, 8)}  ${d.status}${d.accepted_by ? ` by ${d.accepted_by}` : ""}  ${d.filename || d.title}  ${d.uploaded_at}`);
      }
    }
    if (view.unfiled.length) {
      console.log("\n    unfiled uploads (a person files these):");
      for (const u of view.unfiled) console.log(`        ${u.id.slice(0, 8)}  ${u.reason}  ${u.filename || u.title}`);
    }

    const facts = await loadVaultFacts(db, { orgId: org, clientId: client });
    const core = vaultFromFacts(facts, { now });
    console.log(`\n    closer sees:  ${vaultLine({ complete: core.complete, summary: core.summary, missing: core.missing })}`);
    const note = await vaultNote(db, { orgId: org, clientId: client, now });
    console.log(`    (vaultNote gives the same: ${note.line === vaultLine({ complete: core.complete, summary: core.summary, missing: core.missing }) ? "yes" : "NO"})`);

    const buyer = await isCapitalBlueprintBuyer(db, { orgId: org, clientId: client });
    console.log(`\n    paid Capital Blueprint buyer (the daily chase only asks these): ${buyer}`);
    const chase = await runVaultChase(db, { orgId: org, clientId: client, now, dryRun: true });
    console.log(`    chase today (DRY RUN, nothing written, nothing sent): ${chase.reason}`);
    if (chase.plan && chase.plan.ask) {
      const a = chase.plan.ask;
      console.log(`        would ask: ${a.label}  — rung ${a.rung}, by ${a.channel}, template ${a.templateKey}, ${a.more} more after this one`);
    }
    if (chase.plan && chase.plan.csm) console.log(`        would hand to a CSM: ${chase.plan.csm.labels.join("; ")}`);
    if (chase.plan && chase.plan.review) console.log(`        would open a review task (role admin) for: ${chase.plan.review.labels.join("; ")}`);
  });
}

async function main() {
  const now = new Date();
  const one = arg("client");
  const targets = one
    ? [{ label: "client", org: arg("org") || PROOF[0].org, client: one }]
    : PROOF;
  console.log(`DOCUMENT VAULT — read only (BEGIN READ ONLY ... ROLLBACK). ${now.toISOString()}`);
  for (const t of targets) await show(t, now);
  console.log("\nNothing was written. Nothing was sent.");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => close());
