/* Tests for the Commas payment-inbox drain.
 *
 * The one that matters is the last one: that this is REGISTERED. The whole
 * reason the file exists is that the queue's only clock had silently stopped,
 * so six real payments sat pending with attempts=0 and nothing tried them.
 * A drain nothing serves is the defect it was written to close. */

import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sweep, SWEEP_CRON, BATCH, commasInboxDrain } from "./commas-inbox-drain.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* A queue with nothing waiting. claim() is an UPDATE ... RETURNING *, so an
   empty result is "nothing to do". */
const emptyDb = () => ({ query: async () => ({ rows: [] }) });

/* A queue holding `count` rows, handed out on the first claim and empty after —
   the shape of one real pass that finds a backlog and clears it. */
const queuedDb = (count, onClaim) => {
  let served = false;
  return {
    query: async (sql, params) => {
      if (/UPDATE commas_inbox\s+SET status = 'processing'/.test(sql)) {
        if (served) return { rows: [] };
        served = true;
        if (onClaim) onClaim(params);
        return {
          rows: Array.from({ length: count }, (_, i) => ({
            id: `row-${i}`,
            payment_id: `pay-${i}`,
            event_type: "payment.succeeded",
            attempts: 1
          }))
        };
      }
      return { rows: [] };
    }
  };
};

describe("the payment inbox drain", () => {
  test("an empty queue is a clean, quiet pass", async () => {
    const res = await sweep(emptyDb(), { process: async () => ({ ok: true }) });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.claimed, 0);
  });

  test("a pending payment is actually picked up and marked done", async () => {
    const seen = [];
    const res = await sweep(queuedDb(2), {
      process: async (row) => { seen.push(row.payment_id); return { ok: true }; }
    });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.claimed, 2);
    assert.strictEqual(res.counts.done, 2);
    assert.deepStrictEqual(seen, ["pay-0", "pay-1"]);
  });

  test("a pass is bounded by the batch size", async () => {
    let limit = null;
    await sweep(queuedDb(1, (params) => { limit = params[2]; }), {
      process: async () => ({ ok: true })
    });
    assert.strictEqual(limit, BATCH,
      "a pass must claim a bounded batch, not the whole backlog");
  });

  test("one bad payment does not stop the good ones behind it", async () => {
    const res = await sweep(queuedDb(3), {
      process: async (row) => {
        if (row.payment_id === "pay-1") throw new Error("bad payload");
        return { ok: true };
      }
    });
    assert.strictEqual(res.counts.done, 2);
    assert.strictEqual(res.counts.failed, 1);
  });

  test("a pass that blows up reports it instead of taking the schedule down", async () => {
    const brokenDb = { query: async () => { throw new Error("database is gone"); } };
    const res = await sweep(brokenDb, { process: async () => ({ ok: true }) });
    assert.strictEqual(res.ok, false);
    assert.match(res.error, /database is gone/);
  });

  test("it runs every minute — the money path, and a human feels this delay", () => {
    assert.strictEqual(SWEEP_CRON, "* * * * *");
  });

  /* HOLE N6, 2026-09-18. This drain went sixteen hours on live without ever
     being called, and nobody could tell, because a pass that found nothing
     wrote nothing: the log looked the same whether the timer fired or not.
     Every pass must now leave exactly one line, so the live log alone answers
     "is the backup running?" — and a pass that finds a receipt says so. */
  test("every pass leaves one line in the log — an empty queue included", async () => {
    const mod = await import("./commas-inbox-drain.mjs");
    assert.strictEqual(typeof mod.scheduledPass, "function",
      "the timer's pass is not exported, so nothing guarantees a log line " +
      "for every run and 'never called' still looks like 'nothing to do'");

    const lines = [];
    const log = { log: (m) => lines.push(m), error: (m) => lines.push(`ERROR ${m}`) };

    const quiet = await mod.scheduledPass(emptyDb(), log);
    assert.strictEqual(quiet.ok, true);
    assert.strictEqual(lines.length, 1, "an empty pass must still say it ran");
    assert.match(lines[0], /^\[commas-inbox-drain\] pass ok: nothing waiting$/);

    /* A pending receipt: the pass picks it up, marks it done, and says so. */
    const worked = await mod.scheduledPass(queuedDb(1), log);
    assert.strictEqual(worked.ok, true);
    assert.strictEqual(worked.claimed, 1);
    assert.strictEqual(lines.length, 2);
    assert.match(lines[1], /^\[commas-inbox-drain\] processed 1 payment event\(s\)/);

    const brokenDb = { query: async () => { throw new Error("database is gone"); } };
    const broken = await mod.scheduledPass(brokenDb, log);
    assert.strictEqual(broken.ok, false);
    assert.strictEqual(lines.length, 3);
    assert.match(lines[2], /^ERROR \[commas-inbox-drain\] pass failed: database is gone/);
  });

  /* The Netlify sweeper runs the identical pass on its own timer, every
     minute, so the two WILL overlap. A receipt must be worked by exactly one
     of them. The queue below follows the real claim's rules — only pending or
     failed rows under the attempt cap are taken, and taking a row marks it
     processing in the same step, as the single UPDATE ... FOR UPDATE SKIP
     LOCKED statement does — and every query yields, so four passes from the
     two clocks genuinely interleave. The real-Postgres half of this guarantee
     is in src/payments/commas-inbox.pg.test.mjs. */
  test("the backup and the Netlify sweeper running at once never work one receipt twice", async () => {
    const { sweepCommasInbox } = await import("../../netlify/functions/commas-inbox-sweeper.mjs");
    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: `row-${i}`, payment_id: `pay-${i}`, event_type: "payment.succeeded",
      status: "pending", attempts: 0
    }));
    const tick = () => new Promise((resolve) => setImmediate(resolve));
    const sharedDb = {
      query: async (sql, params) => {
        await tick();
        if (/UPDATE commas_inbox\s+SET status = 'processing'/.test(sql)) {
          const [maxAttempts, , limit] = params;
          const taken = rows
            .filter((r) => r.attempts < maxAttempts && (r.status === "pending" || r.status === "failed"))
            .slice(0, limit);
          for (const r of taken) { r.status = "processing"; r.attempts += 1; }
          return { rows: taken.map((r) => ({ ...r })) };
        }
        const finished = /SET status = '(done|ignored|failed)'/.exec(sql);
        if (finished) {
          const r = rows.find((x) => x.id === params[0]);
          if (r) r.status = finished[1];
        }
        return { rows: [] };
      }
    };
    const worked = [];
    const work = async (row) => { worked.push(row.id); await tick(); return { ok: true }; };

    const passes = await Promise.all([
      sweepCommasInbox(sharedDb, { process: work, limit: 2 }),
      sweep(sharedDb, { process: work, limit: 2 }),
      sweepCommasInbox(sharedDb, { process: work, limit: 2 }),
      sweep(sharedDb, { process: work, limit: 2 })
    ]);

    assert.ok(passes.every((p) => p.ok), JSON.stringify(passes));
    assert.ok(passes.filter((p) => p.claimed > 0).length >= 2,
      "the passes did not overlap, so this proved nothing about overlap");
    assert.deepStrictEqual([...worked].sort(), rows.map((r) => r.id).sort(),
      "a receipt was worked twice, or one was never worked");
    assert.strictEqual(passes.reduce((n, p) => n + p.claimed, 0), rows.length);
    assert.ok(rows.every((r) => r.status === "done" && r.attempts === 1));
  });

  /* THE POINT OF THE WHOLE FILE. GAP 5: a $2,500 receipt was accepted and its
     invoice never closed, because the only thing draining the queue was a
     Netlify cron that had stopped firing. This asserts the drain is on a
     scheduler that is running.

     2026-10-20 (owner: "stop burning ingests"): the Inngest twin of this pass is
     retired, so the one clock under the queue is the Netlify scheduled function
     commas-inbox-sweeper, every 5 minutes, with its own job row (red at 3x) and
     the hourly pay-webhook beat watching it. */
  test("THE DRAIN IS SERVED — the Netlify sweeper is on the clock and watched; the Inngest twin is retired", async () => {
    const { NETLIFY_JOBS } = await import("../pulse/heartbeats.mjs");
    assert.deepStrictEqual(NETLIFY_JOBS.find(([job]) => job === "commas-inbox-sweeper"), ["commas-inbox-sweeper", "*/5 * * * *"],
      "nothing drains the payment queue on a watched clock, so a client who paid stays unpaid on screen");
    const toml = fs.readFileSync(path.resolve(HERE, "../../netlify.toml"), "utf8");
    assert.match(toml, /\[functions\."commas-inbox-sweeper"\]\s*\n\s*schedule = "\*\/5 \* \* \* \*"/);
    const { functions } = await import("./index.mjs");
    assert.ok(!functions.map((fn) => fn.id()).includes(commasInboxDrain.id()),
      "the retired Inngest twin is registered again — two clocks on one queue, and 86,400 Inngest executions a month");
  });
});
