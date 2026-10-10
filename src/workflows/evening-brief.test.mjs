import { test } from "node:test";
import assert from "node:assert/strict";
import { EVENING_BRIEF_CRON, handle, eveningBrief } from "./evening-brief.mjs";

test("evening brief runs at 9:00 p.m. Arizona", () => {
  assert.equal(EVENING_BRIEF_CRON, "0 4 * * *");
  assert.equal(eveningBrief.id(), "evening-brief");
  const triggers = eveningBrief.opts.triggers || [];
  assert.deepEqual(triggers.map((t) => t.cron), ["0 4 * * *"]);
});

test("evening job texts with the morning switch and never runs the pulse", async () => {
  const seen = [];
  const step = { run: async (_name, fn) => fn() };
  const db = { query: async () => ({ rows: [] }) };
  const out = await handle({
    db,
    step,
    env: {},
    brief: async (args) => {
      seen.push(args);
      return { ok: true };
    }
  });
  assert.equal(out.ok, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].kind, "evening");
  assert.equal(seen[0].live, true);
  assert.equal(seen[0].pulse, undefined);
});

test("no database: nothing to build, nothing sent", async () => {
  const out = await handle({ db: null, step: { run: async () => { throw new Error("must not run"); } } });
  assert.deepEqual(out, { ok: false, reason: "no_db" });
});
