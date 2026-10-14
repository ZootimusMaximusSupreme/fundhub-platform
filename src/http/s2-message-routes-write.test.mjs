// The copy and wiring doors that decide what customers are told, run through the
// REAL handlers with a stand-in database and no network:
//
//   route:message-templates   save switches a message OFF until approved
//   route:journeys            GET reads and PUT saves the automation step trees
//
// The funnel push and the partner approval are in
// s2-message-routes-funnel-partner.test.mjs. Each test judges the exact result
// the catalog row names.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import templates from "../../api/message-templates.mjs";
import journeys from "../../api/journeys.mjs";
import { req, staffSession, ORG_ID, OTHER_ORG_ID, STAFF_ID } from "../testing/handler-harness.mjs";
import { call, refuseNetwork, splitRoles, STAFF_ROLES } from "../pulse/catalog/proofs/s2-route-kit.mjs";

refuseNetwork({ before, after });

const OWNER_ADMIN = ["owner", "admin"];
const sorted = (list) => [...list].sort();

describe("POST /api/message-templates", () => {
  const ID = "d1000000-0000-4000-8000-000000000001";
  const stored = (over = {}) => ({
    id: ID, org_id: ORG_ID, template_key: "SMS-WELCOME", channel: "sms", subject: null,
    body: "Hi {{contact.first_name}}, welcome to Fundhub.", compliance_passed: true,
    approved_by: STAFF_ID, approved_at: "2026-10-01T00:00:00Z", approved_body_sha: "abc", ...over,
  });
  const EMAIL = (over = {}) => stored({
    template_key: "EMAIL-WELCOME", channel: "email", subject: "Welcome to Fundhub", ...over,
  });
  // A template is found by its id AND the signed-in person's company ($1, $2).
  const load = (row) => [/FROM message_templates\s+WHERE id = \$1::uuid AND org_id = \$2::uuid/,
    (_s, p) => (row && p[0] === row.id && p[1] === row.org_id ? [row] : [])];
  const update = [/UPDATE message_templates\s+SET subject/, (_s, p) => [{
    id: p[0], template_key: "SMS-WELCOME", channel: "sms", subject: p[2], body: p[3], compliance_passed: p[4], updated_at: "now",
  }]];
  const approveUpdate = [/UPDATE message_templates\s+SET compliance_passed = true/, (_s, p) => [{
    id: p[0], template_key: "SMS-WELCOME", channel: "sms", subject: null, body: p[4], compliance_passed: true,
    approved_by: p[2], approved_body_sha: p[3],
  }]];
  const post = (body, role, row, org_id = ORG_ID) => call(templates, req("POST", { body }),
    [staffSession({ role, org_id }), load(row), update, approveUpdate]);
  const writes = (fake) => fake.find(/UPDATE message_templates/);

  test("saving new words changes the copy and sends the OFF flag; the message is no longer approved", async () => {
    const { res, fake } = await post({ action: "save", id: ID, body: "Hi {{contact.first_name}}, your file is ready." }, "closer", stored());
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.action, "save");
    assert.equal(res.body.approval_cleared, true);
    assert.match(res.body.message, /switched off until an owner or admin approves/);
    const [write] = writes(fake);
    assert.match(write.sql, /SET subject\s+= \$3,\s+body\s+= \$4,/);
    assert.match(write.sql, /CASE WHEN \$5::boolean THEN compliance_passed ELSE false END/);
    assert.match(write.sql, /WHERE id = \$1::uuid AND org_id = \$2::uuid/);
    // [id, org, subject, body, unchanged]: the words changed, so unchanged is false.
    assert.deepEqual(write.params, [ID, ORG_ID, null, "Hi {{contact.first_name}}, your file is ready.", false]);
  });

  test("saving the same words keeps the approval; a changed subject alone does not", async () => {
    const same = await post({ action: "save", id: ID, body: "Hi {{contact.first_name}}, welcome to Fundhub." }, "owner", stored());
    assert.equal(same.res.statusCode, 200);
    assert.equal(same.res.body.approval_cleared, false);
    assert.equal(writes(same.fake)[0].params[4], true);

    const body = "Hi {{contact.first_name}}, welcome to Fundhub.";
    const sameEmail = await post({ action: "save", id: ID, body, subject: "Welcome to Fundhub" }, "owner", EMAIL());
    assert.equal(sameEmail.res.body.approval_cleared, false);
    assert.equal(writes(sameEmail.fake)[0].params[4], true);

    const newSubject = await post({ action: "save", id: ID, body, subject: "A different subject line" }, "owner", EMAIL());
    assert.equal(newSubject.res.statusCode, 200);
    assert.equal(newSubject.res.body.approval_cleared, true);
    assert.deepEqual(writes(newSubject.fake)[0].params, [ID, ORG_ID, "A different subject line", body, false]);
  });

  test("an unknown placeholder, empty copy, a text with a subject and an email with none are refused and nothing is written", async () => {
    const cases = [
      [{ action: "save", id: ID, body: "Hi {{totally_unknown_tag}}" }, stored(), "unknown_merge_tags"],
      [{ action: "save", id: ID, body: "   " }, stored(), "body_required"],
      [{ action: "save", id: ID, body: "Hello", subject: "A subject" }, stored(), "subject_not_allowed"],
      [{ action: "save", id: ID, body: "Hello", subject: "   " }, EMAIL(), "subject_required"],
    ];
    for (const [body, row, error] of cases) {
      const { res, fake } = await post(body, "owner", row);
      assert.equal(res.statusCode, 400, error);
      assert.equal(res.body.error, error);
      assert.equal(writes(fake).length, 0, error);
    }
  });

  test("approve turns it ON only for the exact copy that was read, as the person who read it", async () => {
    const draft = stored({ compliance_passed: false, approved_by: null });
    const ok = await post({ action: "approve", id: ID, body: draft.body, subject: null }, "admin", draft);
    assert.equal(ok.res.statusCode, 200);
    assert.equal(ok.res.body.template.compliance_passed, true);
    assert.match(ok.res.body.message, /Approved\. This message can go out again\./);
    const [write] = writes(ok.fake);
    assert.deepEqual([write.params[0], write.params[1], write.params[2]], [ID, ORG_ID, STAFF_ID]);
    assert.match(write.params[3], /^[0-9a-f]{64}$/);
    // The write is conditional on the copy still being what was read.
    assert.match(write.sql, /AND body = \$5 AND subject IS NOT DISTINCT FROM \$6/);

    const emailDraft = EMAIL({ compliance_passed: false, approved_by: null });
    const stale = [
      [{ action: "approve", id: ID, body: "Older words", subject: null }, draft],
      [{ action: "approve", id: ID, body: emailDraft.body, subject: "An older subject" }, emailDraft],
    ];
    for (const [body, row] of stale) {
      const r = await post(body, "owner", row);
      assert.equal(r.res.statusCode, 409);
      assert.equal(r.res.body.error, "copy_changed");
      assert.equal(writes(r.fake).length, 0);
    }
    const already = await post({ action: "approve", id: ID, body: stored().body, subject: null }, "owner", stored());
    assert.equal(already.res.body.unchanged, true);
    assert.equal(writes(already.fake).length, 0);
  });

  test("only an owner or an admin may approve; every other staff role is refused and nothing is written", async () => {
    const draft = stored({ compliance_passed: false, approved_by: null });
    const { admitted, refused } = splitRoles(OWNER_ADMIN);
    assert.deepEqual(sorted(admitted), sorted(OWNER_ADMIN));
    for (const role of admitted) {
      const { res } = await post({ action: "approve", id: ID, body: draft.body, subject: null }, role, draft);
      assert.equal(res.statusCode, 200, role);
    }
    assert.equal(refused.length, 6);
    for (const role of refused) {
      const { res, fake } = await post({ action: "approve", id: ID, body: draft.body, subject: null }, role, draft);
      assert.equal(res.statusCode, 403, role);
      assert.deepEqual(res.body.required, ["owner", "admin"]);
      assert.equal(writes(fake).length, 0, role);
    }
  });

  test("every staff role may save new wording, and each save switches the message off", async () => {
    for (const role of STAFF_ROLES) {
      const { res, fake } = await post({ action: "save", id: ID, body: "Hi {{contact.first_name}}, a new line." }, role, stored());
      assert.equal(res.statusCode, 200, role);
      assert.equal(res.body.approval_cleared, true, role);
      assert.equal(writes(fake)[0].params[4], false, role);
    }
  });

  test("a template in another company is 404 and nothing is written", async () => {
    for (const body of [
      { action: "save", id: ID, body: "Hi {{contact.first_name}}." },
      { action: "approve", id: ID, body: stored().body, subject: null },
    ]) {
      const { res, fake } = await post(body, "owner", stored({ compliance_passed: false }), OTHER_ORG_ID);
      assert.equal(res.statusCode, 404, body.action);
      assert.equal(res.body.error, "not_found");
      assert.deepEqual(fake.find(/FROM message_templates/)[0].params, [ID, OTHER_ORG_ID]);
      assert.equal(writes(fake).length, 0, body.action);
    }
  });

  test("rename and delete are refused, always, and nothing is written", async () => {
    for (const action of ["rename", "delete"]) {
      const { res, fake } = await post({ action, id: ID, new_key: "OTHER" }, "owner", stored());
      assert.equal(res.statusCode, 409, action);
      assert.equal(res.body.error, `${action}_refused`, action);
      assert.equal(res.body.template_key, "SMS-WELCOME");
      assert.equal(fake.find(/UPDATE message_templates|DELETE FROM message_templates/).length, 0, action);
    }
    const missing = await post({ action: "save", id: ID, body: "x" }, "owner", null);
    assert.equal(missing.res.statusCode, 404);
  });
});

describe("/api/journeys", () => {
  const nodes = [
    { id: "n1", type: "sms", title: "Welcome text", cfg: { template: "SMS-WELCOME" } },
    { id: "n2", type: "wait", cfg: { amount: 2, unit: "days" } },
  ];
  const lane = { key: "setter", name: "Setter", start: "Lead arrives", end: "Booked", desc: "texts", nodes };
  const store = [/INSERT INTO journeys/, (_s, p) => [{ key: p[1], updated_at: "2026-10-13T00:00:00Z" }]];
  const put = (body, role = "owner", org_id = ORG_ID) => call(journeys, req("PUT", { body }), [staffSession({ role, org_id }), store]);
  const get = (role = "owner", org_id = ORG_ID) => call(journeys, req("GET"), [staffSession({ role, org_id }), [/FROM journeys WHERE org_id = \$1/, [
    { key: "client", name: "Client", start_when: "Pays", end_when: "Funded", description: "d", nodes, updated_at: "2026-10-12T00:00:00Z" },
  ]]]);

  test("GET returns this company's saved journeys keyed by lane", async () => {
    const { res, fake } = await get();
    assert.equal(res.statusCode, 200);
    assert.deepEqual(Object.keys(res.body.journeys), ["client"]);
    assert.deepEqual(res.body.journeys.client.nodes, nodes);
    assert.equal(res.body.journeys.client.start, "Pays");
    assert.deepEqual(fake.find(/FROM journeys/)[0].params, [ORG_ID]);
  });

  test("PUT saves the step tree for that company and lane, by the signed-in person", async () => {
    const { res, fake } = await put(lane);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.key, "setter");
    const [write] = fake.find(/INSERT INTO journeys/);
    assert.match(write.sql, /\(org_id, key, name, start_when, end_when, description, nodes, updated_by\)\s+VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, \$7::jsonb, \$8\)/);
    assert.equal(write.params[0], ORG_ID);
    assert.equal(write.params[1], "setter");
    assert.equal(write.params[2], "Setter");
    assert.deepEqual(JSON.parse(write.params[6]), nodes);
    assert.equal(write.params[7], STAFF_ID);
    // The company comes off the login: another company's person saves into their own.
    const theirs = await put(lane, "owner", OTHER_ORG_ID);
    assert.equal(theirs.fake.find(/INSERT INTO journeys/)[0].params[0], OTHER_ORG_ID);
    const theirRead = await get("owner", OTHER_ORG_ID);
    assert.deepEqual(theirRead.fake.find(/FROM journeys/)[0].params, [OTHER_ORG_ID]);
  });

  test("a wait with no length, a one-brace tag and an unknown lane are refused and nothing is written", async () => {
    const wait = await put({ key: "client", name: "C", start: "a", end: "b", nodes: [{ id: "x", type: "wait", cfg: { unit: "days" } }] });
    assert.equal(wait.res.statusCode, 400);
    assert.equal(wait.res.body.error, "steps_not_set_up");
    const brace = await put({ key: "client", name: "C", start: "a", end: "b", nodes: [{ id: "x", type: "sms", cfg: { body: "Hi {first_name}" } }] });
    assert.equal(brace.res.statusCode, 400);
    assert.equal(brace.res.body.error, "single_brace_tags");
    const unknown = await put({ key: "janitor", name: "C", start: "a", end: "b", nodes });
    assert.equal(unknown.res.statusCode, 400);
    assert.equal(unknown.res.body.error, "invalid_key");
    for (const r of [wait, brace, unknown]) assert.equal(r.fake.find(/INSERT INTO journeys/).length, 0);
  });

  test("only an owner or an admin may read or save journeys; every other staff role is refused and nothing is written", async () => {
    const { admitted, refused } = splitRoles(OWNER_ADMIN);
    assert.deepEqual(sorted(admitted), sorted(OWNER_ADMIN));
    for (const role of admitted) {
      assert.equal((await get(role)).res.statusCode, 200, role);
      assert.equal((await put(lane, role)).res.statusCode, 200, role);
    }
    assert.equal(refused.length, 6);
    for (const role of refused) {
      const read = await get(role);
      assert.equal(read.res.statusCode, 403, role);
      assert.equal(read.fake.find(/FROM journeys/).length, 0, role);
      const save = await put(lane, role);
      assert.equal(save.res.statusCode, 403, role);
      assert.equal(save.fake.find(/INSERT INTO journeys/).length, 0, role);
    }
  });
});
