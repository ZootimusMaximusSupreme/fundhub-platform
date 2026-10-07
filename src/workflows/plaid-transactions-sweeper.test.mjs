// The daily Plaid transactions sweep. Stubbed list and sync; no Inngest, no
// Plaid, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { sweep, SWEEP_CRON } from "./plaid-transactions-sweeper.mjs";

const ENV = {
  PLAID_CLIENT_ID: "cid", PLAID_SECRET: "sec",
  PLAID_TOKEN_ENC_KEY: crypto.randomBytes(32).toString("base64"), PLAID_ENV: "sandbox"
};
const NOW = new Date("2026-10-06T07:00:00Z");

/* Most tests below do not care about the reconnect texts (FinanceOS F2); they hand the
   sweep this stand-in so the real one never runs against the empty `{}` database. */
const quietNotify = async () => ({ checked: 0, queued: 0, notEntitled: 0, notQueued: [], skipped: [], errored: [] });

test("does nothing at all when Plaid is not configured", async () => {
  const t = await sweep({}, {
    env: {}, now: NOW,
    list: async () => assert.fail("must not read clients"),
    sync: async () => assert.fail("must not sync"),
    notify: async () => assert.fail("must not queue a reconnect text")
  });
  assert.equal(t.skipped, "not_configured");
  assert.equal(t.checked, 0);
  assert.equal(t.reconnect, null, "the reconnect step did not run");
});

test("syncs every listed client; one failure does not stop the rest", async () => {
  const seen = [];
  const t = await sweep({}, {
    env: ENV, now: NOW,
    list: async () => [{ org_id: "o", client_id: "c1" }, { org_id: "o", client_id: "c2" }, { org_id: "o", client_id: "c3" }],
    sync: async (_db, args) => {
      seen.push(args);
      if (args.clientId === "c2") throw new Error("boom");
      if (args.clientId === "c3") return { ok: false, reason: "upstream_error", totals: { written: 0 } };
      return { ok: true, totals: { written: 7 }, bills: { bills: 2 } };
    }
  });
  assert.equal(t.checked, 3);
  assert.equal(t.synced, 1);
  assert.equal(t.written, 7);
  assert.deepEqual(t.failed.map((f) => [f.clientId, f.reason]), [["c2", "errored"], ["c3", "upstream_error"]]);
  assert.equal(seen[0].asOf, NOW.toISOString());
  assert.equal(seen[0].orgId, "o");
});

test("each client is its own Inngest step, and the reconnect texts are one more at the end", async () => {
  const names = [];
  const step = { run: async (name, fn) => { names.push(name); return fn(); } };
  await sweep({}, {
    env: ENV, now: NOW, step, notify: quietNotify,
    list: async () => [{ org_id: "o", client_id: "c1" }],
    sync: async () => ({ ok: true, totals: { written: 0 } })
  });
  assert.deepEqual(names, ["list-clients", "sync-c1", "reconnect-notices"]);
});

test("runs daily", () => {
  assert.equal(SWEEP_CRON, "0 7 * * *");
});

/* ── the account refresh (FinanceOS F1) ─────────────────────────────────────── */

const ROWS = [{ org_id: "o", client_id: "c1" }, { org_id: "o", client_id: "c2" }, { org_id: "o", client_id: "c3" }];
const okRefresh = (totals = {}) => ({ ok: true, totals: { created: 0, vanished: 0, balancesChanged: 0, relink: 0, ...totals } });

test("each client's accounts are refreshed BEFORE their transactions are read", async () => {
  const log = [];
  await sweep({}, {
    env: ENV, now: NOW, list: async () => ROWS.slice(0, 2),
    refresh: async (_db, a) => { log.push(`refresh:${a.clientId}`); return okRefresh(); },
    sync: async (_db, a) => { log.push(`sync:${a.clientId}`); return { ok: true, totals: { written: 0 } }; }
  });
  // Per client the refresh comes first: a transaction is only stored for an account
  // that is already in bank_accounts, and the 07:30 jobs read what this wrote.
  assert.deepEqual(log, ["refresh:c1", "sync:c1", "refresh:c2", "sync:c2"]);
});

test("the refresh gets the same org, client and instant as the transactions sync", async () => {
  let r, s;
  await sweep({}, {
    env: ENV, now: NOW, list: async () => [ROWS[0]],
    refresh: async (_db, a) => { r = a; return okRefresh(); },
    sync: async (_db, a) => { s = a; return { ok: true, totals: { written: 0 } }; }
  });
  assert.deepEqual(r, s);
  assert.equal(r.asOf, NOW.toISOString());
  assert.equal(r.orgId, "o");
});

test("a refresh that fails or throws never stops the transactions sync, and is kept apart in the tally", async () => {
  const synced = [];
  const t = await sweep({}, {
    env: ENV, now: NOW, list: async () => ROWS,
    refresh: async (_db, a) => {
      if (a.clientId === "c1") return { ok: false, reason: "upstream_error", totals: {} };
      if (a.clientId === "c2") throw new Error("accounts boom");
      return okRefresh();
    },
    sync: async (_db, a) => { synced.push(a.clientId); return { ok: true, totals: { written: 5 } }; }
  });
  assert.deepEqual(synced, ["c1", "c2", "c3"], "a transactions sync was skipped because a refresh failed");
  assert.equal(t.synced, 3);
  assert.equal(t.written, 15);
  assert.deepEqual(t.failed, [], "a refresh failure is not a transactions failure");
  assert.equal(t.accounts.refreshed, 1);
  assert.deepEqual(t.accounts.failed.map((f) => [f.clientId, f.reason]), [["c1", "upstream_error"], ["c2", "errored"]]);
  assert.equal(t.accounts.failed[1].error, "accounts boom");
});

test("a transactions failure still reports that client's refresh", async () => {
  const t = await sweep({}, {
    env: ENV, now: NOW, list: async () => [ROWS[0]],
    refresh: async () => okRefresh({ created: 1 }),
    sync: async () => { throw new Error("tx boom"); }
  });
  assert.deepEqual(t.failed.map((f) => [f.clientId, f.reason]), [["c1", "errored"]]);
  assert.equal(t.accounts.refreshed, 1);
  assert.equal(t.accounts.created, 1);
});

test("the tally counts new accounts, vanished accounts, moved balances and logins that need the client", async () => {
  const t = await sweep({}, {
    env: ENV, now: NOW, list: async () => ROWS.slice(0, 2),
    refresh: async (_db, a) => (a.clientId === "c1"
      ? okRefresh({ created: 1, vanished: 2, balancesChanged: 3, relink: 0 })
      : okRefresh({ created: 0, vanished: 0, balancesChanged: 4, relink: 1 })),
    sync: async () => ({ ok: true, totals: { written: 0 } })
  });
  assert.deepEqual(t.accounts, { refreshed: 2, created: 1, vanished: 2, balancesChanged: 7, relink: 1, failed: [] });
});

test("not configured: nothing is refreshed either", async () => {
  const t = await sweep({}, {
    env: {}, now: NOW,
    list: async () => assert.fail("must not read clients"),
    refresh: async () => assert.fail("must not refresh"),
    sync: async () => assert.fail("must not sync")
  });
  assert.equal(t.skipped, "not_configured");
  assert.equal(t.accounts.refreshed, 0);
});

test("the refresh rides inside the client's one step — the only step added is the reconnect one", async () => {
  const names = [];
  const step = { run: async (name, fn) => { names.push(name); return fn(); } };
  await sweep({}, {
    env: ENV, now: NOW, step, list: async () => [ROWS[0]], notify: quietNotify,
    refresh: async () => okRefresh(), sync: async () => ({ ok: true, totals: { written: 0 } })
  });
  assert.deepEqual(names, ["list-clients", "sync-c1", "reconnect-notices"]);
});

/* ── the reconnect texts (FinanceOS F2) ─────────────────────────────────────── */

test("the reconnect texts run ONCE, after every client has been read, on the pass's own database and clock", async () => {
  const log = [];
  const conn = { marker: "the pass's db" };
  const t = await sweep(conn, {
    env: ENV, now: NOW, list: async () => ROWS,
    refresh: async (_db, a) => { log.push(`refresh:${a.clientId}`); return okRefresh(); },
    sync: async (_db, a) => { log.push(`sync:${a.clientId}`); return { ok: true, totals: { written: 0 } }; },
    notify: async (db, args) => {
      log.push("notify");
      assert.equal(db, conn);
      assert.equal(args.now, NOW);
      return { checked: 0, queued: 0, notEntitled: 0, notQueued: [], skipped: [], errored: [] };
    }
  });
  assert.deepEqual(log, ["refresh:c1", "sync:c1", "refresh:c2", "sync:c2", "refresh:c3", "sync:c3", "notify"]);
  assert.equal(t.reconnect.ok, true);
});

test("it runs even when nobody has an active login — a login that broke drops out of the list the loop walks", async () => {
  let ran = 0;
  const t = await sweep({}, {
    env: ENV, now: NOW, list: async () => [],
    refresh: async () => assert.fail("no client to refresh"), sync: async () => assert.fail("no client to sync"),
    notify: async () => { ran += 1; return { checked: 1, queued: 1, notEntitled: 0, notQueued: [], skipped: [], errored: [] }; }
  });
  assert.equal(ran, 1);
  assert.equal(t.checked, 0);
  assert.equal(t.reconnect.queued, 1);
});

test("the tally keeps the counts: looked at, texted, not entitled, refused, skipped — and what went wrong", async () => {
  const t = await sweep({}, {
    env: ENV, now: NOW, list: async () => [],
    notify: async () => ({
      checked: 5, queued: 2, notEntitled: 1,
      notQueued: [{ itemRowId: "i1", reason: "opted_out" }], skipped: [{ itemRowId: "i2" }, { itemRowId: "i3" }],
      errored: [{ itemRowId: "i4", error: "template store down" }]
    })
  });
  assert.deepEqual(t.reconnect, {
    ok: true, checked: 5, queued: 2, notEntitled: 1, notQueued: 1, skipped: 2,
    errored: [{ itemRowId: "i4", error: "template store down" }]
  });
});

test("a reconnect step that throws is recorded and never takes the pass down — the Plaid numbers stand", async () => {
  const t = await sweep({}, {
    env: ENV, now: NOW, list: async () => [ROWS[0]],
    refresh: async () => okRefresh({ created: 1 }), sync: async () => ({ ok: true, totals: { written: 4 } }),
    notify: async () => { throw new Error("messages table down"); }
  });
  assert.equal(t.synced, 1);
  assert.equal(t.written, 4);
  assert.equal(t.accounts.created, 1);
  assert.equal(t.reconnect.ok, false);
  assert.deepEqual(t.reconnect.errored, [{ error: "messages table down" }]);
  assert.equal(t.reconnect.queued, 0);
});

test("the default is the real notice job, and a database that cannot answer is recorded, not thrown", async () => {
  const t = await sweep({}, { env: ENV, now: NOW, list: async () => [] });
  assert.equal(t.reconnect.ok, false);
  assert.equal(t.reconnect.errored.length, 1);
});

test("the default refresh is the real one, and a database that cannot answer is recorded, not thrown", async () => {
  // No refresh injected and a database that is not one: the real refreshClientAccounts
  // fails inside its own try and the transactions sync still runs.
  let synced = false;
  const t = await sweep({}, {
    env: ENV, now: NOW, list: async () => [ROWS[0]],
    sync: async () => { synced = true; return { ok: true, totals: { written: 0 } }; }
  });
  assert.equal(synced, true);
  assert.equal(t.accounts.failed.length, 1);
  assert.equal(t.accounts.failed[0].reason, "errored");
});
