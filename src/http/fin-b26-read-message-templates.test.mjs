// finish-853 batch 26: GET /api/read/message-templates. The real handler and the real usage scan
// (src/messaging/template-usage.mjs reads the workflow code in this repository) run over stand-in
// tables that answer by the conditions each statement names. Practice test, fake data, no network,
// no database.
// The row's words: the message copy library the template editor reads, with each row's body and who
// uses it (journeys, staff). Caller: staff, company from the session.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/read/message-templates.mjs";
import {
  run, req, asRole, asPartner, asClient, asAffiliate, inSql, sqlOf, wrote, pinned,
  ORG_ID, OTHER_ORG_ID, PARTNER, ALL_STAFF_ROLES, STAFF_ID,
} from "../testing/fin-b26-kit.mjs";
import { cleanSql, selectList, projectRow, evalSql, orderRows, orderOf, whereOf, keep } from "../testing/fin-b26-sql.mjs";

const T = (id, key, channel, over = {}) => ({
  id, org_id: ORG_ID, template_key: key, channel, subject: channel === "email" ? `Subject of ${key}` : null,
  body: `Body words of ${key}`, compliance_passed: true, source_doc: null, approved_at: null, approved_by: null,
  approved_body_sha: null, created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-02T00:00:00.000Z", ...over,
});

function world(over = {}) {
  return {
    message_templates: [
      // Named by workflow code in this repository (f-03-round-submitted.mjs), so it is locked.
      T("t1", "EMAIL-F03-ROUND-SUBMITTED", "email", { approved_at: "2026-09-03T00:00:00.000Z", approved_by: STAFF_ID, approved_body_sha: "abc" }),
      // Nothing in code names this one.
      T("t2", "SMS-ZZ-NOTHING-USES-THIS", "sms"),
      // A journey step points at it by nickname.
      T("t3", "EMAIL-QQ-JOURNEY-ONLY", "email"),
      T("t4", "SMS-ZZ-ANOTHER", "sms"),
      T("t9", "SMS-FOREIGN-COPY", "sms", { org_id: OTHER_ORG_ID, body: "another company's words" }),
    ],
    staff: [{ id: STAFF_ID, name: "Olive Owner" }],
    journeys: [
      { org_id: ORG_ID, key: "welcome", name: "Welcome", nodes: [
        { title: "Send the note", type: "send", touches: [["Template", "QQ-JOURNEY"]] },
        { title: "Branch", type: "condition", branches: [{ label: "yes", nodes: [{ title: "Later", touches: [["Template", "ANOTHER"], ["Other", "NOTHING-USES"]] }] }] },
      ] },
      { org_id: OTHER_ORG_ID, key: "foreign", name: "Foreign", nodes: [{ title: "x", touches: [["Template", "NOTHING-USES"]] }] },
    ],
    ...over,
  };
}

function rulesFor(t, { journeysFail = false } = {}) {
  return [
    // The library statement is read from its own text: WHERE (company, channel, key search),
    // ORDER BY, LIMIT/OFFSET, the join to staff, and every output column it names.
    [/FROM message_templates t\s+LEFT JOIN staff s/i, (sql, p) => {
      const text = cleanSql(sql);
      const items = selectList(sql, 0);
      const joinText = /LEFT JOIN staff s ON ([\s\S]*?) WHERE/i.exec(text)[1];
      const lim = /LIMIT \$(\d+) OFFSET \$(\d+)/i.exec(text);
      const limit = p[Number(lim[1]) - 1]; const offset = p[Number(lim[2]) - 1];
      const kept = keep(t.message_templates, whereOf(sql), p, { alias: "t" });
      const ordered = orderRows(kept, orderOf(sql), (r) => ({ params: p, rows: { t: r } }));
      return ordered.slice(offset, offset + limit).map((r) => {
        const s = t.staff.find((x) => evalSql(joinText, { params: p, rows: { s: x, t: r } }) === true) || null;
        return projectRow(items, { params: p, rows: { t: r, s } });
      });
    }],
    [/FROM journeys WHERE org_id = \$1/i, (sql, p) => (journeysFail ? new Error("journeys table missing") : inSql(t.journeys, sql, p))],
  ];
}

const get = (who, query = {}, { t = world(), ...opts } = {}) =>
  run(handler, req("GET", { query }), [...who, ...rulesFor(t, opts)]);

describe("GET /api/read/message-templates", () => {
  test("the library comes back for this company only: body, approval, and who uses each template, ordered by channel then key", async () => {
    const { res, fake } = await get(asRole("closer"));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.items.map((i) => i.template_key),
      ["EMAIL-F03-ROUND-SUBMITTED", "EMAIL-QQ-JOURNEY-ONLY", "SMS-ZZ-ANOTHER", "SMS-ZZ-NOTHING-USES-THIS"]);
    assert.ok(res.body.items.every((i) => i.template_key !== "SMS-FOREIGN-COPY"), "another company's copy is not shown");
    const first = res.body.items[0];
    assert.equal(first.body, "Body words of EMAIL-F03-ROUND-SUBMITTED", "the words are returned, not just a length");
    assert.equal(first.subject, "Subject of EMAIL-F03-ROUND-SUBMITTED");
    assert.equal(first.approved_by_name, "Olive Owner");
    assert.equal(first.approved_body_sha, "abc");
    assert.equal(first.compliance_passed, true);
    // Every named column comes from the statement's own SELECT list.
    assert.deepEqual([first.id, first.channel, first.approved_at, first.approved_by],
      ["t1", "email", "2026-09-03T00:00:00.000Z", STAFF_ID]);
    assert.deepEqual([first.created_at, first.updated_at, first.source_doc],
      ["2026-09-01T00:00:00.000Z", "2026-09-02T00:00:00.000Z", null]);
    const second = res.body.items.find((i) => i.template_key === "EMAIL-QQ-JOURNEY-ONLY");
    assert.deepEqual([second.approved_at, second.approved_by, second.approved_by_name, second.approved_body_sha], [null, null, null, null],
      "nobody has approved this one, and it says so");
    assert.equal(second.subject, "Subject of EMAIL-QQ-JOURNEY-ONLY");
    assert.equal(res.body.items.find((i) => i.template_key === "SMS-ZZ-ANOTHER").channel, "sms");
    const list = sqlOf(fake, /FROM message_templates t/)[0];
    assert.equal(list.params[4], ORG_ID);
    pinned(list.sql, "this company only", "WHERE t.org_id = $5::uuid");
    pinned(list.sql, "the words themselves are selected, not a length", "t.subject, t.body, t.compliance_passed");
    pinned(list.sql, "ordered", "ORDER BY t.channel, t.template_key LIMIT $1 OFFSET $2");
    assert.deepEqual(sqlOf(fake, /FROM journeys/)[0].params, [ORG_ID], "the journeys read is this company's too");
    assert.equal(wrote(fake), false);
  });

  test("the company is the session's: another company's id in the address changes nothing, for the copy or for the journeys", async () => {
    const { res, fake } = await get(asRole("owner"), { org_id: OTHER_ORG_ID, orgId: OTHER_ORG_ID });
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.items.every((i) => i.template_key !== "SMS-FOREIGN-COPY"));
    assert.equal(res.body.items.length, 4);
    assert.equal(sqlOf(fake, /FROM message_templates t/)[0].params[4], ORG_ID);
    assert.deepEqual(sqlOf(fake, /FROM journeys/)[0].params, [ORG_ID]);
  });

  test("each row says who uses it: workflow code, a saved journey step, or nothing yet", async () => {
    const { res } = await get(asRole("owner"));
    const byKey = Object.fromEntries(res.body.items.map((i) => [i.template_key, i]));
    const code = byKey["EMAIL-F03-ROUND-SUBMITTED"].used_by;
    assert.equal(code.locked, true);
    assert.ok(code.workflows.some((w) => w.file === "src/workflows/f-03-round-submitted.mjs"));
    assert.match(code.summary, /sent by \d+ automation/);

    const viaJourney = byKey["EMAIL-QQ-JOURNEY-ONLY"].used_by;
    assert.equal(viaJourney.locked, true);
    assert.deepEqual(viaJourney.workflows, []);
    assert.deepEqual(viaJourney.journeys.map((j) => [j.journeyKey, j.step]), [["welcome", "Send the note"]]);
    assert.equal(viaJourney.summary, "used by the Welcome journey");

    const nested = byKey["SMS-ZZ-ANOTHER"].used_by;
    assert.deepEqual(nested.journeys.map((j) => j.step), ["Later"], "a step inside a branch is found; a non-template touch is not");

    const none = byKey["SMS-ZZ-NOTHING-USES-THIS"].used_by;
    assert.equal(none.locked, false);
    assert.equal(none.summary, "nothing points at this yet");
    assert.deepEqual(none.journeys, [], "another company's journey is not read for this company's templates");
  });

  test("the channel and search filters narrow the list in the database; paging says there is more", async () => {
    const sms = await get(asRole("owner"), { channel: "sms" });
    assert.deepEqual(sms.res.body.items.map((i) => i.template_key), ["SMS-ZZ-ANOTHER", "SMS-ZZ-NOTHING-USES-THIS"]);
    assert.equal(sqlOf(sms.fake, /FROM message_templates t/)[0].params[2], "sms");
    const search = await get(asRole("owner"), { q: "journey" });
    assert.deepEqual(search.res.body.items.map((i) => i.template_key), ["EMAIL-QQ-JOURNEY-ONLY"]);
    pinned(sqlOf(search.fake, /FROM message_templates t/)[0].sql, "the key search",
      "($4::text IS NULL OR t.template_key ILIKE '%' || $4 || '%')");
    const page = await get(asRole("owner"), { limit: "2" });
    assert.equal(page.res.body.items.length, 2);
    assert.equal(page.res.body.hasMore, true);
  });

  test("if the journeys cannot be read the library still loads, with workflow usage alone", async () => {
    const { res } = await get(asRole("owner"), {}, { journeysFail: true });
    assert.equal(res.statusCode, 200);
    const byKey = Object.fromEntries(res.body.items.map((i) => [i.template_key, i]));
    assert.equal(byKey["EMAIL-F03-ROUND-SUBMITTED"].used_by.locked, true);
    assert.deepEqual(byKey["EMAIL-QQ-JOURNEY-ONLY"].used_by.journeys, []);
  });

  test("a session with no company reads no company's copy", async () => {
    const { res, fake } = await get(asRole("owner", { org_id: null }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.items, []);
    assert.equal(sqlOf(fake, /FROM message_templates t/)[0].params[4], null, "NULL is bound, so no row can match");
  });

  test("every staff role may read it; a role off the floor, a partner, a client, an affiliate and nobody may not; only GET answers", async () => {
    for (const role of ALL_STAFF_ROLES) {
      const { res } = await get(asRole(role));
      assert.equal(res.statusCode, 200, role);
    }
    for (const role of ["partner", "affiliate", "viewer"]) {
      const { res, fake } = await get(asRole(role));
      assert.equal(res.statusCode, 403, role);
      assert.equal(sqlOf(fake, /FROM message_templates/).length, 0, role);
    }
    for (const who of [asPartner(PARTNER), asClient(), asAffiliate()]) {
      const { res, fake } = await get(who);
      assert.ok([401, 403].includes(res.statusCode));
      assert.equal(sqlOf(fake, /FROM message_templates/).length, 0);
    }
    const nobody = await run(handler, req("GET"), rulesFor(world()));
    assert.equal(nobody.res.statusCode, 401);
    const post = await run(handler, req("POST", { body: {} }), [...asRole("owner"), ...rulesFor(world())]);
    assert.equal(post.res.statusCode, 405);
  });
});
