/* GET /api/public/survey-resume against a real Postgres.
 *
 * CONTAINMENT (2026-10-31): the door is closed. A good link to a real row is the same 404
 * with nothing in it as a forged one. /apply lets a new phone onto an existing lead's email
 * (resolveClient), so a signed code can reach a stranger; the last test replays that on
 * real rows. This goes through netlify/functions/api.mjs, the real front door, so it
 * proves the ROUTES entry as well (a handler file is not a route).
 *
 * Every row is built by the test and removed after. The company, the clients and their
 * answers are made up; nothing here touches an existing company.
 *
 * SKIPS unless DATABASE_URL is a loopback scratch or CI database (the lock in
 * src/verification/scratch-guard.mjs). A skip is not a pass.
 */
import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { readSurveyResume } from "../../api/public/survey-resume.mjs";
import { surveyResumeToken } from "../survey/resume-link.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { isLocalScratchDatabaseUrl } from "../verification/scratch-guard.mjs";

// Writes and deletes its own rows, so it runs only on a loopback scratch or CI database.
const HAS_DB = isLocalScratchDatabaseUrl(process.env.DATABASE_URL);
const SLUG = "survey-resume-test";
const OTHER_SLUG = "survey-resume-test-other";
const SECRET = "pg-test-resume-secret-0123456789abcdef0123456789";
const PAGE = "https://apply.fundhub.ai";
const DAY = 24 * 60 * 60 * 1000;

let front;
let orgId;
let otherOrgId;
let savedSecret;
let pat;       // started the survey on /apply: the page saves the words on the key
let nativeLead; // came through the ClickFunnels survey: an option id on the key, the words beside it
let otherOrgClient;

const mint = (over = {}) => surveyResumeToken({ clientId: pat, secret: SECRET, ...over });
const door = (query, headers = { origin: PAGE }) => front(
  new Request(`https://fundhub.test/api/public/survey-resume${query}`, { method: "GET", headers }), {});
const json = async (res) => JSON.parse(await res.text());

async function makeClient(org, fields) {
  return (await db.query(
    `INSERT INTO clients (org_id, email, phone, first_name, last_name, custom_fields)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [org, fields.email, fields.phone ?? null, fields.first ?? null, fields.last ?? null, JSON.stringify(fields.custom ?? {})]
  )).rows[0].id;
}

async function purge() {
  if (!HAS_DB) return;
  const orgs = (await db.query(`SELECT id FROM orgs WHERE slug = ANY($1)`, [[SLUG, OTHER_SLUG]])).rows.map((r) => r.id);
  if (orgs.length) await db.query(`DELETE FROM clients WHERE org_id = ANY($1)`, [orgs]);
  await db.query(`DELETE FROM orgs WHERE slug = ANY($1)`, [[SLUG, OTHER_SLUG]]);
}

before(async () => {
  if (!HAS_DB) return;
  savedSecret = process.env.UNSUBSCRIBE_TOKEN_SECRET;
  process.env.UNSUBSCRIBE_TOKEN_SECRET = SECRET;
  ({ default: front } = await import("../../netlify/functions/api.mjs"));
  await purge();
  orgId = (await db.query(`INSERT INTO orgs (slug, name) VALUES ($1,'Survey Resume Test') RETURNING id`, [SLUG])).rows[0].id;
  otherOrgId = (await db.query(`INSERT INTO orgs (slug, name) VALUES ($1,'Survey Resume Test Other') RETURNING id`, [OTHER_SLUG])).rows[0].id;
  pat = await makeClient(orgId, {
    email: "pat.resume@survey-resume.test", phone: "+15551230001", first: "Pat", last: "Lee",
    custom: {
      cf_svy_funding_target_amount: "$50k - $100k",
      cf_svy_planned_use: "Growth (marketing, inventory, hiring)",
      cf_svy_money_change_now: ["Stability (cover bills / buffer slow weeks)"],
      setter_handoff: { problem: "a private note" },
      utm_source: "facebook"
    }
  });
  nativeLead = await makeClient(orgId, {
    email: "native.resume@survey-resume.test", phone: null, first: "Nat", last: null,
    custom: {
      cf_svy_funding_target_amount: "207883",
      cf_svy_funding_target_amount_label: "$100k - $200k",
      cf_svy_planned_use: "207891",
      cf_svy_money_change_now: "207900",
      cf_svy_money_change_now_labels: '["Fresh start (new business / startup launch)"]'
    }
  });
  otherOrgClient = await makeClient(otherOrgId, { email: "other.resume@survey-resume.test", first: "Olive", custom: { cf_svy_planned_use: "Not sure yet" } });
});

after(async () => {
  if (!HAS_DB) return;
  if (savedSecret === undefined) delete process.env.UNSUBSCRIBE_TOKEN_SECRET; else process.env.UNSUBSCRIBE_TOKEN_SECRET = savedSecret;
  await purge();
  await close();
});

const PRIVATE = ["pat.resume@survey-resume.test", "5551230001", "Pat", "Lee", "$50k", "Growth", "Stability", "a private note",
  "facebook", "native.resume", "$100k", "Fresh start", "Olive", "other.resume", "cf_svy"];
function assertNothingLeaks(text, what) {
  for (const word of PRIVATE) assert.ok(!text.includes(word), `${what}: "${word}" must not leave the door`);
}

test("the route is live and closed: the bare GET is the door's own 400, and a good link is a 404 with nothing in it",
  { skip: !HAS_DB }, async () => {
    const bare = await door("", {});
    assert.equal(bare.status, 400, "public/survey-resume is missing from the ROUTES map in netlify/functions/api.mjs");
    assert.deepEqual(await json(bare), { ok: false, error: "token_required" });

    const res = await door(`?r=${mint()}`);
    assert.equal(res.status, 404);
    assert.equal(res.headers.get("access-control-allow-origin"), PAGE, "the door's own answer, not the router's");
    assert.equal(res.headers.get("cache-control"), "no-store");
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), { ok: false });
    assertNothingLeaks(text, "a good link");
  });

test("no client's good link opens anything: a ClickFunnels lead, another company's person", { skip: !HAS_DB }, async () => {
  for (const [what, clientId] of [["the ClickFunnels lead", nativeLead], ["the other company's person", otherOrgClient]]) {
    const res = await door(`?r=${mint({ clientId })}`);
    assert.equal(res.status, 404, what);
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), { ok: false }, what);
    assertNothingLeaks(text, what);
  }
});

test("no token is a 400, a bad one is a 404 — and the pulse's bare GET sees the 400", { skip: !HAS_DB }, async () => {
  const none = await door("", {});
  assert.equal(none.status, 400);
  assert.deepEqual(await json(none), { ok: false, error: "token_required" });
  const empty = await door("?r=", {});
  assert.equal(empty.status, 400);

  const good = mint();
  const cases = {
    garbage: "hello",
    tampered: good.slice(0, 50) + (good[50] === "A" ? "B" : "A") + good.slice(51),
    expired: mint({ now: () => Date.now() - 31 * DAY }),
    "signed with another key": mint({ secret: "another-key-another-key-another-key-0123456789" }),
    "a client that does not exist": mint({ clientId: "11111111-2222-4333-8444-555555555555" })
  };
  for (const [what, t] of Object.entries(cases)) {
    const res = await door(`?r=${t}`);
    assert.equal(res.status, 404, what);
    assert.deepEqual(await json(res), { ok: false }, `${what}: nothing in the body`);
  }
});

test("it changes nothing: the same records, byte for byte, after the calls", { skip: !HAS_DB }, async () => {
  const snapshot = async () => (await db.query(
    `SELECT id, updated_at, custom_fields, email, phone FROM clients WHERE org_id = ANY($1) ORDER BY id`,
    [[orgId, otherOrgId]])).rows;
  const eventCount = async () => (await db.query(`SELECT count(*)::int AS n FROM events WHERE org_id = ANY($1)`, [[orgId, otherOrgId]])).rows[0].n;
  const before = [await snapshot(), await eventCount()];
  await door(`?r=${mint()}`);
  await door(`?r=${mint({ clientId: nativeLead })}`);
  await door(`?r=junk`);
  assert.deepEqual([await snapshot(), await eventCount()], before);
});

test("readSurveyResume gives the pulse null for every link, real rows included", { skip: !HAS_DB }, async () => {
  for (const t of [mint(), mint({ clientId: nativeLead }), mint({ clientId: otherOrgClient }), "nope"]) {
    assert.equal(await readSurveyResume(db, t, { secret: SECRET }), null);
  }
});

test("collision on real rows: a stranger's /apply with a lead's email takes the phone, and the lead's code still opens nothing",
  { skip: !HAS_DB }, async () => {
    const lead = await makeClient(orgId, {
      email: "dana.collision@survey-resume.test", phone: "+15551230009", first: "Dana", last: "Lead",
      custom: { cf_svy_funding_target_amount: "$100k - $200k", cf_svy_planned_use: "Payroll or rent", cf_svy_self_reported_fico: "580-649" }
    });
    // A CRM link already on file, so resolveClient makes no outside call.
    await db.query(`UPDATE clients SET ghl_contact_id = 'crm-collision-test' WHERE id = $1`, [lead]);

    const id = await resolveClient(db, {
      orgId, name: "entry.captured",
      payload: { email: "DANA.COLLISION@survey-resume.test", phone: "(555) 999-0009", name: "Mallory Stranger",
        source: "clickfunnels", funnel: "apply-survey" }
    });
    assert.equal(id, lead, "the email matched the existing lead");
    const row = (await db.query(`SELECT phone, custom_fields FROM clients WHERE id = $1`, [lead])).rows[0];
    assert.equal(row.phone, "+15559990009", "the precondition: the lead's texts now go to the stranger's phone");
    assert.equal(row.custom_fields.cf_svy_planned_use, "Payroll or rent", "the lead's answers are still saved");

    // The exact link the old S-00/S-02 put in that text.
    const res = await door(`?r=${mint({ clientId: lead })}`);
    assert.equal(res.status, 404);
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), { ok: false });
    for (const word of ["dana.collision", "5551230009", "5559990009", "Dana", "Mallory", "$100k", "Payroll", "580-649", "cf_svy"]) {
      assert.ok(!text.includes(word), `"${word}" must not leave the door`);
    }
  });
