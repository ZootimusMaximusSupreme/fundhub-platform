// Postgres-backed tests for migration 472 (the application document vault) and the
// writers and readers that use it.
//
// WHAT ONLY A REAL DATABASE CAN SAY:
//   1. The tables refuse what a screen must never be able to write: a reject with
//      no reason, a second decision row for one document, a custom line with no
//      title, a waiver with no reason, a second live waiver for one line.
//   2. The staff decisions really upsert (one row per document, however many times
//      a person changes their mind) and the vault reads them back as statuses.
//   3. period_end comes back as the plain date a person typed, not a shifted one.
//   4. The CSM closing prep call really stores the vault line in tasks.detail,
//      while the title, the source and the dedupe key (tasks.body) do not move.
//   5. An ask is really one money_agent_tasks row that satisfies 464's CHECKs,
//      and money_agent_tasks_one_open really stops a second open ask for a line.
//
// EVERYTHING RUNS IN ONE TRANSACTION THAT IS ROLLED BACK. Nothing this file writes
// survives it. Expected failures run inside SAVEPOINTs so the transaction stays
// usable. Skipped without DATABASE_URL, like every other *.pg.test.mjs (CLAUDE.md
// §12: a skip is not a pass — CI runs this against its throwaway database).

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { pool, close } from "../db.mjs";
import {
  readVault, vaultComplete, decideDocument, addCustomItem, retireItem, waiveItem, unwaiveItem, buildVault, VaultError
} from "./document-vault.mjs";
import { runVaultChase, closeStaleAsks, sendAsk, TASK_SOURCE } from "./document-vault-chase.mjs";
import {
  createBlueprintCsmPrepCallTask, CSM_PREP_SOURCE, CSM_PREP_TITLE, PREP_CALL_DEDUPE
} from "../blueprint/closer-ready.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

describe("document vault (migration 472)", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let c;
  let orgId;
  let clientId;
  let staffId;
  let bizId;
  let n = 0;
  const NOW = new Date();

  before(async () => {
    c = await pool().connect();
    await c.query("BEGIN");
    orgId = (await c.query(
      `INSERT INTO orgs (slug, name) VALUES ($1, 'Vault PgTest Org') RETURNING id`,
      [`vault-pg-test-${process.pid}-${Date.now()}`]
    )).rows[0].id;
    clientId = (await c.query(
      `INSERT INTO clients (org_id, first_name, last_name) VALUES ($1, 'Vault', 'PgTest') RETURNING id`, [orgId]
    )).rows[0].id;
    staffId = (await c.query(
      `INSERT INTO staff (org_id, email, name, role, status) VALUES ($1, $2, 'Vault Reviewer', 'admin', 'active') RETURNING id`,
      [orgId, `vault-pg-${process.pid}-${Date.now()}@example.com`]
    )).rows[0].id;
    bizId = (await c.query(
      `INSERT INTO entities (org_id, client_id, kind, name) VALUES ($1, $2, 'business', 'Vault PgTest LLC') RETURNING id`,
      [orgId, clientId]
    )).rows[0].id;
  });

  after(async () => {
    if (c) {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
    await close();
  });

  async function expectRefused(sql, params, code) {
    await c.query("SAVEPOINT refused");
    try {
      await c.query(sql, params);
      assert.fail(`expected ${code}`);
    } catch (e) {
      assert.equal(e.code, code, e.message);
    } finally {
      await c.query("ROLLBACK TO SAVEPOINT refused");
    }
  }

  async function upload(subtype, { entityId = null, kind = "client_upload", filename = null, generatedAt = null } = {}) {
    n += 1;
    const meta = { ...(entityId ? { entity_id: entityId } : {}), ...(filename ? { original_filename: filename } : {}) };
    return (await c.query(
      `INSERT INTO documents (org_id, client_id, document_key, kind, subtype, title, storage_key, mime_type, metadata, generated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'application/pdf', $8::jsonb, COALESCE($9::timestamptz, now())) RETURNING id`,
      [orgId, clientId, `vault-pg|${process.pid}|${n}`, kind, subtype, `Vault PgTest ${subtype} ${n}`, `memory/vault-pg-${n}`,
        JSON.stringify(meta), generatedAt]
    )).rows[0].id;
  }

  const review = (docId, status = "accepted", extra = {}) => c.query(
    `INSERT INTO document_vault_reviews (org_id, client_id, document_id, status, reason, covers)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [orgId, clientId, docId, status, extra.reason ?? null, extra.covers ?? 1]
  );

  const line = (v, key, scopeId = null) => v.items.find((i) => i.key === key && (scopeId === null || i.scope.id === scopeId));
  const read = (audience = "staff") => readVault(c, { orgId, clientId, audience, now: NOW, env: {} });

  test("the tables refuse a reject with no reason, a bad status, bad units, a bad key, and a second row for one document", async () => {
    const d = await upload("id_document");
    await expectRefused(
      `INSERT INTO document_vault_reviews (org_id, client_id, document_id, status) VALUES ($1, $2, $3, 'rejected')`,
      [orgId, clientId, d], "23514");
    await expectRefused(
      `INSERT INTO document_vault_reviews (org_id, client_id, document_id, status, reason) VALUES ($1, $2, $3, 'rejected', '   ')`,
      [orgId, clientId, d], "23514");
    await expectRefused(
      `INSERT INTO document_vault_reviews (org_id, client_id, document_id, status) VALUES ($1, $2, $3, 'maybe')`,
      [orgId, clientId, d], "23514");
    for (const covers of [0, 25]) {
      await expectRefused(
        `INSERT INTO document_vault_reviews (org_id, client_id, document_id, status, covers) VALUES ($1, $2, $3, 'accepted', $4)`,
        [orgId, clientId, d, covers], "23514");
    }
    await expectRefused(
      `INSERT INTO document_vault_reviews (org_id, client_id, document_id, status, item_key) VALUES ($1, $2, $3, 'accepted', 'Bad Key')`,
      [orgId, clientId, d], "23514");
    await review(d, "rejected", { reason: "Cut off" });
    await expectRefused(
      `INSERT INTO document_vault_reviews (org_id, client_id, document_id, status) VALUES ($1, $2, $3, 'accepted')`,
      [orgId, clientId, d], "23505");
  });

  test("the items table refuses a custom line with no title, a waiver with no reason, and a second live waiver for one line", async () => {
    const ins = (kind, key, { title = null, note = null, entity = null, need = 1 } = {}) => c.query(
      `INSERT INTO document_vault_items (org_id, client_id, entity_id, item_key, kind, title, note, need)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [orgId, clientId, entity, key, kind, title, note, need]);
    const sql = `INSERT INTO document_vault_items (org_id, client_id, entity_id, item_key, kind, title, note, need)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`;
    await expectRefused(sql, [orgId, clientId, null, "custom_00000001", "custom", null, null, 1], "23514");
    await expectRefused(sql, [orgId, clientId, null, "custom_00000002", "custom", "   ", null, 1], "23514");
    await expectRefused(sql, [orgId, clientId, null, "ein_letter", "waiver", null, null, 1], "23514");
    await expectRefused(sql, [orgId, clientId, null, "ein_letter", "waiver", null, "  ", 1], "23514");
    await expectRefused(sql, [orgId, clientId, null, "ein_letter", "other", null, "x", 1], "23514");
    await expectRefused(sql, [orgId, clientId, null, "custom_00000003", "custom", "A line", null, 0], "23514");
    await expectRefused(sql, [orgId, clientId, null, "Bad Key", "custom", "A line", null, 1], "23514");

    const first = (await ins("waiver", "certificate_good_standing", { note: "not needed", entity: bizId })).rows[0].id;
    await expectRefused(sql, [orgId, clientId, bizId, "certificate_good_standing", "waiver", null, "again", 1], "23505");
    // a different business, or no business, is a different line
    await ins("waiver", "certificate_good_standing", { note: "other biz", entity: null });
    await expectRefused(sql, [orgId, clientId, null, "certificate_good_standing", "waiver", null, "again", 1], "23505");
    // retiring frees the slot
    await c.query(`UPDATE document_vault_items SET retired_at = now() WHERE id = $1`, [first]);
    await ins("waiver", "certificate_good_standing", { note: "back again", entity: bizId });
  });

  test("decideDocument upserts one row per document, and readVault shows the new status", async () => {
    const stmts = [];
    for (let i = 0; i < 3; i += 1) stmts.push(await upload("business_bank_statement", { entityId: bizId, filename: `m${i}.pdf` }));
    const today = NOW.toISOString().slice(0, 10);

    let v = await read();
    assert.equal(line(v, "bank_statements_business", bizId).status, "uploaded");
    assert.equal(line(v, "bank_statements_business", bizId).documents.length, 3);

    for (const d of stmts) {
      await decideDocument(c, { orgId, clientId, documentId: d, status: "accepted", periodEnd: today, staffId, now: NOW, env: {} });
    }
    v = await read();
    let l = line(v, "bank_statements_business", bizId);
    assert.equal(l.status, "accepted");
    assert.equal([l.have, l.need].join("/"), "3/3");
    assert.equal(l.documents[0].period_end, today, "the date a person typed comes back as that date, not a shifted one");
    assert.equal(l.documents[0].reviewed_by, "Vault Reviewer");

    // Changing a mind updates the same row.
    await decideDocument(c, { orgId, clientId, documentId: stmts[0], status: "rejected", reason: "Page 2 is missing", staffId, now: NOW, env: {} });
    const rows = (await c.query(`SELECT count(*)::int AS n FROM document_vault_reviews WHERE document_id = $1`, [stmts[0]])).rows[0];
    assert.equal(rows.n, 1);
    v = await read();
    l = line(v, "bank_statements_business", bizId);
    assert.equal(l.status, "missing");
    assert.equal([l.have, l.need].join("/"), "2/3");
    assert.equal(l.documents.find((d) => d.id === stmts[0]).reason, "Page 2 is missing");
    // The client's view of the same line carries the reason, and no sources.
    const asClient = await read("client");
    assert.equal(line(asClient, "bank_statements_business", bizId).sources, undefined);
    assert.equal(line(asClient, "bank_statements_business", bizId).documents.find((d) => d.id === stmts[0]).reason, "Page 2 is missing");
  });

  test("an unlabelled upload is unfiled, and a person filing it under a line makes it count", async () => {
    const stray = await upload("other", { filename: "scan.pdf" });
    let v = await read();
    assert.ok(v.unfiled.some((u) => u.id === stray && u.reason === "no_label"));
    await assert.rejects(
      () => decideDocument(c, { orgId, clientId, documentId: stray, status: "accepted", staffId, now: NOW, env: {} }),
      (e) => e instanceof VaultError && e.code === "unfiled"
    );
    await decideDocument(c, { orgId, clientId, documentId: stray, status: "accepted", itemKey: "id_document", staffId, now: NOW, env: {} });
    v = await read();
    assert.ok(!v.unfiled.some((u) => u.id === stray));
    assert.equal(line(v, "id_document").status, "accepted");
  });

  test("a mailing proof named proof-of-address stays a mailing proof: the file type decides, not the name", async () => {
    const d = await upload("dispute_mail_receipt", { filename: "proof-of-address-1.png" });
    const v = await read();
    assert.equal(line(v, "proof_of_address").documents.some((x) => x.id === d), false);
    assert.equal(v.unfiled.some((u) => u.id === d), false);
  });

  test("add, waive, unwaive and retire go through the real constraints and show on the list", async () => {
    const added = await addCustomItem(c, { orgId, clientId, title: "Business license", note: "Credit union asks", subtype: "business_license", entityId: bizId, staffId });
    let v = await read();
    assert.equal(line(v, added.item_key).status, "missing");
    assert.equal(line(v, added.item_key).custom, true);
    const lic = await upload("business_license", { entityId: bizId });
    await decideDocument(c, { orgId, clientId, documentId: lic, status: "accepted", staffId, now: NOW, env: {} });
    v = await read();
    assert.equal(line(v, added.item_key).status, "accepted");
    await retireItem(c, { orgId, clientId, itemId: added.id, staffId });
    v = await read();
    assert.equal(v.items.some((i) => i.key === added.item_key), false);
    await assert.rejects(() => retireItem(c, { orgId, clientId, itemId: added.id, staffId }), (e) => e.status === 404);

    const w = await waiveItem(c, { orgId, clientId, itemKey: "tax_returns_personal", reason: "Filed no returns yet", staffId });
    assert.equal(w.created, true);
    v = await read();
    assert.equal(line(v, "tax_returns_personal").status, "waived");
    assert.equal(line(v, "tax_returns_personal").waived.reason, "Filed no returns yet");
    const again = await waiveItem(c, { orgId, clientId, itemKey: "tax_returns_personal", reason: "again", staffId });
    assert.equal(again.created, false, "a second waiver for the same line writes nothing");
    await unwaiveItem(c, { orgId, clientId, itemKey: "tax_returns_personal", staffId });
    v = await read();
    assert.notEqual(line(v, "tax_returns_personal").status, "waived");
    const kept = (await c.query(
      `SELECT count(*)::int AS n FROM document_vault_items WHERE client_id = $1 AND item_key = 'tax_returns_personal'`, [clientId])).rows[0];
    assert.equal(kept.n, 1, "unwaiving stamps retired_at; the row is never deleted");
  });

  test("vaultComplete says not complete, and names what is open", async () => {
    const r = await vaultComplete(c, { orgId, clientId, now: NOW, env: {} });
    assert.equal(r.complete, false);
    assert.ok(r.missing.length > 0);
    assert.equal(r.summary.required, r.summary.accepted + r.summary.waived + r.missing.length);
  });

  test("the CSM closing prep call stores the vault line in tasks.detail; title, source and body do not move", async () => {
    const first = await createBlueprintCsmPrepCallTask(c, { orgId, clientId });
    assert.equal(first.created, true);
    const row = (await c.query(
      `SELECT title, source_workflow, body, assignee_role, detail FROM tasks WHERE id = $1`, [first.id])).rows[0];
    assert.equal(row.title, CSM_PREP_TITLE);
    assert.equal(row.source_workflow, CSM_PREP_SOURCE);
    assert.equal(row.body, PREP_CALL_DEDUPE, "body is still the dedupe key");
    assert.equal(row.assignee_role, "csm");
    assert.match(row.detail, /^Document vault: /);
    const again = await createBlueprintCsmPrepCallTask(c, { orgId, clientId });
    assert.equal(again.created, false);
    assert.equal(again.reason, "duplicate_event");
  });

  test("an ask is one money_agent_tasks row that satisfies 464's constraints; a second open ask for the line is refused", async () => {
    const fresh = (await c.query(
      `INSERT INTO clients (org_id, first_name, last_name) VALUES ($1, 'Ask', 'PgTest') RETURNING id`, [orgId]
    )).rows[0].id;
    const sent = [];
    const send = async (_db, args) => { sent.push(args); return { sent: true }; };
    const createTask = async () => ({ created: false });

    const first = await runVaultChase(c, { orgId, clientId: fresh, now: NOW, env: {}, send, createTask });
    assert.equal(first.ask.asked, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].templateKey, "SMS-VAULT-ASK-1");

    const rows = (await c.query(
      `SELECT task_key, kind, source, assignee, status, moves_money, requested_by_kind, claimed_by, done_at, result, detail
         FROM money_agent_tasks WHERE client_id = $1`, [fresh])).rows;
    assert.equal(rows.length, 1);
    assert.deepEqual(
      [rows[0].task_key, rows[0].kind, rows[0].source, rows[0].assignee, rows[0].status, rows[0].moves_money],
      ["vault:id_document:client", "other", TASK_SOURCE, "agent", "done", false]
    );
    assert.ok(rows[0].done_at);
    assert.equal(rows[0].claimed_by, "doc-vault-rules");
    assert.equal(rows[0].result.asked, true);
    assert.equal(rows[0].detail.vault, true);

    const second = await runVaultChase(c, { orgId, clientId: fresh, now: NOW, env: {}, send, createTask });
    assert.equal(second.reason, "asked_recently");
    assert.equal(sent.length, 1, "the same day twice asks once");

    // An open row for a line blocks another ask for that line: the index, not a SELECT.
    await c.query(
      `INSERT INTO money_agent_tasks (org_id, client_id, task_key, kind, title, source, assignee, status, requested_by_kind)
       VALUES ($1, $2, 'vault:proof_of_address:client', 'other', 'x', 'doc-vault', 'agent', 'claimed', 'staff')`,
      [orgId, fresh]);
    const core = buildVault({ env: {}, now: NOW });
    const blocked = await sendAsk(c, {
      orgId, clientId: fresh, core, now: NOW, send,
      ask: { slot: "proof_of_address:client", key: "proof_of_address", rung: 1, channel: "sms", templateKey: "SMS-VAULT-ASK-1", status: "missing", more: 0 }
    });
    assert.deepEqual(blocked, { asked: false, reason: "already_open" });
    assert.equal(sent.length, 1);

    // The stale-row sweep really runs against the table, and closes only what is old.
    const swept = await closeStaleAsks(c, { orgId, clientId: fresh, now: new Date(NOW.getTime() + 2 * 3600 * 1000) });
    assert.equal(swept, 1);
    const closed = (await c.query(`SELECT status, result FROM money_agent_tasks WHERE task_key = 'vault:proof_of_address:client' AND client_id = $1`, [fresh])).rows[0];
    assert.equal(closed.status, "failed");
    assert.equal(closed.result.asked, false);
  });

  test("an upload waiting for review opens one task for the role that can accept it, and no second while it is open", async () => {
    const fresh = (await c.query(
      `INSERT INTO clients (org_id, first_name, last_name) VALUES ($1, 'Review', 'PgTest') RETURNING id`, [orgId]
    )).rows[0].id;
    n += 1;
    await c.query(
      `INSERT INTO documents (org_id, client_id, document_key, kind, subtype, title, storage_key, mime_type)
       VALUES ($1, $2, $3, 'client_upload', 'id_document', 'Review PgTest ID', $4, 'application/pdf')`,
      [orgId, fresh, `vault-pg|${process.pid}|${n}`, `memory/vault-pg-${n}`]);
    const send = async () => ({ sent: true });
    const { createTask } = await import("../lib/create-task.mjs");

    const first = await runVaultChase(c, { orgId, clientId: fresh, now: NOW, env: {}, send, createTask });
    assert.equal(first.review.created, true);
    const rows = (await c.query(
      `SELECT title, source_workflow, assignee_role, body, done, detail FROM tasks WHERE client_id = $1 AND source_workflow = 'document-vault-review'`,
      [fresh])).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, "Documents are waiting for your review");
    assert.equal(rows[0].assignee_role, "admin");
    assert.equal(rows[0].done, false);
    assert.match(rows[0].detail, /Government photo ID/);

    const second = await runVaultChase(c, { orgId, clientId: fresh, now: NOW, env: {}, send, createTask });
    assert.equal(second.review, null, "one open at a time");
    const after = (await c.query(`SELECT count(*)::int AS n FROM tasks WHERE client_id = $1 AND source_workflow = 'document-vault-review'`, [fresh])).rows[0];
    assert.equal(after.n, 1);
  });

  test("an ask that cannot be sent leaves a cancelled row, and 464 accepts it", async () => {
    const fresh = (await c.query(
      `INSERT INTO clients (org_id, first_name, last_name) VALUES ($1, 'Optout', 'PgTest') RETURNING id`, [orgId]
    )).rows[0].id;
    const r = await runVaultChase(c, {
      orgId, clientId: fresh, now: NOW, env: {},
      send: async () => ({ sent: false, reason: "opted_out" }), createTask: async () => ({ created: false })
    });
    assert.equal(r.ask.asked, false);
    const row = (await c.query(`SELECT status, result FROM money_agent_tasks WHERE client_id = $1`, [fresh])).rows[0];
    assert.equal(row.status, "cancelled");
    assert.equal(row.result.reason, "opted_out");
  });
});
