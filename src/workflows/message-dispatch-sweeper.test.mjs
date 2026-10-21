// Tests for the message dispatch sweeper.
//
// The most important test in this file is the last one: that the sweeper is NOT
// registered. Everything else here is about a pass being bounded and surviving a
// failure; that one is about the fact that building the dispatcher must not have
// started sending.

import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sweep, SWEEP_CRON, messageDispatchSweeper } from "./message-dispatch-sweeper.mjs";
import { DEFAULT_BATCH } from "../messaging/dispatch.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* A database with nothing queued anywhere. The sweeper's job is to find the
   companies with mail waiting and delegate; what happens to a claimed message is
   dispatch.test.mjs's subject. */
const emptyDb = () => ({ query: async () => ({ rows: [] }) });

/* One company, sending switched on, with something waiting. Enough for the
   sweep to walk its whole path: find orgs → read the switch → check the cap →
   claim a batch. */
const oneOrgDb = (onClaim) => ({
  query: async (sql, params) => {
    if (/SELECT DISTINCT org_id FROM messages/.test(sql)) return { rows: [{ org_id: "org-1" }] };
    if (/FROM messaging_settings/.test(sql)) {
      return { rows: [{ org_id: "org-1", outbound_enabled: true, daily_send_cap: 0 }] };
    }
    if (sql.startsWith("UPDATE messages m")) { onClaim(params); return { rows: [] }; }
    return { rows: [] };
  }
});

describe("the sweeper", () => {
  test("an empty queue is a clean, quiet pass", async () => {
    const res = await sweep(emptyDb());
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.orgs, 0);
    assert.strictEqual(res.dispatched, 0);
  });

  test("a pass is bounded by the batch size", async () => {
    let limit = null;
    await sweep(oneOrgDb((params) => { [, limit] = params; }));
    assert.strictEqual(limit, DEFAULT_BATCH,
      "a pass must claim a bounded batch, not everything that is due");
  });

  test("an explicit limit is honoured", async () => {
    let limit = null;
    await sweep(oneOrgDb((params) => { [, limit] = params; }), { limit: 5 });
    assert.strictEqual(limit, 5);
  });

  test("EVERY COMPANY IS SWEPT, not just the first one", async () => {
    const seen = [];
    const db = {
      query: async (sql, params) => {
        if (/SELECT DISTINCT org_id FROM messages/.test(sql)) {
          return { rows: [{ org_id: "org-1" }, { org_id: "org-2" }] };
        }
        if (/FROM messaging_settings/.test(sql)) {
          seen.push(params[0]);
          return { rows: [{ org_id: params[0], outbound_enabled: true, daily_send_cap: 0 }] };
        }
        return { rows: [] };
      }
    };
    const res = await sweep(db);
    assert.deepEqual(seen, ["org-1", "org-2"]);
    assert.strictEqual(res.orgs, 2);
  });

  /* A failing pass must not take the scheduled function down. The next pass is
     the recovery: nothing it failed to finish was lost, because an unclaimed
     message is still queued and still due. */
  test("a broken database is reported, not thrown", async () => {
    const db = { query: async () => { throw new Error("connection refused"); } };
    const res = await sweep(db);
    assert.strictEqual(res.ok, false);
    assert.match(res.error, /connection refused/);
  });

  test("it does not loop until the queue is empty", () => {
    const src = fs.readFileSync(path.join(HERE, "message-dispatch-sweeper.mjs"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/\bwhile\s*\(|\bfor\s*\(/.test(code),
      "a pass must be one bounded batch — an unbounded drain holds the function open for as long as the backlog is long");
  });

  test("it runs often enough that a text held overnight goes out near 11am", () => {
    const [minute] = SWEEP_CRON.split(" ");
    assert.match(minute, /^\*\/(\d+)$/);
    assert.ok(Number(minute.slice(2)) <= 15,
      "a text held to 08:00 Arizona should go out within minutes of the window opening");
  });
});

// ---------------------------------------------------------------------------
// THE ONE THAT MATTERS
// ---------------------------------------------------------------------------

describe("what actually gates sending", () => {
  /* THIS BLOCK USED TO ASSERT THE SWEEPER WAS NOT REGISTERED, and said in
     capitals not to "fix" it by adding the export. That guard was right for the
     product it was written in and it is what shipped: twenty-six workflows
     queued client email and nothing ever drained it, invisibly, forever.

     The owner asked for that to end ("holy shit, we gotta send out emails…
     it should be an option, the ability to set it up"), so the gate MOVED
     rather than being deleted. It is now a per-company row —
     messaging_settings.outbound_enabled (119) — which is visible in the CRM,
     changeable by an owner, attributed, and per tenant. An env var was none of
     those things.

     These tests guard the gate that replaced it. If sending ever stops being
     refusable per company, or the drain ever reaches a provider without going
     through the gate, this is what should go red. */

  test("the sweeper IS registered — the queue has something draining it", () => {
    // On the Netlify cron clock's list since 2026-10-20 (Inngest serves event workflows only).
    const scheduled = fs.readFileSync(path.join(HERE, "scheduled.mjs"), "utf8");
    assert.ok(/^\s*messageDispatchSweeper,$/m.test(scheduled),
      "nothing drains the outbound queue — every client email would sit in the table forever");
  });

  test("THE SWEEP GOES THROUGH THE PER-COMPANY SWITCH, never straight to the dispatcher", async () => {
    const src = fs.readFileSync(path.join(HERE, "message-dispatch-sweeper.mjs"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(/drainAll\(/.test(code),
      "the sweep must call outbox.drainAll(), which applies the switch and the daily cap");
    assert.ok(!/dispatchDue\(/.test(code),
      "the sweep calls dispatchDue() directly, which bypasses the per-company switch and cap");
  });

  test("a paused company sends nothing, even on a scheduled pass", async () => {
    const { drain } = await import("../messaging/outbox.mjs");
    const db = {
      query: async (sql) => {
        if (/FROM messaging_settings/.test(sql)) {
          return { rows: [{ org_id: "org-1", outbound_enabled: false, daily_send_cap: 500 }] };
        }
        throw new Error("drain reached the database past a paused switch: " + sql);
      }
    };
    const out = await drain(db, { orgId: "org-1" });
    assert.equal(out.ran, false);
    assert.equal(out.reason, "paused");
    assert.equal(out.dispatched, 0);
  });

  test("the daily cap stops a runaway rather than mailing a book", async () => {
    const { drain } = await import("../messaging/outbox.mjs");
    const db = {
      query: async (sql) => {
        if (/FROM messaging_settings/.test(sql)) {
          return { rows: [{ org_id: "org-1", outbound_enabled: true, daily_send_cap: 10 }] };
        }
        if (/count\(\*\)::int AS n FROM messages/.test(sql)) return { rows: [{ n: 10 }] };
        throw new Error("drain dispatched past its daily cap: " + sql);
      }
    };
    const out = await drain(db, { orgId: "org-1" });
    assert.equal(out.ran, false);
    assert.equal(out.reason, "daily_cap_reached");
  });

  test("it is defined, and the definition is one reviewable file", () => {
    assert.ok(messageDispatchSweeper);
  });

  test("the sweeper carries no bypass flag", () => {
    const src = fs.readFileSync(path.join(HERE, "message-dispatch-sweeper.mjs"), "utf8");
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''");
    for (const flag of ["force", "skipCompliance", "skip_compliance", "override", "test_bypass", "bypass"]) {
      assert.ok(!new RegExp(`\\b${flag}\\b`, "i").test(code),
        `the sweeper must not contain a ${flag} identifier`);
    }
  });
});
