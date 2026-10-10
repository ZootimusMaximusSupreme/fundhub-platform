// createTask's optional `detail` (tasks.detail, migration 472): a readable note that
// is written when the row is created and never takes part in the dedupe. A caller
// that passes none runs exactly the INSERT it always did.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { createTask } from "./create-task.mjs";

const ORG = "00000000-0000-4000-8000-000000000001";
const CLIENT = "550e8400-e29b-41d4-a716-446655440000";

function fakeDb({ existing = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/^\s*SELECT id FROM tasks/.test(sql)) return { rows: existing ? [{ id: existing }] : [] };
      if (/INSERT INTO tasks/.test(sql)) return { rows: [{ id: "new-task" }] };
      return { rows: [] };
    }
  };
}
const spec = { orgId: ORG, clientId: CLIENT, title: "Blueprint closing prep call", sourceWorkflow: "blueprint-csm-prep", assigneeRole: "csm", eventId: "key-1" };
const insertOf = (db) => db.calls.find((c) => /INSERT INTO tasks/.test(c.sql));

describe("createTask detail", () => {
  test("no detail: the original nine-value insert, with no detail column in it", async () => {
    const db = fakeDb();
    const r = await createTask(db, spec);
    assert.deepEqual(r, { created: true, id: "new-task", reason: null });
    const ins = insertOf(db);
    assert.ok(!/detail/.test(ins.sql));
    assert.equal(ins.params.length, 9);
    assert.equal(ins.params[3], "key-1", "body is still the event id");
  });

  test("blank detail is no detail", async () => {
    for (const blank of [null, undefined, "", "   "]) {
      const db = fakeDb();
      await createTask(db, { ...spec, detail: blank });
      assert.equal(insertOf(db).params.length, 9, JSON.stringify(blank));
    }
  });

  test("a detail is stored as the tenth value, and body stays the dedupe key", async () => {
    const db = fakeDb();
    await createTask(db, { ...spec, detail: "Document vault: file complete — 3 of 3 items accepted." });
    const ins = insertOf(db);
    assert.match(ins.sql, /meeting_url, detail\)/);
    assert.match(ins.sql, /VALUES \(\$1,\$2,NULL,\$3,\$4,\$5,\$6,\$7,\$8,\$9,\$10\)/);
    assert.equal(ins.params.length, 10);
    assert.equal(ins.params[3], "key-1");
    assert.equal(ins.params[9], "Document vault: file complete — 3 of 3 items accepted.");
  });

  test("the detail is never part of the dedupe: the lookup is on (client, source, body) alone", async () => {
    const db = fakeDb({ existing: "task-0" });
    const r = await createTask(db, { ...spec, detail: "a different sentence each time" });
    assert.deepEqual(r, { created: false, id: "task-0", reason: "duplicate_event" });
    assert.equal(insertOf(db), undefined, "an existing task is not touched or duplicated");
    const lookup = db.calls[0];
    assert.deepEqual(lookup.params, [CLIENT, "blueprint-csm-prep", "key-1"]);
    assert.ok(!/detail/.test(lookup.sql));
  });
});
