// closer-deck send_ebook, retired: the three trace statements and the whole judge, on a real Postgres. Read only.
//
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here.
// Run it:  DATABASE_URL=postgres://... node --test src/pulse/coverage/fin-b03-route-retired.pg.test.mjs
// Point it at a scratch database or the CI one. This batch never ran it against the live database.
//
// WHY THIS FILE EXISTS. fin-b03-route-retired.test.mjs runs the same SQL strings, unchanged, on a SQL engine that
// ships with Node (SQLite). That engine is real, but it is not Postgres. This file runs the very same strings
// (EBOOK_TRACES, ebookTraceSql) and the very same judge (judgeRetiredRoute) on Postgres, so a difference between
// the two engines (the ->> operator on jsonb, LIKE, lower(), a text parameter against a uuid column, a
// timestamptz coming back as a Date) shows up as a red test here and not as a wrong answer on the live pulse.
//
// HOW IT STAYS HARMLESS. Same method as gap-msg.pg.test.mjs. Everything runs inside BEGIN READ ONLY and is rolled
// back. The three real tables are shadowed by a CTE that holds ONLY the made-up rows of that scenario, so no real
// row is read and the test answers the same on an empty scratch database as on a full one. Nothing is written (the
// database would refuse it). Nothing is sent.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { pool, close } from "../../db.mjs";
import {
  EBOOK_TRACES,
  RETIRED_ROUTE_ACTIONS,
  ebookTraceSql,
  judgeRetiredRoute,
} from "./fin-b03-route-retired.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const SKIP = HAS_DB ? false : "no DATABASE_URL";
const ENTRY = RETIRED_ROUTE_ACTIONS[0];
const ROW = { id: "catalog-route:routes-1.json:route:closer-deck:send_ebook", surface: ENTRY.surface, control: ENTRY.control };
const ORG = crypto.randomUUID();
const OTHER_ORG = crypto.randomUUID();

const LONG_AGO = "2026-09-01T18:00:00.000Z";
const JUST_BEFORE = "2026-10-12T16:35:59.999Z";
const AT_CUTOFF = "2026-10-12T16:36:00.000Z";
const AFTER = "2026-10-13T20:10:00.000Z";
const REF = "staff:ebook-send:9b7c1d2e-0000-4000-8000-000000000042";

const SHADOWS = {
  clients: {
    cols: "id, org_id, custom_fields",
    rec: "id uuid, org_id uuid, custom_fields jsonb"
  },
  payment_links: {
    cols: "id, org_id, purpose, description, created_at",
    rec: "id uuid, org_id uuid, purpose text, description text, created_at timestamptz"
  },
  messages: {
    cols: "id, org_id, provider_ref, created_at",
    rec: "id uuid, org_id uuid, provider_ref text, created_at timestamptz"
  }
};

let conn = null;

before(async () => {
  if (!HAS_DB) return;
  conn = await pool().connect();
  await conn.query("BEGIN READ ONLY");
  const ro = await conn.query("SHOW transaction_read_only");
  assert.equal(ro.rows[0].transaction_read_only, "on", "the harness must be read only");
});

after(async () => {
  if (!HAS_DB) return;
  try { await conn.query("ROLLBACK"); } catch { /* the connection is gone; nothing to undo */ }
  conn.release();
  await close();
});

/** Put the made-up rows in front of the SQL as CTEs named like the real tables. */
function withShadows(sql, paramCount) {
  const ctes = Object.entries(SHADOWS).map(([table, def], i) =>
    `${table} AS (SELECT ${def.cols} FROM ${table} WHERE false UNION ALL SELECT ${def.cols} FROM jsonb_to_recordset($${paramCount + i + 1}::jsonb) AS x(${def.rec}))`
  ).join(",\n");
  return `WITH ${ctes}\n${sql}`;
}

/** A database handle the lane can use: every statement it sends gets the made-up rows in front of it. */
function shadowed(fakes = {}) {
  const extra = Object.keys(SHADOWS).map((table) => JSON.stringify(fakes[table] || []));
  return {
    async query(sql, params = []) {
      return conn.query(withShadows(sql, params.length), [...params, ...extra]);
    }
  };
}

const id = () => crypto.randomUUID();
const marker = (sentAt, org = ORG) => ({ id: id(), org_id: org, custom_fields: { closer_deck_ebook_sent_at: sentAt } });
const plainClient = (org = ORG) => ({ id: id(), org_id: org, custom_fields: { closer_deck_soft_pull_sent_at: AFTER } });
const link = (at, description = "Fundhub e-book", over = {}) => ({ id: id(), org_id: ORG, purpose: "custom", description, created_at: at, ...over });
const email = (at, ref = REF, org = ORG) => ({ id: id(), org_id: org, provider_ref: ref, created_at: at });

const judged = (fakes, orgId = ORG) => judgeRetiredRoute(ROW, ENTRY, { db: shadowed(fakes), orgId });

// ── the statements, row by row ───────────────────────────────────────────────

test("marker: only a client file of this company that carries the send marker comes back, with its saved time", { skip: SKIP }, async () => {
  const clients = [marker(AFTER), marker(LONG_AGO), plainClient(), marker(AFTER, OTHER_ORG), { id: id(), org_id: ORG, custom_fields: {} }];
  const db = shadowed({ clients });
  const scoped = await db.query(ebookTraceSql(EBOOK_TRACES[0], true), [ORG]);
  assert.deepEqual(scoped.rows.map((row) => row.saved_at).sort(), [LONG_AGO, AFTER].sort());
  const every = await db.query(ebookTraceSql(EBOOK_TRACES[0], false));
  assert.equal(every.rows.length, 3, "with no company named, every company's client file is read");
});

test("link: the e-book words at the start of a word, custom purpose, this company; Facebook is not an e-book", { skip: SKIP }, async () => {
  const links = [
    link(AFTER, "Fundhub e-book"), link(AFTER, "E-BOOK guide"), link(AFTER, "ebook"), link(AFTER, "Credit ebook bundle"),
    link(AFTER, "Facebook ads setup"), link(AFTER, "Notebook bundle"), link(AFTER, null), link(AFTER, "Fundhub e-book", { purpose: "deposit" }),
    link(AFTER, "Fundhub e-book", { org_id: OTHER_ORG })
  ];
  const db = shadowed({ payment_links: links });
  const scoped = await db.query(ebookTraceSql(EBOOK_TRACES[1], true), [ORG]);
  assert.equal(scoped.rows.length, 4);
  assert.ok(scoped.rows.every((row) => row.saved_at instanceof Date), "a timestamptz comes back as a Date");
  const every = await db.query(ebookTraceSql(EBOOK_TRACES[1], false));
  assert.equal(every.rows.length, 5);
});

test("message: only the e-book send key of this company comes back", { skip: SKIP }, async () => {
  const messages = [
    email(AFTER), email(AFTER, "staff:ebook-send:another"), email(AFTER, "staff:soft-pull-send:abc"),
    email(AFTER, "wf:ebook-send:abc"), email(AFTER, null), email(AFTER, REF, OTHER_ORG)
  ];
  const db = shadowed({ messages });
  const scoped = await db.query(ebookTraceSql(EBOOK_TRACES[2], true), [ORG]);
  assert.equal(scoped.rows.length, 2);
  const every = await db.query(ebookTraceSql(EBOOK_TRACES[2], false));
  assert.equal(every.rows.length, 3);
});

// ── the whole judge, on Postgres ─────────────────────────────────────────────

test("judge: nothing saved, or only history, is nothing to judge", { skip: SKIP }, async () => {
  assert.equal((await judged({})).status, "na");
  const history = await judged({ clients: [marker(LONG_AGO), marker(JUST_BEFORE)], payment_links: [link(LONG_AGO)], messages: [email(JUST_BEFORE)] });
  assert.equal(history.status, "na");
  assert.match(history.detail, /Saved before it went off: 2 client files, 1 pay link, 1 email/);
});

test("judge: each trace alone at or after the cutoff is a FAIL that names it", { skip: SKIP }, async () => {
  for (const at of [AT_CUTOFF, AFTER]) {
    const byMarker = await judged({ clients: [marker(at)] });
    assert.equal(byMarker.status, "FAIL");
    assert.match(byMarker.detail, /1 client file carrying an e-book send marker/);
    const byLink = await judged({ payment_links: [link(at)] });
    assert.equal(byLink.status, "FAIL");
    assert.match(byLink.detail, /1 pay link described as an e-book/);
    const byEmail = await judged({ messages: [email(at)] });
    assert.equal(byEmail.status, "FAIL");
    assert.match(byEmail.detail, /1 email sent as an e-book send/);
  }
});

test("judge: a send with no marker still goes red, and a marker with no readable time goes red", { skip: SKIP }, async () => {
  const half = await judged({ clients: [plainClient()], payment_links: [link(AFTER)], messages: [email(AFTER)] });
  assert.equal(half.status, "FAIL");
  for (const unreadable of ["", "yesterday", "10/13/2026", "2026-10-13", "2026-10-01"]) {
    assert.equal((await judged({ clients: [marker(unreadable)] })).status, "FAIL", JSON.stringify(unreadable));
  }
});

test("judge: another company's late send is not this company's, and no company named reads every company", { skip: SKIP }, async () => {
  const fakes = { clients: [marker(AFTER, OTHER_ORG)], payment_links: [link(AFTER, "Fundhub e-book", { org_id: OTHER_ORG })], messages: [email(AFTER, REF, OTHER_ORG)] };
  assert.equal((await judged(fakes, ORG)).status, "na");
  assert.equal((await judged(fakes, OTHER_ORG)).status, "FAIL");
  assert.equal((await judged(fakes, null)).status, "FAIL");
});
