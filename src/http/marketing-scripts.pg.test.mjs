// The script actions against real Postgres (plan unit U25, spec §7.8, §7.9,
// §7.2): GET marketing/scripts, GET marketing/script, POST
// marketing/scripts/approve | edit | reject | order. Lives under src/http/
// because npm test globs src/** and scripts/** only (CLAUDE.md §12); it
// imports the api/ handlers.
//
// Never pointed at the live database (CLAUDE.md §12, spec §0.7): CI builds a
// scratch database from db/migrations. Without DATABASE_URL every test skips,
// and a skipped .pg.test.mjs is not green.
//
// TWO COMPANIES OF ITS OWN (slugs below), so ad numbers start at 91 on a fresh
// company and another company's scripts are really another company's. Every
// row is removed after. The worker wake is a recorder, never a network call.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { db, pool, close } from "../db.mjs";
import { createSession } from "../auth/session.mjs";
import { assertMatchesContract } from "../marketing/api-contract.mjs";
import { withRequest } from "../marketing/http.mjs";
import { approveScript, editScript, DEFAULT_REJECT_REASON } from "../marketing/scripts-store.mjs";
import { parseScript } from "../marketing/script-file.mjs";
import listHandler from "../../api/marketing/scripts.mjs";
import oneHandler from "../../api/marketing/script.mjs";
import approveHandler from "../../api/marketing/scripts/approve.mjs";
import editHandler from "../../api/marketing/scripts/edit.mjs";
import rejectHandler from "../../api/marketing/scripts/reject.mjs";
import orderHandler from "../../api/marketing/scripts/order.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const SLUG_A = "zz-u25-scripts-a";
const SLUG_B = "zz-u25-scripts-b";
const EMAIL_TAG = "u25_scripts_pg";

let seq = 0;
const rid = (tag) => `u25-pg-${tag}-${process.pid}-${Date.now()}-${++seq}`;

const PARTS = [
  { kind: "hook", text: "MOST lenders read TWO files before they say yes." },
  { kind: "line2", text: "If one is a mess, they never open the other." },
  { kind: "cue", text: "the personal file" },
  { kind: "cue", text: "the business file" },
  { kind: "cue", text: "which one they read first" },
  { kind: "reveal", text: "We check both before you apply anywhere." },
  { kind: "cta", text: "Tap below and see what both files say today." }
];
const bodyOf = (parts) => parts.map((p) => p.text).join("\n\n");
const swap = (parts, i, text) => parts.map((p, j) => (j === i ? { ...p, text } : p));
const CTA = 6;

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  return r;
};

/** One handler call the way api.mjs makes it; the answer as the browser parses it. */
async function call(handler, token, { method = "GET", query = {}, body, deps = {} } = {}) {
  const r = res();
  await handler(
    { method, headers: token ? { authorization: "Bearer " + token } : {}, query, body },
    r,
    { db, wake: async () => ({ ok: true, started: false }), ...deps }
  );
  if (r.body !== null) r.body = JSON.parse(JSON.stringify(r.body));
  return r;
}
const post = (handler, token, body, deps) => call(handler, token, { method: "POST", body, deps });

/* ad_scripts forces partner row security (377 Part 4e): read and write it as
   staff, in a short transaction of its own. */
async function staffTx(fn) {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('fundhub.actor', 'staff', true)");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* the first error is the one worth throwing */ }
    throw err;
  } finally {
    client.release();
  }
}
const scriptRow = (id) => staffTx(async (c) => (await c.query(`SELECT * FROM ad_scripts WHERE id = $1`, [id])).rows[0]);

describe("marketing script actions (U25)", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let orgA, orgB, partnerA, partnerB, ownerA, adminA, closerA, csmA, ownerB;
  let relBatch, unrelBatch;
  let n = 0;

  const outbox = async (org) =>
    (await db.query(`SELECT * FROM repo_outbox WHERE org_id = $1 ORDER BY id`, [org])).rows;
  const outboxByOp = async (op) =>
    (await db.query(`SELECT * FROM repo_outbox WHERE op_id = $1`, [op])).rows[0] || null;

  async function mkScript(fields = {}) {
    const row = {
      org_id: orgA,
      partner_id: partnerA,
      source: "machine",
      status: "draft",
      batch_id: relBatch,
      title: `U25 script ${++n}`,
      body: bodyOf(PARTS),
      parts: JSON.stringify(PARTS),
      lane: "uwiq",
      script_format: "standard",
      style: "bullets",
      angle_key: "two_files",
      offer_key: "slo_roadmap",
      funnel_key: "roadmap_147",
      ...fields
    };
    if (row.parts !== null && typeof row.parts !== "string") row.parts = JSON.stringify(row.parts);
    if (row.check_results && typeof row.check_results !== "string") row.check_results = JSON.stringify(row.check_results);
    const cols = Object.keys(row);
    return staffTx(async (c) => (await c.query(
      `INSERT INTO ad_scripts (${cols.join(", ")})
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`,
      cols.map((k) => row[k])
    )).rows[0]);
  }

  async function purge() {
    const orgs = (await db.query(`SELECT id FROM orgs WHERE slug = ANY($1)`, [[SLUG_A, SLUG_B]])).rows.map((r) => r.id);
    if (orgs.length) {
      await db.query(`DELETE FROM voice_pairs WHERE org_id = ANY($1)`, [orgs]);
      await db.query(`DELETE FROM repo_outbox WHERE org_id = ANY($1)`, [orgs]);
      await db.query(`DELETE FROM marketing_requests WHERE org_id = ANY($1)`, [orgs]);
      await staffTx(async (c) => {
        // Leaves first: a row nothing else points at (as parent or root) can go.
        for (let i = 0; i < 30; i++) {
          const gone = await c.query(
            `DELETE FROM ad_scripts s
              WHERE s.org_id = ANY($1)
                AND NOT EXISTS (SELECT 1 FROM ad_scripts k
                                 WHERE k.id <> s.id
                                   AND (k.parent_script_id = s.id OR k.root_script_id = s.id))`,
            [orgs]
          );
          if (!gone.rowCount) break;
        }
      });
      await db.query(`DELETE FROM marketing_batches WHERE org_id = ANY($1)`, [orgs]);
      await db.query(`DELETE FROM marketing_settings WHERE org_id = ANY($1)`, [orgs]);
      await db.query(`DELETE FROM partners WHERE org_id = ANY($1)`, [orgs]);
    }
    await db.query(`DELETE FROM sessions WHERE staff_id IN (SELECT id FROM staff WHERE email LIKE $1)`, [`${EMAIL_TAG}%`]);
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [`${EMAIL_TAG}%`]);
    try { await db.query(`DELETE FROM orgs WHERE slug = ANY($1)`, [[SLUG_A, SLUG_B]]); } catch { /* reused next run */ }
  }

  const mkOrg = async (slug) => (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ($1, 'U25 scripts fixture')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [slug]
  )).rows[0].id;
  const mkPartner = async (org, slug) => (await db.query(
    `INSERT INTO partners (org_id, name, slug) VALUES ($1, 'U25 house', $2) RETURNING id`, [org, slug]
  )).rows[0].id;
  async function staffIn(org, role, tag) {
    const row = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status) VALUES ($1,$2,$3,$4,'active') RETURNING id`,
      [org, `${EMAIL_TAG}.${tag}@example.com`, `U25 ${tag}`, role]
    )).rows[0];
    return { id: row.id, token: (await createSession(db, { staffId: row.id, orgId: org })).token };
  }

  before(async () => {
    await purge();
    orgA = await mkOrg(SLUG_A);
    orgB = await mkOrg(SLUG_B);
    partnerA = await mkPartner(orgA, "zz-u25-house-a");
    partnerB = await mkPartner(orgB, "zz-u25-house-b");
    ownerA = await staffIn(orgA, "owner", "a.owner");
    adminA = await staffIn(orgA, "admin", "a.admin");
    closerA = await staffIn(orgA, "closer", "a.closer");
    csmA = await staffIn(orgA, "csm", "a.csm");
    ownerB = await staffIn(orgB, "owner", "b.owner");
    // A fresh company with the default floor, 91.
    await db.query(`INSERT INTO marketing_settings (org_id) VALUES ($1) ON CONFLICT (org_id) DO NOTHING`, [orgA]);
    relBatch = (await db.query(
      `INSERT INTO marketing_batches (org_id, kind, week_key, status, release_at, released_at, total, ready)
       VALUES ($1, 'weekly', '2026-W40', 'released', now() - interval '1 day', now() - interval '1 day', 21, 21)
       RETURNING id`, [orgA]
    )).rows[0].id;
    unrelBatch = (await db.query(
      `INSERT INTO marketing_batches (org_id, kind, week_key, status, release_at, total, ready)
       VALUES ($1, 'weekly', '2026-W51', 'ready', now() + interval '7 days', 21, 21)
       RETURNING id`, [orgA]
    )).rows[0].id;
  });

  after(async () => {
    try { await purge(); } finally { await close(); }
  });

  // ── the gate ──────────────────────────────────────────────────────────────

  test("no session 401; closer and csm 403 on all six routes, and nothing is written", async () => {
    assert.equal((await call(listHandler, null)).code, 401);
    const s = await mkScript();
    for (const t of [closerA.token, csmA.token]) {
      for (const [h, opts] of [
        [listHandler, {}],
        [oneHandler, { query: { id: s.id } }],
        [approveHandler, { method: "POST", body: { request_id: rid("gate"), id: s.id, version: 1 } }],
        [editHandler, { method: "POST", body: { request_id: rid("gate"), id: s.id, version: 1, body: "New words." } }],
        [rejectHandler, { method: "POST", body: { request_id: rid("gate"), id: s.id, version: 1 } }],
        [orderHandler, { method: "POST", body: { request_id: rid("gate"), order: [s.id] } }]
      ]) {
        const r = await call(h, t, opts);
        assert.equal(r.code, 403, JSON.stringify(r.body));
        assert.equal(r.body.error, "forbidden");
      }
    }
    const row = await scriptRow(s.id);
    assert.equal(row.status, "draft");
    assert.equal(row.ad_id, null);
    assert.equal(row.film_order, null);
    assert.equal((await outbox(orgA)).length, 0);
    assert.equal((await call(listHandler, adminA.token)).code, 200, "admin is let in");
  });

  test("the wrong method answers 405 with an Allow header", async () => {
    const r = await call(approveHandler, ownerA.token, { method: "GET" });
    assert.equal(r.code, 405);
    assert.equal(r.headers.Allow, "POST");
    assert.equal((await call(listHandler, ownerA.token, { method: "POST", body: {} })).code, 405);
  });

  // ── reading ───────────────────────────────────────────────────────────────

  test("the list hides imports and the drafts of unreleased batches; filters work; shape is S", async () => {
    const shown = await mkScript({ title: "Released draft" });
    const flagged = await mkScript({ title: "Flagged draft", check_results: { strict: { passed: false, rounds: 2, failures: [] } } });
    const early = await mkScript({ title: "Not released yet", batch_id: unrelBatch });
    const imported = await mkScript({ title: "Imported", source: "import", batch_id: null });
    const mine = await mkScript({ title: "Chris wrote it", source: "chris", batch_id: null, parts: null });
    const other = await mkScript({ org_id: orgB, partner_id: partnerB, batch_id: null, title: "Company B" });

    const r = await call(listHandler, ownerA.token);
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assertMatchesContract("GET marketing/scripts", r.body);
    assert.ok(!Number.isNaN(Date.parse(r.body.as_of)));
    const ids = r.body.scripts.map((s) => s.id);
    assert.ok(ids.includes(shown.id) && ids.includes(flagged.id) && ids.includes(mine.id));
    assert.ok(!ids.includes(early.id), "a draft of an unreleased batch is hidden");
    assert.ok(!ids.includes(imported.id), "an imported row is hidden");
    assert.ok(!ids.includes(other.id), "another company's script is hidden");

    const one = r.body.scripts.find((s) => s.id === shown.id);
    assert.equal(one.root_script_id, shown.id);
    assert.equal(one.version, 1);
    assert.equal(one.ad_id, null);
    assert.equal(one.flagged, false);
    assert.equal(one.lane, "uwiq");
    assert.deepEqual(one.parts, PARTS);
    assert.equal(r.body.scripts.find((s) => s.id === flagged.id).flagged, true, "a machine draft that failed a check is flagged");

    const drafts = await call(listHandler, ownerA.token, { query: { status: "draft" } });
    assert.ok(drafts.body.scripts.every((s) => s.status === "draft"));
    const byBatch = await call(listHandler, ownerA.token, { query: { batch: relBatch } });
    assert.ok(byBatch.body.scripts.length >= 2 && byBatch.body.scripts.every((s) => s.batch_id === relBatch));
    assert.equal((await call(listHandler, ownerA.token, { query: { batch: unrelBatch } })).body.scripts.length, 0);

    const badStatus = await call(listHandler, ownerA.token, { query: { status: "approved" } });
    assert.equal(badStatus.code, 400);
    assert.deepEqual([badStatus.body.error, badStatus.body.field], ["invalid", "status"]);
    const badBatch = await call(listHandler, ownerA.token, { query: { batch: "nope" } });
    assert.deepEqual([badBatch.code, badBatch.body.field], [400, "batch"]);

    const b = await call(listHandler, ownerB.token);
    assert.deepEqual(b.body.scripts.map((s) => s.id), [other.id], "company B sees only its own");
  });

  test("one script: the row and its versions; 404 for hidden ones; 400 for a bad id", async () => {
    const s = await mkScript({ title: "Read me" });
    const r = await call(oneHandler, ownerA.token, { query: { id: s.id } });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assertMatchesContract("GET marketing/script", r.body);
    assert.equal(r.body.script.id, s.id);
    assert.deepEqual(r.body.versions.map((v) => v.id), [s.id]);

    const early = await mkScript({ batch_id: unrelBatch });
    const imported = await mkScript({ source: "import", batch_id: null });
    const other = await mkScript({ org_id: orgB, partner_id: partnerB, batch_id: null });
    for (const id of [early.id, imported.id, other.id, "00000000-0000-4000-8000-0000000000aa"]) {
      const x = await call(oneHandler, ownerA.token, { query: { id } });
      assert.equal(x.code, 404, `${id}: ${JSON.stringify(x.body)}`);
      assert.equal(x.body.error, "not_found");
    }
    const bad = await call(oneHandler, ownerA.token, { query: { id: "12" } });
    assert.deepEqual([bad.code, bad.body.error, bad.body.field], [400, "invalid", "id"]);
    assert.equal((await call(oneHandler, ownerA.token, { query: {} })).code, 400);
  });

  // ── approve ───────────────────────────────────────────────────────────────

  test("approve: 91 on a fresh company, exactly once; registry queued; the file is queued", async () => {
    const s = await mkScript({ title: "Lenders read two files" });
    const req1 = rid("approve");
    const r1 = await post(approveHandler, ownerA.token, { request_id: req1, id: s.id, version: 1 });
    assert.equal(r1.code, 200, JSON.stringify(r1.body));
    assertMatchesContract("POST marketing/scripts/approve", r1.body);
    assert.equal(r1.body.ad_number, "91");
    assert.equal(r1.body.script.ad_id, "91");
    assert.equal(r1.body.script.status, "locked");
    assert.equal(r1.body.script.locked_by, ownerA.id, "Chris's staff id, never the machine");
    assert.ok(r1.body.script.locked_at);
    assert.equal(r1.body.registry, "queued");
    assert.equal(r1.body.registry_note, null);

    const reg = await outboxByOp(`u25:approve-registry:${req1}`);
    assert.ok(reg, "a registry_add_ad outbox row");
    assert.equal(reg.mode, "edit");
    assert.equal(reg.path, "marketing/ads/registry.json");
    assert.deepEqual(reg.edit, { op: "registry_add_ad", id: "91", title: "Lenders read two files", lane: "uwiq" });

    const file = await outboxByOp(`u25:approve-file:${req1}`);
    assert.ok(file, "the script file is queued");
    assert.equal(file.mode, "replace");
    assert.match(file.path, /^marketing\/ads\/scripts\/machine\/2026-W40\/[0-9]{2}-lenders-read-two-files\.md$/);
    const parsed = parseScript(file.content);
    assert.equal(parsed.ad, "91");
    assert.equal(parsed.status, "locked");
    assert.equal(parsed.version, 1);
    assert.equal(parsed.batch, "2026-W40");
    assert.equal(parsed.updated_by, ownerA.id);
    assert.equal(parsed.body, s.body, "the file body is the database body, byte for byte");
    assert.deepEqual(parsed.parts, PARTS);
    assert.equal(r1.body.script.repo_path, file.path, "the path is stored on the script");

    const before = (await outbox(orgA)).length;
    // The same press again: the saved answer, nothing new.
    const r2 = await post(approveHandler, ownerA.token, { request_id: req1, id: s.id, version: 1 });
    assert.equal(r2.code, 200);
    assert.deepEqual(r2.body, r1.body);
    // A second approve: the same number, nothing new queued.
    const r3 = await post(approveHandler, ownerA.token, { request_id: rid("approve-again"), id: s.id, version: 1 });
    assert.equal(r3.code, 200, JSON.stringify(r3.body));
    assert.equal(r3.body.ad_number, "91");
    assert.equal(r3.body.registry, "skipped");
    assert.match(r3.body.registry_note, /already approved/);
    assert.equal((await outbox(orgA)).length, before);
    assert.equal((await scriptRow(s.id)).ad_id, "91");

    // The next script gets the next number. A lane with no registry rule
    // (slo, by design) is skipped with a plain note and never blocks.
    const slo = await mkScript({ title: "Roadmap ad", lane: "slo" });
    const req4 = rid("approve-slo");
    const r4 = await post(approveHandler, adminA.token, { request_id: req4, id: slo.id, version: 1 });
    assert.equal(r4.code, 200, JSON.stringify(r4.body));
    assert.equal(r4.body.ad_number, "92");
    assert.equal(r4.body.script.status, "locked");
    assert.equal(r4.body.registry, "skipped");
    assert.match(r4.body.registry_note, /slo lane has no rule/);
    assert.equal(await outboxByOp(`u25:approve-registry:${req4}`), null);
    assert.ok(await outboxByOp(`u25:approve-file:${req4}`), "the file is still queued");
  });

  test("approve refuses a stale version, a rejected script, and another company's script", async () => {
    const s = await mkScript();
    const stale = await post(approveHandler, ownerA.token, { request_id: rid("stale"), id: s.id, version: 2 });
    assert.equal(stale.code, 409);
    assert.equal(stale.body.error, "stale");
    assert.deepEqual(stale.body.current, { version: 1, body: s.body, parts: PARTS });

    const rej = await mkScript({ status: "rejected" });
    const r = await post(approveHandler, ownerA.token, { request_id: rid("rej"), id: rej.id, version: 1 });
    assert.deepEqual([r.code, r.body.error, r.body.field], [400, "invalid", "id"]);

    const other = await mkScript({ org_id: orgB, partner_id: partnerB, batch_id: null });
    const x = await post(approveHandler, ownerA.token, { request_id: rid("other"), id: other.id, version: 1 });
    assert.equal(x.code, 404);
    assert.equal((await scriptRow(other.id)).status, "draft");

    const bad = await post(approveHandler, ownerA.token, { request_id: rid("bad"), id: "x", version: 1 });
    assert.deepEqual([bad.code, bad.body.field], [400, "id"]);
    const noReq = await post(approveHandler, ownerA.token, { id: s.id, version: 1 });
    assert.deepEqual([noReq.code, noReq.body.field], [400, "request_id"]);
  });

  // ── edit ──────────────────────────────────────────────────────────────────

  test("edit: archive + insert, same root and number; warnings never block; voice pairs; same file path", async () => {
    const s = await mkScript({ title: "Edit me" });
    const ap = await post(approveHandler, ownerA.token, { request_id: rid("ap-edit"), id: s.id, version: 1 });
    assert.equal(ap.code, 200, JSON.stringify(ap.body));
    const number = ap.body.ad_number;
    const firstPath = ap.body.script.repo_path;

    const newParts = swap(PARTS, CTA, "Tap below and see your number today.");
    const req = rid("edit");
    const e = await post(editHandler, ownerA.token, {
      request_id: req, id: s.id, version: 1, body: bodyOf(newParts), parts: newParts
    });
    assert.equal(e.code, 200, JSON.stringify(e.body));
    assertMatchesContract("POST marketing/scripts/edit", e.body);
    const v2 = e.body.script;
    assert.notEqual(v2.id, s.id);
    assert.equal(v2.root_script_id, s.id);
    assert.equal(v2.version, 2);
    assert.equal(v2.status, "locked", "a locked script keeps its lock");
    assert.equal(v2.ad_id, number, "and its number");
    assert.equal(v2.source, "chris");
    assert.equal(v2.body, bodyOf(newParts));
    assert.deepEqual(v2.parts, newParts);
    assert.equal(v2.repo_path, firstPath, "the file never moves");
    assert.ok(e.body.warnings.some((w) => /your number/.test(w.message)), JSON.stringify(e.body.warnings));
    assert.ok(e.body.warnings.every((w) => typeof w.rule === "string" && typeof w.message === "string"));
    assert.equal(v2.flagged, false, "a person's save is never machine-flagged");

    const old = await scriptRow(s.id);
    assert.ok(old.archived_at, "the old version is archived");
    assert.equal(old.status, "superseded");
    assert.equal(old.ad_id, number, "the old version keeps its number too");

    const pairs = (await db.query(`SELECT "before", "after", kind, script_id FROM voice_pairs WHERE org_id = $1 AND script_id = $2`, [orgA, v2.id])).rows;
    assert.deepEqual(pairs.map((p) => [p.before, p.after, p.kind]), [[PARTS[CTA].text, newParts[CTA].text, "cta"]]);

    const file = await outboxByOp(`u25:edit-file:${req}`);
    assert.ok(file);
    assert.equal(file.path, firstPath);
    const parsed = parseScript(file.content);
    assert.equal(parsed.version, 2);
    assert.equal(parsed.ad, number);
    assert.equal(parsed.body, bodyOf(newParts));

    // The versions read newest first, the old one superseded.
    const one = await call(oneHandler, ownerA.token, { query: { id: v2.id } });
    assert.deepEqual(one.body.versions.map((v) => [v.version, v.status]), [[2, "locked"], [1, "superseded"]]);

    // Editing version 1 again is stale, and the answer names what is saved now.
    const stale = await post(editHandler, ownerA.token, { request_id: rid("edit-stale"), id: s.id, version: 1, body: "Other words." });
    assert.equal(stale.code, 409);
    assert.deepEqual(stale.body.current, { version: 2, body: bodyOf(newParts), parts: newParts });

    // A second edit from Chris's own line: nothing for the voice file.
    const v3Parts = swap(newParts, CTA, "Tap below and see what we see.");
    const e3 = await post(editHandler, ownerA.token, { request_id: rid("edit-3"), id: v2.id, version: 2, body: bodyOf(v3Parts), parts: v3Parts });
    assert.equal(e3.code, 200, JSON.stringify(e3.body));
    assert.equal(e3.body.script.version, 3);
    assert.equal(e3.body.script.repo_path, firstPath);
    const pairs3 = (await db.query(`SELECT 1 FROM voice_pairs WHERE script_id = $1`, [e3.body.script.id])).rows;
    assert.equal(pairs3.length, 0, "Chris changing his own line teaches the voice file nothing");
  });

  test("edit: a draft stays a draft; words-only edits clear stale parts with a warning; bad input is 400", async () => {
    const s = await mkScript({ title: "Draft to edit" });
    const e = await post(editHandler, ownerA.token, {
      request_id: rid("edit-words"), id: s.id, version: 1, body: "All new words.\n\nNo parts sent."
    });
    assert.equal(e.code, 200, JSON.stringify(e.body));
    assert.equal(e.body.script.status, "draft");
    assert.equal(e.body.script.ad_id, null);
    assert.equal(e.body.script.parts, null);
    assert.ok(e.body.warnings.some((w) => w.rule === "parts"));
    assert.equal((await scriptRow(s.id)).status, "superseded");

    for (const [body, field] of [
      [{ body: "   " }, "body"],
      [{ body: "x", parts: [{ kind: "intro", text: "x" }] }, "parts"],
      [{ body: "x", parts: "hook" }, "parts"],
      [{ body: "x", meta_copy: "headline" }, "meta_copy"]
    ]) {
      const r = await post(editHandler, ownerA.token, { request_id: rid("edit-bad"), id: e.body.script.id, version: 2, ...body });
      assert.deepEqual([r.code, r.body.error, r.body.field], [400, "invalid", field], JSON.stringify(r.body));
    }

    const rej = await mkScript({ status: "rejected" });
    const r = await post(editHandler, ownerA.token, { request_id: rid("edit-rej"), id: rej.id, version: 1, body: "x" });
    assert.deepEqual([r.code, r.body.field], [400, "id"]);
  });

  // ── reject ────────────────────────────────────────────────────────────────

  test("reject: Chris's staff id and the default reason; only a draft; stale is 409", async () => {
    const s = await mkScript({ title: "Reject me" });
    const stale = await post(rejectHandler, ownerA.token, { request_id: rid("rej-stale"), id: s.id, version: 3 });
    assert.equal(stale.code, 409);

    const req = rid("reject");
    const r = await post(rejectHandler, ownerA.token, { request_id: req, id: s.id, version: 1 });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assertMatchesContract("POST marketing/scripts/reject", r.body);
    assert.equal(r.body.script.status, "rejected");
    assert.equal(r.body.script.rejected_reason, DEFAULT_REJECT_REASON);
    assert.equal(r.body.script.rejected_reason, "rejected from the app, no reason given");
    assert.ok(r.body.script.rejected_at);
    const row = await scriptRow(s.id);
    assert.equal(row.rejected_by, ownerA.id);
    const file = await outboxByOp(`u25:reject-file:${req}`);
    assert.ok(file);
    assert.equal(parseScript(file.content).status, "rejected");

    const again = await post(rejectHandler, ownerA.token, { request_id: rid("rej-again"), id: s.id, version: 1 });
    assert.deepEqual([again.code, again.body.field], [400, "id"]);

    const s2 = await mkScript({ title: "Reject with a reason" });
    const r2 = await post(rejectHandler, adminA.token, { request_id: rid("reject-2"), id: s2.id, version: 1, reason: "  The hook is weak.  " });
    assert.equal(r2.code, 200);
    assert.equal(r2.body.script.rejected_reason, "The hook is weak.");
    assert.equal((await scriptRow(s2.id)).rejected_by, adminA.id);
    const blank = await mkScript();
    const r3 = await post(rejectHandler, ownerA.token, { request_id: rid("reject-3"), id: blank.id, version: 1, reason: "   " });
    assert.equal(r3.body.script.rejected_reason, DEFAULT_REJECT_REASON);
  });

  // ── film order ────────────────────────────────────────────────────────────

  test("order: film_order follows the list; unknown, hidden or other-company ids are 400", async () => {
    const a = await mkScript({ title: "Film second" });
    const b = await mkScript({ title: "Film first" });
    const r = await post(orderHandler, ownerA.token, { request_id: rid("order"), order: [b.id, a.id] });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assertMatchesContract("POST marketing/scripts/order", r.body);
    assert.equal(r.body.ok, true);
    assert.equal((await scriptRow(b.id)).film_order, 1);
    assert.equal((await scriptRow(a.id)).film_order, 2);

    const other = await mkScript({ org_id: orgB, partner_id: partnerB, batch_id: null });
    const early = await mkScript({ batch_id: unrelBatch });
    for (const order of [
      [a.id, "00000000-0000-4000-8000-0000000000bb"],
      [a.id, other.id],
      [early.id],
      [a.id, a.id],
      ["nope"],
      "not a list"
    ]) {
      const x = await post(orderHandler, ownerA.token, { request_id: rid("order-bad"), order });
      assert.deepEqual([x.code, x.body.error, x.body.field], [400, "invalid", "order"], JSON.stringify(order));
    }
    assert.equal((await scriptRow(other.id)).film_order, null);
    assert.equal((await scriptRow(b.id)).film_order, 1, "a refused order changes nothing");
  });

  // ── one transaction, then the wake ────────────────────────────────────────

  test("a save that rolls back leaves no change, no outbox row and no saved answer", async () => {
    const s = await mkScript({ title: "Roll back" });
    const reqA = rid("rollback-approve");
    await assert.rejects(
      withRequest(db, { orgId: orgA, route: "marketing/scripts/approve", requestId: reqA }, async (tx) => {
        await approveScript(tx, { orgId: orgA, id: s.id, version: 1, staffId: ownerA.id, requestId: reqA });
        throw new Error("boom after the write");
      }),
      /boom/
    );
    const row = await scriptRow(s.id);
    assert.equal(row.status, "draft");
    assert.equal(row.ad_id, null);
    assert.equal(row.repo_path, null);
    assert.equal(await outboxByOp(`u25:approve-file:${reqA}`), null);
    assert.equal(await outboxByOp(`u25:approve-registry:${reqA}`), null);
    assert.equal((await db.query(`SELECT 1 FROM marketing_requests WHERE request_id = $1`, [reqA])).rows.length, 0);

    const reqE = rid("rollback-edit");
    const newParts = swap(PARTS, CTA, "Different words.");
    await assert.rejects(
      withRequest(db, { orgId: orgA, route: "marketing/scripts/edit", requestId: reqE }, async (tx) => {
        await editScript(tx, { orgId: orgA, id: s.id, version: 1, body: bodyOf(newParts), parts: newParts, metaCopy: null, staffId: ownerA.id, requestId: reqE });
        throw new Error("boom after the edit");
      }),
      /boom/
    );
    const after = await scriptRow(s.id);
    assert.equal(after.archived_at, null, "the old version is still live");
    const versions = await staffTx(async (c) => (await c.query(`SELECT count(*)::int AS n FROM ad_scripts WHERE root_script_id = $1`, [s.id])).rows[0].n);
    assert.equal(versions, 1, "no new version");
    assert.equal((await db.query(`SELECT 1 FROM voice_pairs WHERE org_id = $1 AND "before" = $2 AND "after" = 'Different words.'`, [orgA, PARTS[CTA].text])).rows.length, 0);
    assert.equal(await outboxByOp(`u25:edit-file:${reqE}`), null);
  });

  test("the worker is woken after the commit: the outbox row and the saved answer are already visible", async () => {
    const s = await mkScript({ title: "Wake after commit" });
    const req = rid("wake");
    let seen = null;
    const wake = async () => {
      // A different connection from the pool: it sees only committed rows.
      const file = await outboxByOp(`u25:approve-file:${req}`);
      const saved = (await db.query(`SELECT 1 FROM marketing_requests WHERE request_id = $1`, [req])).rows.length;
      seen = { file: !!file, saved };
      return { ok: true, started: true };
    };
    const r = await post(approveHandler, ownerA.token, { request_id: req, id: s.id, version: 1 }, { wake });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.deepEqual(seen, { file: true, saved: 1 });

    // A refused save never wakes anybody.
    let woke = false;
    const x = await post(approveHandler, ownerA.token, { request_id: rid("wake-stale"), id: s.id, version: 9 }, { wake: async () => { woke = true; } });
    assert.equal(x.code, 409);
    assert.equal(woke, false);
  });

  test("a request_id used on another route is refused", async () => {
    const s = await mkScript({ title: "Reused request id" });
    const req = rid("reuse");
    assert.equal((await post(rejectHandler, ownerA.token, { request_id: req, id: s.id, version: 1 })).code, 200);
    const s2 = await mkScript();
    const x = await post(approveHandler, ownerA.token, { request_id: req, id: s2.id, version: 1 });
    assert.deepEqual([x.code, x.body.error, x.body.field], [400, "invalid", "request_id"]);
    assert.equal((await scriptRow(s2.id)).status, "draft");
  });
});
