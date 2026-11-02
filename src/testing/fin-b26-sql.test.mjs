// Practice test for the small SQL reader the batch 26 stand-ins share (src/testing/fin-b26-sql.mjs).
// It checks the reader reads what the product statements say, and that it throws on what it cannot read.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  evalSql, selectList, projectRow, namesOf, orderRows, runUpdate, runInsert, whereOf, orderOf, keep, splitTop,
} from "./fin-b26-sql.mjs";

describe("fin-b26 SQL reader", () => {
  test("expressions: column, parameter, CASE, COALESCE, comparison and the interval sum", () => {
    const ctx = { params: ["complete", null, 3600], rows: { t: { status: "attended", n: 4 } }, row: { status: "attended", n: 4 } };
    assert.equal(evalSql("t.status = 'attended'", ctx), true);
    assert.equal(evalSql("CASE WHEN $1 = 'complete' THEN 'done' ELSE 'open' END", ctx), "done");
    assert.equal(evalSql("COALESCE($2, t.n)", ctx), 4);
    assert.equal(evalSql("$2::uuid IS NULL OR t.status = $1", ctx), true);
    assert.equal(evalSql("t.n = ANY($4::int[])", { ...ctx, params: [1, 2, 3, [4, 5]] }), true);
    assert.deepEqual(evalSql("now() + ($3 || ' seconds')::interval", ctx), { plusSeconds: 3600 });
    assert.deepEqual(evalSql("now() - ($3 || ' seconds')::interval", ctx), { plusSeconds: -3600 });
    assert.deepEqual(evalSql("COALESCE(x, '[]'::jsonb) || $1::jsonb", { params: ['[{"a":1}]'], row: { x: [{ b: 2 }] } }), [{ b: 2 }, { a: 1 }]);
    assert.equal(evalSql("c.custom_fields->>'crm_archived_at' IS NULL", { rows: { c: { custom_fields: {} } } }), true);
    assert.equal(evalSql("c.custom_fields->>'crm_archived_at' IS NULL", { rows: { c: { custom_fields: { crm_archived_at: "2026-10-29" } } } }), false);
    assert.throws(() => evalSql("mystery(1)", ctx), /does not know the function mystery/);
  });

  test("a SELECT list is read as named columns and a row carries only those", () => {
    const sql = `SELECT page.id, page.channel, (last.direction = 'inbound') AS needs_reply,
                        COALESCE(last.created_at, page.created_at) AS activity_at
                   FROM page LEFT JOIN LATERAL (SELECT m.id, m.direction, m.created_at FROM messages m LIMIT 1) last ON true`;
    const outer = selectList(sql, 0);
    assert.deepEqual(namesOf(outer), ["id", "channel", "needs_reply", "activity_at"]);
    const inner = selectList(sql, /m\.direction/);
    assert.deepEqual(namesOf(inner), ["id", "direction", "created_at"]);
    const row = projectRow(outer, { rows: { page: { id: 1, channel: "sms", created_at: "a", secret: "x" }, last: { direction: "inbound", created_at: "b" } } });
    assert.deepEqual(row, { id: 1, channel: "sms", needs_reply: true, activity_at: "b" });
    const none = projectRow(outer, { rows: { page: { id: 2, channel: "sms", created_at: "a" }, last: null } });
    assert.equal(none.needs_reply, null, "nobody spoke: not false");
    assert.equal(none.activity_at, "a");
  });

  test("a counted list with a filter, a window count and trim/concat_ws", () => {
    const sql = `SELECT c.*, COUNT(*) OVER () AS queue_total,
                        count(*) FILTER (WHERE c.outcome = 'deposit')::int AS deposits,
                        trim(both ' ' FROM concat_ws(' ', cl.first_name, cl.last_name)) AS client_name
                   FROM x c`;
    const items = selectList(sql);
    assert.deepEqual(namesOf(items), ["*", "queue_total", "deposits", "client_name"]);
    const rows = [{ outcome: "deposit" }, { outcome: "no_show" }].map((r) => ({ rows: { c: r }, row: r }));
    const out = projectRow(items, { rows: { c: { id: 9, outcome: "deposit" }, cl: { first_name: "Dana", last_name: null } }, window: rows, group: rows });
    assert.deepEqual([out.id, out.queue_total, out.deposits, out.client_name], [9, 2, 1, "Dana"]);
  });

  test("an UPDATE applies the SET list as written and answers its RETURNING list", () => {
    const table = [{ id: "a", status: "awaiting_approval", approved_by: null, approved_at: null }, { id: "b", status: "awaiting_approval", approved_by: null, approved_at: null }];
    const out = runUpdate(`UPDATE social_posts SET approved_at = now(), approved_by = $2, status = 'queued'
                            WHERE id = $1 AND status = 'awaiting_approval' RETURNING id, status, approved_at`,
      ["a", "staff-1"], table, { now: "NOW" });
    assert.deepEqual(out.rows, [{ id: "a", status: "queued", approved_at: "NOW" }]);
    assert.equal(table[0].approved_by, "staff-1");
    assert.equal(table[1].status, "awaiting_approval", "the other row is untouched");
    const bump = runUpdate("UPDATE social_posts SET attempt = attempt + 1 WHERE id = $1", ["b"], [{ id: "b", attempt: 2 }]);
    assert.equal(bump.rowCount, 1);
  });

  test("an INSERT ... ON CONFLICT DO UPDATE inserts, then updates the same row by its key", () => {
    const rows = [];
    const sql = `INSERT INTO t (org_id, partner_id, status, note)
                 VALUES ($1, $2, 'active', $3)
                 ON CONFLICT (org_id, partner_id) DO UPDATE
                   SET status = CASE WHEN t.status = 'complete' THEN 'complete' ELSE EXCLUDED.status END,
                       note = COALESCE(EXCLUDED.note, t.note)
                 RETURNING *`;
    const first = runInsert(sql, ["o", "p", "hello"], rows);
    assert.equal(first.inserted, true);
    assert.equal(rows.length, 1);
    rows[0].status = "complete";
    const second = runInsert(sql, ["o", "p", null], rows);
    assert.equal(second.inserted, false);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "complete");
    assert.equal(rows[0].note, "hello", "a null new note keeps the old one");
    assert.deepEqual(second.rows[0].status, "complete");
  });

  test("ON CONFLICT with a partial-index predicate and ON CONFLICT DO NOTHING", () => {
    const rows = [{ partner_id: "p", task_key: "k", resolved_at: "done", detail: "old" }];
    const sql = `INSERT INTO t (partner_id, task_key, detail) VALUES ($1, $2, $3)
                 ON CONFLICT (partner_id, task_key) WHERE resolved_at IS NULL
                 DO UPDATE SET detail = EXCLUDED.detail RETURNING *`;
    // The only existing row is resolved, so the partial index does not apply: a second row is added.
    const fresh = runInsert(sql, ["p", "k", "again"], rows);
    assert.equal(fresh.inserted, true);
    assert.equal(rows.length, 2);
    // Now there is an open row: the same key updates it.
    const upd = runInsert(sql, ["p", "k", "newer"], rows);
    assert.equal(upd.inserted, false);
    assert.equal(rows.length, 2);
    assert.equal(rows[1].detail, "newer");
    assert.equal(rows[0].detail, "old", "the resolved row is left alone");
    const plain = [];
    const nothing = runInsert("INSERT INTO t (a, b) VALUES ($1, 'x') ON CONFLICT DO NOTHING RETURNING a", [7], plain);
    assert.deepEqual(nothing.rows, [{ a: 7 }]);
    assert.deepEqual(plain, [{ a: 7, b: "x" }]);
  });

  test("ORDER BY keeps its direction and its NULLS LAST; WHERE and ORDER BY text can be lifted from a statement", () => {
    const sql = "SELECT * FROM q WHERE org_id = $1 AND d IS NOT NULL ORDER BY requested_at ASC NULLS LAST, created_at ASC LIMIT 5";
    assert.equal(whereOf(sql), "org_id = $1 AND d IS NOT NULL");
    assert.equal(orderOf(sql), "requested_at ASC NULLS LAST, created_at ASC");
    const rows = [{ requested_at: null, created_at: "1" }, { requested_at: "2", created_at: "2" }, { requested_at: "1", created_at: "3" }];
    assert.deepEqual(orderRows(rows, orderOf(sql)).map((r) => r.created_at), ["3", "2", "1"]);
    assert.deepEqual(orderRows(rows, "requested_at DESC NULLS LAST").map((r) => r.created_at), ["2", "3", "1"]);
    assert.deepEqual(keep([{ org_id: "o", d: 1 }, { org_id: "x", d: 1 }, { org_id: "o", d: null }], whereOf(sql), ["o"]).length, 1);
    assert.deepEqual(splitTop("a, f(b, c), d"), ["a", "f(b, c)", "d"]);
  });
});
