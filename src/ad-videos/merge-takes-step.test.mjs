// The join step, driven through the REAL sweeper walk().
//
// The store, Drive, Submagic and the joiner are in-memory fakes, so this runs
// with no database, no network and no ffmpeg. What it proves is the wiring:
// that the sweeper never hands Submagic a lone take while its angle has
// others, that it hands the master's bytes to the unchanged Submagic step, and
// that the old way still runs for the one take of an angle.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { walk, portsFor } from "../workflows/ad-video-sweeper.mjs";
import { listAngleTakes, joinBeforeSubmagic, withMasterBytes } from "./merge-takes-step.mjs";
import { JOINED_PREFIX } from "./merge-takes.mjs";

const A7 = "Haynes, the call that was never a roadmap";
const T0 = Date.parse("2026-10-05T12:00:00Z");
const LATER = T0 + 2 * 60 * 60 * 1000;
const SCRIPT7 = [{ adNumber: 7, angle: A7, lines: ["They told you to hop on a call.", "Nobody pitches you."], source: "x.md" }];

const take = (id, takeNo, extra = {}) => ({
  id, status: "staged", staged_at: "2026-10-05T12:01:00Z",
  drive_raw_file_id: `d-${id}`,
  drive_raw_name: `SLO Ad 7 — ${A7} Take ${takeNo}.mp4`,
  created_at: new Date(T0).toISOString(),
  ...extra
});

/* A tiny table. listPending hands out the rows as they were at the START of
   the pass (like the real query), listTakes reads them as they are NOW. */
function world(rows, { refuseCloseOf = null } = {}) {
  const table = new Map(rows.map((r) => [r.id, { ...r }]));
  const patches = [];
  const creates = [];
  const downloads = [];
  const events = [];
  const store = {
    listPending: async () => [...table.values()].map((r) => ({ ...r })),
    patch: async (_db, id, fields) => {
      patches.push([id, fields]);
      if (fields.status === "failed") events.push(`close ${id}`);
      if (fields.submagic_claimed_at) events.push(`claim ${id}`);
      if (refuseCloseOf === id && fields.status === "failed") return null;
      const cur = table.get(id);
      if (fields.status) cur.status = fields.status;
      Object.assign(cur, fields);
      return { ...cur };
    }
  };
  const drive = {
    downloadFile: async (id) => { downloads.push(id); return { ok: true, bytes: Buffer.from(`RAW:${id}`), byteLength: 8 }; }
  };
  const submagic = {
    createProjectFromFile: async ({ file }) => {
      creates.push(Buffer.from(file).toString());
      events.push("create");
      return { ok: true, projectId: `p${creates.length}` };
    }
  };
  const listTakes = async () => [...table.values()].map((r) => ({ ...r }));
  return { table, store, drive, submagic, listTakes, patches, creates, downloads, events };
}

function fakeJoiner(calls, result = null) {
  return {
    ok: true,
    buildMaster: async ({ members, script, workDir, fetchTake }) => {
      calls.push({ members: members.map((m) => m.takeNo), lines: script.lines.length });
      for (const m of members) {
        const got = await fetchTake(m);
        assert.equal(got.ok, true);
        assert.ok(fs.existsSync(got.path), "each take is written to the work folder before the join");
      }
      if (result) return result;
      const p = path.join(workDir, "master.mp4");
      fs.writeFileSync(p, "MASTER");
      return { ok: true, path: p, summary: "2 of 2 lines; best lines from Takes 1, 2" };
    }
  };
}

const run = (w, join) => walk({}, {
  store: w.store,
  ports: { ...portsFor({ env: {} }), drive: w.drive, submagic: w.submagic,
    join: { listTakes: w.listTakes, scripts: SCRIPT7, now: LATER, ...join } }
});

/* ═════════════════════════════════════════════════════════════════════════ */
describe("the sweeper never sends a lone take while its angle has others", () => {
  test("no ffmpeg here: the lead take waits with the reason, the other take is closed into it, nothing is sent", async () => {
    const w = world([take("r1", 1), take("r2", 2)]);
    const res = await run(w, { joiner: { ok: false, why: "this machine has no ffmpeg" } });
    assert.equal(w.creates.length, 0, "Submagic is never called");
    assert.equal(w.downloads.length, 0, "no take is even downloaded");
    const lead = res.per.find((p) => p.id === "r1");
    assert.equal(lead.to, "staged");
    assert.match(lead.note, /must become ONE master before Submagic/);
    assert.match(lead.note, /no ffmpeg/);
    assert.match(w.table.get("r1").last_step_note, /Nothing was sent/, "the reason is on the row, not only in a log");
    assert.equal(w.table.get("r2").status, "failed");
    assert.ok(w.table.get("r2").failure_reason.startsWith(JOINED_PREFIX));
  });

  test("with a joiner: ONE master from both takes goes to the unchanged Submagic step, the other take is closed first", async () => {
    const w = world([take("r1", 1), take("r2", 2)]);
    const calls = [];
    const res = await run(w, { joiner: fakeJoiner(calls) });
    assert.deepEqual(calls, [{ members: [1, 2], lines: 2 }], "both takes, with the script");
    assert.deepEqual(w.downloads.sort(), ["d-r1", "d-r2"], "every take came through the Drive port");
    assert.deepEqual(w.creates, ["MASTER"], "exactly one Submagic project, and it is the master");
    assert.deepEqual(w.events.slice(0, 3), ["close r2", "claim r1", "create"],
      "the other take is closed BEFORE the claim and the upload — a second master can never be bought");
    assert.equal(w.table.get("r1").status, "editing");
    assert.equal(w.table.get("r2").status, "failed");
    const lead = res.per.find((p) => p.id === "r1");
    assert.match(lead.note, /joined into one master — 2 of 2 lines/);
    const second = res.per.find((p) => p.id === "r2");
    assert.equal(second.step, "joinTakes", "take 2's own turn in the same pass sees it already joined");
  });

  test("a close that does not land stops the upload", async () => {
    const w = world([take("r1", 1), take("r2", 2)], { refuseCloseOf: "r2" });
    await run(w, { joiner: fakeJoiner([]) });
    assert.equal(w.creates.length, 0);
    assert.match(w.table.get("r1").last_step_note, /could not be marked as joined/);
  });

  test("takes that do not follow the script fail for a person; a broken render only waits", async () => {
    const w1 = world([take("r1", 1), take("r2", 2)]);
    await run(w1, { joiner: fakeJoiner([], { ok: false, retryable: false, error: "these takes do not follow this script" }) });
    assert.equal(w1.table.get("r1").status, "failed");
    assert.match(w1.table.get("r1").failure_reason, /do not follow this script/);
    assert.equal(w1.creates.length, 0);

    const w2 = world([take("r1", 1), take("r2", 2)]);
    await run(w2, { joiner: fakeJoiner([], { ok: false, retryable: true, error: "cut 3 failed" }) });
    assert.equal(w2.table.get("r1").status, "staged");
    assert.match(w2.table.get("r1").last_step_note, /cut 3 failed/);
    assert.equal(w2.creates.length, 0);
  });

  test("no script for the angle: wait, do not guess an order", async () => {
    const w = world([take("r1", 1), take("r2", 2)]);
    await run(w, { joiner: fakeJoiner([]), scripts: [] });
    assert.equal(w.creates.length, 0);
    assert.match(w.table.get("r1").last_step_note, /no script titled "Ad 7 — Haynes/);
  });

  test("a database read that fails holds the take — a bug never becomes a lone take", async () => {
    const w = world([take("r1", 1)]);
    await run(w, { listTakes: async () => { throw new Error("connection reset"); } });
    assert.equal(w.creates.length, 0);
    assert.match(w.table.get("r1").last_step_note, /the join step broke, so nothing was sent: connection reset/);
  });

  test("a take whose angle is still landing waits", async () => {
    const w = world([take("r1", 1)]);
    await run(w, { now: T0 + 10 * 60 * 1000 });
    assert.equal(w.creates.length, 0);
    assert.match(w.table.get("r1").last_step_note, /waiting 20 more minute/);
  });
});

describe("the old way still runs for the one take of an angle", () => {
  test("one take, settled: the take's own bytes go to Submagic, with a note", async () => {
    const w = world([take("r1", 1)]);
    const res = await run(w, { joiner: { ok: false, why: "never asked" } });
    assert.deepEqual(w.creates, ["RAW:d-r1"]);
    assert.equal(w.table.get("r1").status, "editing");
    assert.match(res.per[0].note, /has one take \(Take 1\) — sent as it is/);
  });

  test("the same ad number with a different angle is two videos, never one", async () => {
    const other = take("r2", 1, { drive_raw_name: "SLO Ad 7 — Straight offer, max fundability, both sides of the file Take 1.mp4" });
    const w = world([take("r1", 1), other]);
    await run(w, { joiner: { ok: false, why: "never asked" } });
    assert.deepEqual(w.creates.sort(), ["RAW:d-r1", "RAW:d-r2"]);
  });

  test("a row at any other state is not this step's business", async () => {
    const r = take("r1", 1, { status: "raw_landed" });
    assert.deepEqual(await joinBeforeSubmagic({}, r, { store: {}, ports: {} }), {});
    assert.deepEqual(await joinBeforeSubmagic({}, take("r2", 1, { submagic_claimed_at: "2026-10-05T12:00:00Z" }), { store: {}, ports: {} }), {},
      "a standing spend claim is the Submagic step's to read, never this one's");
  });
});

describe("the database read", () => {
  test("one SELECT through the store's asStaff, by the name's offer and ad number, wildcards escaped", async () => {
    const seen = [];
    const store = {
      asStaff: async (fn, deps) => {
        seen.push(deps);
        return fn({ query: async (sql, params) => { seen.push(sql, params); return { rows: [{ id: "x" }] }; } });
      }
    };
    const rows = await listAngleTakes("DB", { store, row: { drive_raw_name: `SLO_1% Ad 7 — ${A7} Take 1.mp4` } });
    assert.deepEqual(rows, [{ id: "x" }]);
    assert.deepEqual(seen[0], { db: "DB" });
    assert.match(seen[1], /^\s*SELECT/);
    assert.ok(!/\b(UPDATE|INSERT|DELETE|SET\s)/i.test(seen[1].replace(/ESCAPE/g, "")), "a read and nothing else");
    assert.match(seen[1], /drive_raw_name ILIKE \$1 ESCAPE '\\'/);
    assert.deepEqual(seen[2], ["SLO\\_1\\% Ad 7%"]);
    assert.deepEqual(await listAngleTakes("DB", { store, row: { drive_raw_name: "IMG_4471.mov" } }), [], "no ad in the name, no read");
  });

  test("the master answers only its own take's id", async () => {
    const drive = { downloadFile: async (id) => ({ ok: true, bytes: Buffer.from(id) }) };
    const d = withMasterBytes(drive, "lead", Buffer.from("M"));
    assert.equal((await d.downloadFile("lead")).bytes.toString(), "M");
    assert.equal((await d.downloadFile("other")).bytes.toString(), "other");
  });
});
