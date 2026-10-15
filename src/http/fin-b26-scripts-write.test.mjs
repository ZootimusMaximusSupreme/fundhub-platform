// finish-853 batch 26: POST /api/scripts/write. The real handler, the real label rules
// (src/ads/label-keys.mjs) and the real staff transaction (src/partners/rls.mjs) run over stand-in
// tables that answer by the conditions each statement names. A BEGIN is snapshotted and a ROLLBACK
// restores it, so "the archive rolls back with the insert" is judged honestly.
// Practice test, fake data, no network, no database.
// The row's words: save an ad script (a rewrite is a new row pointing at its parent) and its labels so
// the ad spine can read them.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/scripts/write.mjs";
import {
  run, req, asRole, asPartner, asClient, asAffiliate, sqlOf, writes, wrote, pinned, txTables,
  ORG_ID, OTHER_ORG_ID, PARTNER, FOREIGN_PARTNER, ALL_STAFF_ROLES,
} from "../testing/fin-b26-kit.mjs";
import { selectList, projectRow, whereOf, keep, runInsert, runUpdate } from "../testing/fin-b26-sql.mjs";

const HOUSE = "b1000000-0000-4000-8000-000000000001";
const S = (n) => `5${n}000000-0000-4000-8000-00000000000${n}`;
const ROOT = S(1);
let seq = 0;

const script = (id, over = {}) => ({
  id, org_id: ORG_ID, partner_id: HOUSE, version: 1, root_script_id: id, ad_id: 41, status: "draft", source: "chris",
  archived_at: null, body: `words of ${id}`, parts: null, parent_script_id: null, ...over,
});

function world(over = {}) {
  return {
    ad_scripts: [
      script(S(1)),
      script(S(2), { status: "locked", ad_id: 42 }),
      script(S(3), { status: "filmed", ad_id: 43 }),
      script(S(4), { source: "machine", ad_id: 44 }),
      script(S(5), { version: 1, archived_at: "2026-10-01T00:00:00.000Z", root_script_id: S(5), ad_id: 45 }),
      script(S(6), { version: 2, root_script_id: S(5), parent_script_id: S(5), ad_id: 45 }),
      script(S(7), { org_id: OTHER_ORG_ID, partner_id: FOREIGN_PARTNER, ad_id: 47 }),
    ],
    partners: [
      { id: HOUSE, org_id: ORG_ID, slug: "fundhub-house" },
      { id: PARTNER, org_id: ORG_ID, slug: "acme" },
      { id: FOREIGN_PARTNER, org_id: OTHER_ORG_ID, slug: "fundhub-house" },
    ],
    ad_labels: [],
    ...over,
  };
}

/**
 * The statements, answered by reading them. The INSERT is placed by its own column list and VALUES
 * list (so a column or parameter put in the wrong place stores words in the wrong field), the
 * RETURNING list decides what comes back, the archive UPDATE applies its own SET list, and the label
 * upsert follows its own ON CONFLICT ... WHERE. What the database adds itself (an id, a root that is its
 * own id for a new script, the draft/chris defaults) is `fill`.
 */
function rulesFor(t, { failInsertOn = null, archiveRaces = false } = {}) {
  const tx = txTables(t);
  const pick = (table, sql, p, rows) => {
    const items = selectList(sql, 0);
    return keep(rows, whereOf(sql), p, { alias: table })
      .slice(0, 1).map((r) => projectRow(items, { params: p, row: r, rows: { [table]: r } }));
  };
  return [
    ...tx.rules,
    [/FROM ad_scripts WHERE id = \$1\s+FOR UPDATE/i, (sql, p) => pick("ad_scripts", sql, p, t.ad_scripts)],
    [/FROM ad_scripts\s+WHERE root_script_id = \$1 AND archived_at IS NULL/i, (sql, p) => {
      const items = selectList(sql, 0);
      return keep(t.ad_scripts, whereOf(sql), p, { alias: "ad_scripts" }).map((r) => projectRow(items, { params: p, row: r, rows: { ad_scripts: r } }));
    }],
    [/FROM partners WHERE org_id = \$1 AND slug = \$2/i, (sql, p) => pick("partners", sql, p, t.partners)],
    [/SELECT id, org_id FROM partners WHERE id = \$1/i, (sql, p) => pick("partners", sql, p, t.partners)],
    [/^\s*UPDATE ad_scripts\s+SET archived_at = now\(\)/i, (sql, p) => {
      // A race, played honestly: between the locked read and this write another save archived the same
      // version. The statement then archives nothing only if it still says "AND archived_at IS NULL".
      if (archiveRaces) {
        const row = t.ad_scripts.find((r) => r.id === p[0]);
        if (row) row.archived_at = "archived-by-the-other-save";
      }
      return runUpdate(sql, p, t.ad_scripts);
    }],
    [/^\s*INSERT INTO ad_scripts/i, (sql, p) => {
      if (failInsertOn) return failInsertOn;
      const out = runInsert(sql, p, t.ad_scripts, {
        fill: (row) => {
          const id = `9${++seq}000000-0000-4000-8000-00000000000${seq}`;
          return { source: "chris", archived_at: null, created_at: "now", updated_at: "now", ...row, id, root_script_id: row.root_script_id || id };
        },
      });
      return out.rows;
    }],
    [/^\s*INSERT INTO ad_labels/i, (sql, p) => runInsert(sql, p, t.ad_labels).rows],
  ];
}

const post = (body, who = asRole("closer"), { t = world(), ...opts } = {}) =>
  run(handler, req("POST", { body }), [...who, ...rulesFor(t, opts)]).then((out) => ({ ...out, t }));
const find = (t, id) => t.ad_scripts.find((r) => r.id === id);
const added = (t) => t.ad_scripts.filter((r) => /^9/.test(r.id));

describe("POST /api/scripts/write: a new script", () => {
  test("saves the words under the company's house partner, as a draft, with its labels tidied and its dictionary learned", async () => {
    const t = world();
    const { res, fake } = await post({
      body: "  Most people think a denial is the end.  ", title: "  Denial hook  ", hook_text: " Most people think... ",
      script_type: "Story Hook", angle_key: "Denial Angle", hook_key: "denial-opener", offer_key: "SLO", lane: " Funding600 ",
      org_id: OTHER_ORG_ID, version: 9, status: "locked", root_script_id: S(7),
    }, asRole("closer"), { t });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.created, true);
    assert.equal(res.body.is_rewrite, false);
    const row = added(t)[0];
    assert.equal(row.org_id, ORG_ID, "the company is the session's, never the body's");
    assert.equal(row.partner_id, HOUSE);
    assert.equal(row.version, 1, "a version is computed, never sent");
    assert.equal(row.status, "draft", "a status is the machine's, never sent");
    assert.equal(row.parent_script_id, null);
    assert.equal(row.root_script_id, row.id, "a new script is its own root");
    // What the screen gets back is the statement's own RETURNING list, and it must say what was stored.
    const back = res.body.script;
    assert.deepEqual([back.id, back.org_id, back.partner_id, back.version, back.status, back.parent_script_id, back.root_script_id],
      [row.id, ORG_ID, HOUSE, 1, "draft", null, row.id], "the saved script, as stored");
    assert.deepEqual([back.title, back.body, back.hook_text, back.script_type, back.lane, back.angle_key, back.hook_key, back.offer_key],
      ["Denial hook", "  Most people think a denial is the end.  ", "Most people think...", "story_hook", "funding600", "denial_angle", "denial_opener", "slo"],
      "every field landed in its own column");
    assert.equal(row.body, "  Most people think a denial is the end.  ", "the words are stored as typed");
    assert.equal(row.title, "Denial hook");
    assert.equal(row.hook_text, "Most people think...");
    assert.deepEqual(res.body.labels, {
      script_type: "story_hook", lane: "funding600", angle_key: "denial_angle", hook_key: "denial_opener", offer_key: "slo",
    });
    assert.deepEqual(res.body.dictionary, [
      { kind: "script_type", key: "story_hook" }, { kind: "angle", key: "denial_angle" },
      { kind: "hook", key: "denial_opener" }, { kind: "offer", key: "slo" },
    ]);
    assert.deepEqual(t.ad_labels.map((l) => [l.kind, l.key, l.name]), [
      ["script_type", "story_hook", "Story Hook"], ["angle", "denial_angle", "Denial Angle"],
      ["hook", "denial_opener", "Denial Opener"], ["offer", "slo", "Slo"],
    ]);
    assert.ok(t.ad_labels.every((l) => l.org_id === ORG_ID));
    const names = fake.calls.map((c) => c.sql.trim().split(/\s+/)[0].toUpperCase());
    assert.deepEqual(names.filter((n) => ["BEGIN", "COMMIT", "ROLLBACK"].includes(n)), ["BEGIN", "COMMIT"], "one transaction, committed");
    pinned(sqlOf(fake, /INSERT INTO ad_labels/)[0].sql, "a typed name is never overwritten", "WHERE ad_labels.name IS NULL");
  });

  test("the camelCase spellings are accepted, and labels left out stay empty, never a placeholder", async () => {
    const t = world();
    const { res } = await post({ body: "words", scriptType: "Proof", angleKey: "Cause First", hookText: "Hook", partnerId: PARTNER }, asRole("setter"), { t });
    assert.equal(res.statusCode, 200);
    const row = added(t)[0];
    assert.equal(row.partner_id, PARTNER, "a partner of this company may be named");
    assert.equal(row.script_type, "proof");
    assert.equal(row.angle_key, "cause_first");
    assert.equal(row.hook_text, "Hook");
    assert.equal(row.hook_key, null);
    assert.equal(row.offer_key, null);
    assert.equal(row.lane, null);
    assert.deepEqual(res.body.dictionary.map((d) => d.kind), ["script_type", "angle"]);
  });

  test("a name a person typed in the dictionary is never overwritten, and a blank one is filled", async () => {
    const t = world({ ad_labels: [
      { org_id: ORG_ID, kind: "angle", key: "denial_angle", name: "Chris's Denial Angle" },
      { org_id: ORG_ID, kind: "hook", key: "denial_opener", name: null },
    ] });
    await post({ body: "words", angle_key: "Denial Angle", hook_key: "denial_opener" }, asRole("closer"), { t });
    assert.equal(t.ad_labels.find((l) => l.kind === "angle").name, "Chris's Denial Angle");
    assert.equal(t.ad_labels.find((l) => l.kind === "hook").name, "Denial Opener");
    assert.equal(t.ad_labels.length, 2, "the same label is not added twice");
  });
});

describe("POST /api/scripts/write: a rewrite", () => {
  test("a rewrite is a new row at the next version pointing at its parent; the parent is archived, its words untouched", async () => {
    const t = world();
    const { res, fake } = await post({ body: "A better opening.", parent_script_id: S(1), angle_key: "Denial Angle" }, asRole("closer"), { t });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.is_rewrite, true);
    const row = added(t)[0];
    assert.equal(row.version, 2);
    assert.equal(row.parent_script_id, S(1));
    assert.equal(row.root_script_id, ROOT, "the same root");
    assert.equal(row.ad_id, 41, "the same ad number");
    assert.equal(row.partner_id, HOUSE, "the rewrite stays with the parent's partner");
    assert.equal(row.status, "draft");
    assert.deepEqual([res.body.script.id, res.body.script.version, res.body.script.parent_script_id, res.body.script.root_script_id, res.body.script.ad_id, res.body.script.body],
      [row.id, 2, S(1), ROOT, 41, "A better opening."], "the answer carries the new version, its parent and its root");
    const parent = find(t, S(1));
    assert.ok(parent.archived_at, "the replaced version stops being live");
    assert.equal(parent.body, "words of " + S(1), "its words are left exactly as they were");
    assert.equal(parent.version, 1);
    const sqlText = fake.calls.map((c) => c.sql);
    assert.ok(sqlText.findIndex((s) => /UPDATE ad_scripts/.test(s)) < sqlText.findIndex((s) => /INSERT INTO ad_scripts/.test(s)), "archive first, then insert");
    assert.ok(sqlText.some((s) => /FOR UPDATE/.test(s)), "the parent row is locked while it is rewritten");
    assert.equal(fake.calls.filter((c) => /^\s*BEGIN/.test(c.sql)).length, 1, "one transaction");
  });

  test("a locked or filmed parent keeps its number and its rewrite lands locked; a machine-written parent becomes superseded", async () => {
    for (const parent of [S(2), S(3)]) {
      const t = world();
      const { res } = await post({ body: "new words", parent_script_id: parent }, asRole("closer"), { t });
      assert.equal(res.statusCode, 200);
      const row = added(t)[0];
      assert.equal(row.status, "locked", parent);
      assert.equal(row.ad_id, find(t, parent).ad_id);
      assert.equal(find(t, parent).status, parent === S(2) ? "locked" : "filmed", "the old version keeps its own status");
    }
    const t = world();
    await post({ body: "new words", parent_script_id: S(4) }, asRole("closer"), { t });
    assert.equal(find(t, S(4)).status, "superseded");
    assert.ok(find(t, S(4)).archived_at);
  });

  test("only the live version can be rewritten: an archived parent is a 409 that offers the current version, and nothing is written", async () => {
    const t = world();
    const { res, fake } = await post({ body: "again", parent_script_id: S(5) }, asRole("closer"), { t });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, "stale");
    assert.equal(res.body.current.id, S(6));
    assert.equal(res.body.current.version, 2);
    assert.equal(added(t).length, 0);
    assert.ok(fake.calls.some((c) => /^\s*ROLLBACK/.test(c.sql)));
  });

  test("two rewrites racing: the loser's archive finds the row already gone and gets 409; a unique-index loss is the same answer", async () => {
    const t = world();
    const a = await post({ body: "again", parent_script_id: S(1) }, asRole("closer"), { t, archiveRaces: true });
    assert.equal(a.res.statusCode, 409);
    assert.equal(a.res.body.error, "stale");
    assert.equal(added(t).length, 0);
    const u = world();
    const dup = Object.assign(new Error("duplicate key"), { code: "23505", constraint: "ad_scripts_one_live_per_root_uq" });
    const b = await post({ body: "again", parent_script_id: S(1) }, asRole("closer"), { t: u, failInsertOn: dup });
    assert.equal(b.res.statusCode, 409);
    assert.equal(b.res.body.error, "stale");
    assert.equal(find(u, S(1)).archived_at, null, "the archive rolled back with the failed insert");
    assert.equal(u.ad_labels.length, 0);
  });

  test("a failed insert rolls the archive back and answers 500 without the database error", async () => {
    const t = world();
    const boom = Object.assign(new Error("relation exploded at postgres://user:pw@host/db"), { code: "XX000" });
    const { res } = await post({ body: "words", parent_script_id: S(1) }, asRole("closer"), { t, failInsertOn: boom });
    assert.equal(res.statusCode, 500);
    assert.equal(find(t, S(1)).archived_at, null);
    assert.doesNotMatch(JSON.stringify(res.body), /postgres:\/\/user/);
  });

  test("a parent in another company reads exactly like a parent that does not exist", async () => {
    const t = world();
    const foreign = await post({ body: "x", parent_script_id: S(7) }, asRole("closer"), { t });
    const missing = await post({ body: "x", parent_script_id: "5a000000-0000-4000-8000-00000000000a" }, asRole("closer"), { t });
    assert.equal(foreign.res.statusCode, 404);
    assert.deepEqual(foreign.res.body, missing.res.body, "same code, same words: ids cannot be walked");
    assert.equal(foreign.res.body.error, "parent_script_not_found");
    assert.equal(find(t, S(7)).archived_at, null);
    assert.equal(added(t).length, 0);
  });

  test("a rewrite cannot move to another partner", async () => {
    const { res, t } = await post({ body: "x", parent_script_id: S(1), partner_id: PARTNER });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "partner_id_mismatch");
    assert.equal(added(t).length, 0);
  });
});

describe("POST /api/scripts/write: refusals", () => {
  test("input the caller got wrong is a 400 that names the field, and nothing is written", async () => {
    const cases = [
      [{}, "body_required"],
      [{ body: "   " }, "body_required"],
      [{ body: "x", script_type: "3 second hook" }, "label_invalid"],
      [{ body: "x", angle_key: "a" }, "label_invalid"],
      [{ body: "x", lane: "unknown" }, "lane_invalid"],
      [{ body: "x", lane: "diamond" }, "lane_invalid"],
      [{ body: "x", parent_script_id: "not-a-uuid" }, "parent_script_id_invalid"],
      [{ body: "x", partner_id: "nope" }, "partner_id_invalid"],
    ];
    for (const [body, error] of cases) {
      const { res, fake, t } = await post(body);
      assert.equal(res.statusCode, 400, JSON.stringify(body));
      assert.equal(res.body.error, error, JSON.stringify(body));
      assert.equal(wrote(fake), false);
      assert.equal(added(t).length, 0);
    }
    const label = await post({ body: "x", script_type: "3 second hook" });
    assert.match(label.res.body.message, /script_type/);
    assert.match(label.res.body.message, /3_second_hook/);
  });

  test("a partner of another company, or a company with no house partner, has nowhere to file it", async () => {
    const foreign = await post({ body: "x", partner_id: FOREIGN_PARTNER });
    assert.equal(foreign.res.statusCode, 404);
    assert.equal(foreign.res.body.error, "partner_not_found");
    const t = world({ partners: [{ id: PARTNER, org_id: ORG_ID, slug: "acme" }] });
    const noHouse = await post({ body: "x" }, asRole("closer"), { t });
    assert.equal(noHouse.res.statusCode, 400);
    assert.equal(noHouse.res.body.error, "house_partner_missing");
    assert.equal(added(t).length, 0);
    const lookup = sqlOf(noHouse.fake, /FROM partners WHERE org_id/)[0];
    assert.deepEqual(lookup.params, [ORG_ID, "fundhub-house"], "the house partner is this company's own");
  });

  test("every staff role may save; a client, a partner, an affiliate and nobody may not; a session with no company writes nothing", async () => {
    for (const role of ALL_STAFF_ROLES) {
      const { res } = await post({ body: "words" }, asRole(role));
      assert.equal(res.statusCode, 200, role);
    }
    for (const who of [asClient(), asPartner(PARTNER), asAffiliate()]) {
      const { res, fake, t } = await post({ body: "words" }, who);
      assert.ok([401, 403].includes(res.statusCode));
      assert.equal(wrote(fake), false);
      assert.equal(added(t).length, 0);
    }
    const nobody = await post({ body: "words" }, []);
    assert.equal(nobody.res.statusCode, 401);
    // A staff login whose role is not one of the floor's roles reads nothing and writes nothing.
    for (const role of ["partner", "affiliate", "client", "viewer"]) {
      const odd = await post({ body: "words" }, asRole(role));
      assert.equal(odd.res.statusCode, 403, role);
      assert.equal(odd.res.body.error, "forbidden", role);
      assert.equal(wrote(odd.fake), false, role);
    }
    const noOrg = await post({ body: "words" }, asRole("owner", { org_id: null }));
    assert.equal(noOrg.res.statusCode, 403);
    assert.equal(wrote(noOrg.fake), false);
    const get = await run(handler, req("GET"), [...asRole("owner"), ...rulesFor(world())]);
    assert.equal(get.res.statusCode, 405);
    assert.equal(get.res.headers.allow, "POST");
    assert.equal(writes(get.fake).length, 0);
  });
});
