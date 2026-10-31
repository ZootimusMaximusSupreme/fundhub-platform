// followup-live-cleanup.mjs — cancel and remove the two plus-tag test leads of followup-live-proof.mjs.
// PRODUCTION. Run only after the follow-up release has shipped and the release hold note is gone.
// One-off cleanup for the live follow-up proof (2026-10-31).
//
//   node --env-file=.env scripts/followup-live-cleanup.mjs cancel    stop the two test leads' sleeping workflows in Inngest
//   node --env-file=.env scripts/followup-live-cleanup.mjs report    count their rows, change nothing
//   node --env-file=.env scripts/followup-live-cleanup.mjs delete    remove their rows in ONE transaction
//
// Scope: only the two plus-tag addresses in state.json, only the Fundhub org. The walk is
// scripts/purge-sim-data.mjs's (every foreign key pointing at a client, deepest first, with
// savepoints), narrowed to these two people. Every setting is transaction-local
// (set_config(..., true)), never a session setting through the pooler. If anything still
// points at a client at the end, the whole transaction rolls back and nothing is removed.
import fs from "node:fs";
import pg from "pg";

const HERE = new URL("../ops/workflows/followup-flows-2026-10-31-evidence/", import.meta.url).pathname; // gitignored: the test addresses never reach git
fs.mkdirSync(HERE, { recursive: true });
const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const state = JSON.parse(fs.readFileSync(`${HERE}live-state.json`, "utf8"));
const emails = Object.values(state.people).map((p) => p.email.toLowerCase());
const OURS = /^stanbridgejchris\+fhtest\+sim-fu-(ana|ben)-[a-z0-9]+@gmail\.com$/;
if (!emails.length || !emails.every((e) => OURS.test(e))) throw new Error("state.json holds an address that is not one of this test's plus-tag leads");
const list = emails.map((e) => `'${e}'`).join(", ");

async function cancel() {
  const after = new Date(Date.parse(state.startedAt) - 2 * 60 * 1000).toISOString();
  const before = new Date(Date.now() + 60 * 1000).toISOString();
  const cond = emails.map((e) => `event.data.payload.email == '${e}'`).join(" || ");
  for (const fn of ["s-02-incomplete-survey-nudge", "s-nobook-chase"]) {
    const res = await fetch("https://api.inngest.com/v1/cancellations", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.INNGEST_SIGNING_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: "fundhub-platform", function_id: fn, started_after: after, started_before: before, if: cond })
    });
    console.log(fn, res.status, (await res.text()).slice(0, 300));
  }
}

async function withTx(fn) {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: /@(127\.0\.0\.1|localhost)[:/]/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('fundhub.actor', 'staff', true), set_config('fundhub.partner_id', '', true)");
    return await fn(c);
  } finally {
    await c.end();
  }
}

const IDS = `SELECT id FROM clients WHERE org_id = '${ORG}' AND lower(email) IN (${list})`;

async function referrers(c, table) {
  const { rows } = await c.query(`
    SELECT cl.relname AS child_table, a.attname AS child_column
      FROM pg_constraint con
      JOIN pg_class cl    ON cl.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = cl.relnamespace
      JOIN LATERAL unnest(con.conkey) AS k(attnum) ON true
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
     WHERE con.contype = 'f' AND ns.nspname = 'public'
       AND con.confrelid = ('public.' || $1)::regclass
       AND array_length(con.conkey, 1) = 1
       AND con.confdeltype <> 'c'`, [table]);
  return rows;
}

async function workList(c) {
  const work = [];
  const seen = new Set();
  const queue = (await referrers(c, "clients")).map((r) => ({ table: r.child_table, where: `"${r.child_column}" IN (${IDS})`, depth: 0 }));
  // Events written before the person existed carry the address, not the id.
  queue.push({ table: "events", where: `org_id = '${ORG}' AND client_id IS NULL AND lower(payload->>'email') IN (${list})`, depth: 0 });
  for (const q of queue) seen.add(`${q.table}|root|${q.where}`);
  while (queue.length) {
    const item = queue.shift();
    work.push(item);
    if (item.depth >= 4) continue;
    for (const r of await referrers(c, item.table)) {
      const key = `${r.child_table}|${r.child_column}|${item.table}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ table: r.child_table, where: `"${r.child_column}" IN (SELECT id FROM "${item.table}" WHERE ${item.where})`, depth: item.depth + 1 });
    }
  }
  return work;
}

async function report() {
  await withTx(async (c) => {
    const people = (await c.query(`SELECT id, lower(email) AS email, is_demo FROM clients WHERE id IN (${IDS})`)).rows;
    console.log("test people:", people.map((p) => `${p.email.replace(/\+sim-fu-/, "+sim-fu-")} demo=${p.is_demo}`));
    for (const w of await workList(c)) {
      const n = (await c.query(`SELECT count(*)::int AS n FROM "${w.table}" WHERE ${w.where}`)).rows[0].n;
      if (n) console.log(String(n).padStart(5), w.table);
    }
    await c.query("ROLLBACK");
  });
}

async function remove() {
  await withTx(async (c) => {
    const people = (await c.query(`SELECT id FROM clients WHERE id IN (${IDS})`)).rows;
    if (people.length !== emails.length) {
      await c.query("ROLLBACK");
      throw new Error(`expected ${emails.length} test people, found ${people.length}; nothing removed`);
    }
    // failed_events cannot be deleted by design: mark them, then unpin their events (purge-sim-data.mjs).
    await c.query(`UPDATE failed_events SET status = 'ignored', resolved_at = now() WHERE client_id IN (${IDS}) AND status <> 'ignored'`);
    await c.query(`UPDATE events SET client_id = NULL WHERE client_id IN (${IDS}) AND id IN (SELECT event_id FROM failed_events WHERE event_id IS NOT NULL)`);
    const work = (await workList(c)).filter((w) => w.table !== "failed_events").sort((a, b) => b.depth - a.depth);
    const lines = [];
    let pending = work;
    for (let pass = 1; pass <= 6 && pending.length; pass++) {
      const failed = [];
      for (const w of pending) {
        await c.query("SAVEPOINT sp");
        try {
          const res = await c.query(`DELETE FROM "${w.table}" WHERE ${w.where}`);
          await c.query("RELEASE SAVEPOINT sp");
          if (res.rowCount) lines.push(`${String(res.rowCount).padStart(5)} ${w.table}`);
        } catch (e) {
          await c.query("ROLLBACK TO SAVEPOINT sp");
          w.err = `${e.table || "?"} :: ${e.constraint || e.message}`;
          failed.push(w);
        }
      }
      if (failed.length === pending.length) {
        for (const f of failed) console.log("still blocked:", f.table, "<-", f.err);
        break;
      }
      pending = failed;
    }
    try {
      const r = await c.query(`DELETE FROM clients WHERE id IN (${IDS})`);
      await c.query("COMMIT");
      console.log(lines.join("\n"));
      console.log("test people removed:", r.rowCount);
    } catch (e) {
      await c.query("ROLLBACK");
      console.log("ROLLED BACK, nothing removed:", e.detail || e.message);
      process.exitCode = 1;
    }
  });
}

const cmd = process.argv[2];
if (cmd === "cancel") await cancel();
else if (cmd === "report") await report();
else if (cmd === "delete") await remove();
else console.log("usage: cleanup.mjs cancel|report|delete");
