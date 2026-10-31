/* GET /api/public/survey-resume against a real Postgres.
 *
 * WHY A DATABASE TEST AND NOT ONLY THE FAKE. survey-resume.test.mjs proves what the door
 * decides; it cannot prove the SQL, and the SQL is the company scope: a client id under
 * the wrong company must be a 404, not somebody else's file. A fake that answers the way
 * its author expected proves the author. This goes through netlify/functions/api.mjs, the
 * real front door, so it proves the ROUTES entry as well (a handler file is not a route).
 *
 * Every row is built by the test and removed after. The company, the clients and their
 * answers are made up; nothing here touches an existing company.
 *
 * SKIPS unless DATABASE_URL is a loopback scratch or CI database (the lock in
 * src/verification/scratch-guard.mjs). A skip is not a pass.
 */
import { test, before, after } from "node:test";
import assert from "node:assert";
import pg from "pg";
import { db, close } from "../db.mjs";
import { readSurveyResume } from "../../api/public/survey-resume.mjs";
import { surveyResumeToken } from "../survey/resume-link.mjs";
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

test("the route is live: a good link is a 200 from the real front door, with the saved contact and answers",
  { skip: !HAS_DB }, async () => {
    const res = await door(`?r=${mint()}`);
    assert.notEqual(res.status, 404, "public/survey-resume is missing from the ROUTES map in netlify/functions/api.mjs");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), PAGE);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(await json(res), {
      ok: true,
      contact: { first_name: "Pat", last_name: "Lee", email: "pat.resume@survey-resume.test", phone: "+15551230001" },
      answers: {
        cf_svy_funding_target_amount: "$50k - $100k",
        cf_svy_planned_use: "Growth (marketing, inventory, hiring)",
        cf_svy_money_change_now: ["Stability (cover bills / buffer slow weeks)"]
      },
      next_key: "cf_svy_self_reported_fico"
    });
  });

test("a ClickFunnels lead's answers come back as the words they picked, never as option ids",
  { skip: !HAS_DB }, async () => {
    const res = await door(`?r=${mint({ clientId: nativeLead })}`);
    assert.equal(res.status, 200);
    const body = await json(res);
    assert.deepEqual(body.answers, {
      cf_svy_funding_target_amount: "$100k - $200k",
      cf_svy_money_change_now: ["Fresh start (new business / startup launch)"]
    });
    assert.equal(body.next_key, "cf_svy_planned_use", "planned use has only an id saved, so it is asked again");
    assert.deepEqual(body.contact, { first_name: "Nat", last_name: "", email: "native.resume@survey-resume.test", phone: "" });
    assert.ok(!JSON.stringify(body).includes("2078") && !JSON.stringify(body).includes("2079"), "no option id in the body");
  });

test("nothing but the contact and the answers leaves the door", { skip: !HAS_DB }, async () => {
  const text = await (await door(`?r=${mint()}`)).text();
  assert.ok(!text.includes("a private note"));
  assert.ok(!text.includes("facebook"));
  assert.deepEqual(Object.keys(JSON.parse(text)).sort(), ["answers", "contact", "next_key", "ok"]);
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

test("each link opens the client it names, in whichever company they are in; a made-up client is a 404",
  { skip: !HAS_DB }, async () => {
    const mine = await door(`?r=${mint()}`);
    assert.equal((await json(mine)).contact.first_name, "Pat");
    // The token holds no company. The other company's person has their own link, and it finds their own row.
    const hers = await door(`?r=${mint({ clientId: otherOrgClient })}`);
    assert.equal(hers.status, 200);
    const body = await json(hers);
    assert.equal(body.contact.first_name, "Olive");
    assert.equal(body.contact.email, "other.resume@survey-resume.test");
    assert.deepEqual(body.answers, { cf_svy_planned_use: "Not sure yet" });
    // Pat's link with the other person's id swapped in is no link at all.
    const spliced = Buffer.from(otherOrgClient.replace(/-/g, ""), "hex").toString("base64url") + mint().slice(22);
    const bad = await door(`?r=${spliced}`);
    assert.equal(bad.status, 404);
    assert.deepEqual(await json(bad), { ok: false });
    // A client that was removed after the text went out.
    const gone = await door(`?r=${mint({ clientId: "11111111-2222-4333-8444-555555555555" })}`);
    assert.equal(gone.status, 404);
  });

test("it only reads: the same records, byte for byte, after the calls", { skip: !HAS_DB }, async () => {
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

test("readSurveyResume gives the pulse the same answer with no HTTP, and null for a bad link",
  { skip: !HAS_DB }, async () => {
    const found = await readSurveyResume(db, mint(), { secret: SECRET });
    assert.equal(found.ok, true);
    assert.equal(found.contact.first_name, "Pat");
    assert.equal(found.next_key, "cf_svy_self_reported_fico");
    assert.equal(await readSurveyResume(db, mint({ clientId: "11111111-2222-4333-8444-555555555555" }), { secret: SECRET }), null);
    assert.equal(await readSurveyResume(db, "nope", { secret: SECRET }), null);
  });

test("the database role the app runs as can make the read the door makes",
  { skip: !HAS_DB || !process.env.APP_DATABASE_URL }, async () => {
    // Production connects as fundhub_app, not as the owner that built this fixture. A read the owner can
    // make and the app cannot would be a door that answers 500 in production and 200 here.
    const pool = new pg.Pool({ connectionString: process.env.APP_DATABASE_URL, max: 1 });
    try {
      const found = await readSurveyResume(pool, mint(), { secret: SECRET });
      assert.equal(found?.ok, true);
      assert.equal(found.contact.email, "pat.resume@survey-resume.test");
      assert.equal(await readSurveyResume(pool, mint({ clientId: "11111111-2222-4333-8444-555555555555" }), { secret: SECRET }), null);
    } finally {
      await pool.end();
    }
  });
