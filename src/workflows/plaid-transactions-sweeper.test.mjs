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

test("does nothing at all when Plaid is not configured", async () => {
  const t = await sweep({}, {
    env: {}, now: NOW,
    list: async () => assert.fail("must not read clients"),
    sync: async () => assert.fail("must not sync")
  });
  assert.equal(t.skipped, "not_configured");
  assert.equal(t.checked, 0);
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

test("each client is its own Inngest step", async () => {
  const names = [];
  const step = { run: async (name, fn) => { names.push(name); return fn(); } };
  await sweep({}, {
    env: ENV, now: NOW, step,
    list: async () => [{ org_id: "o", client_id: "c1" }],
    sync: async () => ({ ok: true, totals: { written: 0 } })
  });
  assert.deepEqual(names, ["list-clients", "sync-c1"]);
});

test("runs daily", () => {
  assert.equal(SWEEP_CRON, "0 7 * * *");
});
