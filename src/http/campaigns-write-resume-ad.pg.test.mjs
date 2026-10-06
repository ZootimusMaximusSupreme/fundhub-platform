// POST /api/campaigns/write {action:'resume_ad'} — the ON switch for ONE ad.
//
// Spec docs/specs/marketing-machine-2026-10-04.md §10.5 "Turn on", §2 item 6
// ("Only Chris turns ads on"), §4 trap 11 ("Turn on works per ad"). Plan unit
// U15 (ops/workflows/marketing-machine-2026-10-plan.json).
//
// WHAT THIS FILE PROVES
//   - Only a staff login with an owner/admin role whose staff id is on
//     MARKETING_AD_SWITCH_STAFF_IDS can turn an ad on. A closer, a csm, a
//     partner login, an admin not on the list, and everybody when the list is
//     unset, all get 403 "Only Chris can turn ads on." and Meta is never called.
//   - The listed owner gets 200, and the fake Meta gets exactly ONE POST, to
//     that ad's own Meta id, with status ACTIVE.
//   - A campaign uuid, an ad set uuid or a raw Meta id in ad_id is a 404 with
//     zero Meta calls.
//   - ads.status says ACTIVE only after Meta says yes. action_log keeps one row:
//     actor human, target_type 'ad', and the staff id.
//   - The old campaign actions still work the way they did.
//
// The first describe block needs no database and always runs. The second needs
// DATABASE_URL and skips without it; CI runs it on a fresh database built from
// db/migrations (.github/workflows/tests.yml). Never point it at the live
// database (spec §0.7).
//
// Lives under src/ because npm test only globs src/** and scripts/** (CLAUDE.md
// §12); it imports the api/ handler directly.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createSession } from "../auth/session.mjs";
import { asStaff } from "../partners/rls.mjs";
import handler, {
  adSwitchStaffIds, mayTurnOnAds, AD_SWITCH_ENV, ONLY_CHRIS, NOT_OUR_AD
} from "../../api/campaigns/write.mjs";

const HAS_DB = !!process.env.DATABASE_URL;

// The token cipher refuses to work without a key (src/adplatforms/tokens.mjs).
// A run-local key is enough: this file encrypts a fake token and the adapter
// decrypts it again in the same process.
if (!process.env.AD_TOKEN_ENC_KEY) {
  process.env.AD_TOKEN_ENC_KEY = crypto.randomBytes(32).toString("base64");
}

const MARK = "u15resumead";
const SLUG = "u15-resume-ad-pg-test";
const EMAIL_TAG = "u15_resume_ad_pg_test";
const PARTNER_EMAIL = `partner.${MARK}@example.com`;

// Meta ids for the fixture. Fake, and shaped like Meta's (digits only).
const EXT_ACCOUNT = "act_9015000100010001";
const EXT_CAMPAIGN = "90150001000001";
const EXT_AD_SET = "90150001000002";
const EXT_AD_ON = "90150001000101";
const EXT_AD_REPEAT = "90150001000102";
const EXT_AD_REFUSED = "90150001000103";
const EXT_AD_UNSURE = "90150001000104";
const EXT_AD_GATES = "90150001000105";

const UUID_A = "11111111-2222-4333-8444-555555555555";
const UUID_B = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

/* ───────────────────── the gate, with no database ───────────────────── */

describe("resume_ad gate — who may turn an ad on (no database)", () => {
  const owner = { kind: "staff", staffId: UUID_A, role: "owner", orgId: UUID_B };
  const env = (v) => ({ [AD_SWITCH_ENV]: v });

  test("the env name is the one the plan names", () => {
    assert.equal(AD_SWITCH_ENV, "MARKETING_AD_SWITCH_STAFF_IDS");
    assert.equal(ONLY_CHRIS, "Only Chris can turn ads on.");
  });

  test("an owner on the list may; the same owner off the list may not", () => {
    assert.equal(mayTurnOnAds(owner, env(UUID_A)), true);
    assert.equal(mayTurnOnAds(owner, env(UUID_B)), false);
  });

  test("unset, empty, blank or junk lists let NOBODY in", () => {
    assert.equal(mayTurnOnAds(owner, {}), false);
    assert.equal(mayTurnOnAds(owner, env("")), false);
    assert.equal(mayTurnOnAds(owner, env(" , ,")), false);
    assert.equal(mayTurnOnAds(owner, env("****************5555")), false);
    assert.equal(mayTurnOnAds(owner, env("chris")), false);
    assert.equal(adSwitchStaffIds({}).size, 0);
  });

  test("the list is comma separated, spaces and case do not matter", () => {
    const ids = adSwitchStaffIds(env(` ${UUID_B.toUpperCase()} ,${UUID_A}, junk`));
    assert.deepEqual([...ids].sort(), [UUID_A, UUID_B].sort());
    assert.equal(mayTurnOnAds({ ...owner, staffId: UUID_B }, env(UUID_B.toUpperCase())), true);
  });

  test("an admin on the list may; a closer, csm, setter or partner role on the list may not", () => {
    assert.equal(mayTurnOnAds({ ...owner, role: "admin" }, env(UUID_A)), true);
    for (const role of ["closer", "csm", "setter", "sales_manager", "funding_advisor", "partner", "", null]) {
      assert.equal(mayTurnOnAds({ ...owner, role }, env(UUID_A)), false, `role ${role} must be refused`);
    }
  });

  test("a partner, client or affiliate login may not, even holding a listed id", () => {
    for (const kind of ["partner", "client", "affiliate"]) {
      assert.equal(mayTurnOnAds({ kind, staffId: UUID_A, role: "owner" }, env(UUID_A)), false);
    }
    assert.equal(mayTurnOnAds(null, env(UUID_A)), false);
    assert.equal(mayTurnOnAds({ kind: "staff", role: "owner" }, env(UUID_A)), false);
  });
});

/* ───────────────────── the handler, against Postgres ───────────────────── */

const res = () => {
  const r = { code: null, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = () => r;
  return r;
};

/* fakeMeta — answers like Meta's Graph API and records every call. callPlatform
   (src/adplatforms/_api.mjs) reads .ok, .status and .text(). */
function fakeMeta({ status = 200, answer = { success: true } } = {}) {
  const calls = [];
  return {
    calls,
    fetch: async (url, init = {}) => {
      calls.push({
        url: String(url),
        method: init.method || "GET",
        body: init.body ? JSON.parse(init.body) : null
      });
      return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(answer)
      };
    }
  };
}

describe("POST /api/campaigns/write resume_ad — one ad, by our ads.id, Chris only",
  { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {

  let org, partnerId, connId, campaignId, adSetId;
  let owner, admin, closer, csm;
  let tokenOwner, tokenAdmin, tokenCloser, tokenCsm, tokenPartner;
  const ads = {};

  // The switch list for this run: the owner, plus a closer and a csm. The
  // closer and csm are listed on purpose, so their 403 proves the ROLE lock,
  // not just the list.
  let ENV;

  async function post(token, body, deps = {}) {
    const r = res();
    await handler(
      { method: "POST", query: {}, body, headers: token ? { authorization: "Bearer " + token } : {} },
      r,
      { env: ENV, ...deps }
    );
    return r;
  }

  const adRow = async (id) => (await asStaff((tx) => tx.query(
    `SELECT status, last_error, approval_state, updated_at FROM ads WHERE id = $1`, [id]))).rows[0];

  const logRows = async (targetId) => (await asStaff((tx) => tx.query(
    `SELECT actor, user_id, target_type, target_id, org_id, partner_id, reason, before, after,
            executed_at, execute_error
       FROM action_log WHERE target_id = $1 ORDER BY created_at`, [targetId]))).rows;

  async function cleanup() {
    const ids = (await db.query(`SELECT id FROM partners WHERE slug = $1`, [SLUG])).rows.map((r) => r.id);
    if (ids.length) {
      await asStaff(async (tx) => {
        for (const t of ["ads", "ad_sets", "campaigns", "ad_platform_connections"]) {
          await tx.query(`DELETE FROM ${t} WHERE partner_id = ANY($1)`, [ids]);
        }
      });
      // The partner row stays: action_log is append-only (046) and its
      // partner_id is ON DELETE RESTRICT, so a partner with logged actions
      // cannot be deleted. The next run reuses it by slug.
    }
    await db.query(
      `DELETE FROM sessions WHERE staff_id IN (SELECT id FROM staff WHERE email LIKE $1)`,
      [`${EMAIL_TAG}%`]);
    // accounts.invited_by is ON DELETE SET NULL, so the partner login survives.
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [`${EMAIL_TAG}%`]);
  }

  async function staffRow(role) {
    const row = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status)
       VALUES ($1,$2,$3,$4,'active') RETURNING id`,
      [org, `${EMAIL_TAG}.${role}@example.com`, `U15 ${role} fixture`, role]
    )).rows[0];
    const token = (await createSession(db, { staffId: row.id, orgId: org })).token;
    return { id: row.id, token };
  }

  before(async () => {
    const { encryptToken } = await import("../adplatforms/tokens.mjs");
    org = await resolveDefaultOrg(db);
    await cleanup();

    ({ id: owner, token: tokenOwner } = await staffRow("owner"));
    ({ id: admin, token: tokenAdmin } = await staffRow("admin"));
    ({ id: closer, token: tokenCloser } = await staffRow("closer"));
    ({ id: csm, token: tokenCsm } = await staffRow("csm"));
    ENV = { [AD_SWITCH_ENV]: `${owner},${closer}, ${csm}` };

    partnerId = (await db.query(
      `INSERT INTO partners (org_id, name, slug, status, contact_email)
       VALUES ($1,'U15 resume_ad fixture',$2,'active',$3)
       ON CONFLICT (org_id, slug) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [org, SLUG, PARTNER_EMAIL]
    )).rows[0].id;

    // A partner login for this partner. 044 makes a partner account
    // invite-only, so invited_by names the owner fixture.
    const { createAccount, createAccountSession } = await import("../auth/account-session.mjs");
    const existing = await db.query(`SELECT id FROM accounts WHERE email = $1`, [PARTNER_EMAIL]);
    const accountId = existing.rows[0]
      ? existing.rows[0].id
      : (await createAccount(db, {
          orgId: org, kind: "partner", email: PARTNER_EMAIL, name: "U15 partner",
          password: `U15-${MARK}-passw0rd!`, partnerId, invitedBy: owner
        })).id;
    tokenPartner = (await createAccountSession(db, { accountId, orgId: org })).token;

    await asStaff(async (tx) => {
      connId = (await tx.query(
        `INSERT INTO ad_platform_connections
           (org_id, partner_id, platform, external_ad_account_id, encrypted_access_token,
            connection_state, platform_verification_state)
         VALUES ($1,$2,'meta',$3,$4,'active','approved') RETURNING id`,
        [org, partnerId, EXT_ACCOUNT, encryptToken(`fake-meta-token-${MARK}`, { partnerId })]
      )).rows[0].id;

      // offer_type 'funding' is seeded into ad_platform_category_map (052).
      campaignId = (await tx.query(
        `INSERT INTO campaigns (org_id, partner_id, connection_id, external_id, name, status,
                                offer_type, budget_cents, approval_state)
         VALUES ($1,$2,$3,$4,'U15 campaign','PAUSED','funding',10000,'draft') RETURNING id`,
        [org, partnerId, connId, EXT_CAMPAIGN]
      )).rows[0].id;

      adSetId = (await tx.query(
        `INSERT INTO ad_sets (org_id, partner_id, connection_id, campaign_id, external_id, name,
                              status, budget_cents, approval_state)
         VALUES ($1,$2,$3,$4,$5,'U15 ad set','PAUSED',10000,'draft') RETURNING id`,
        [org, partnerId, connId, campaignId, EXT_AD_SET]
      )).rows[0].id;

      const insertAd = (name, externalId, number = null) => tx.query(
        `INSERT INTO ads (org_id, partner_id, connection_id, campaign_id, ad_set_id,
                          external_id, name, status, fundhub_ad_number)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'PAUSED',$8) RETURNING id`,
        [org, partnerId, connId, campaignId, adSetId, externalId, name, number]
      ).then((r) => r.rows[0].id);

      ads.on = await insertAd("U15 ad on", EXT_AD_ON, "915101");
      ads.repeat = await insertAd("U15 ad repeat", EXT_AD_REPEAT);
      ads.refused = await insertAd("U15 ad refused", EXT_AD_REFUSED);
      ads.unsure = await insertAd("U15 ad unsure", EXT_AD_UNSURE);
      ads.gates = await insertAd("U15 ad gates", EXT_AD_GATES);
      ads.notLoaded = await insertAd("U15 ad not in Meta yet", null);
    });
  });

  after(async () => {
    await cleanup();
    await close();
  });

  /* ── who ──────────────────────────────────────────────────────────────── */

  test("no session is 401, and Meta is not called", async () => {
    const meta = fakeMeta();
    const r = await post(null, { action: "resume_ad", ad_id: ads.gates }, { fetch: meta.fetch });
    assert.equal(r.code, 401, JSON.stringify(r.body));
    assert.equal(meta.calls.length, 0);
  });

  test("closer 403, csm 403 (both on the list), partner login 403, admin not on the list 403", async () => {
    const meta = fakeMeta();
    for (const [who, token] of [
      ["closer", tokenCloser], ["csm", tokenCsm], ["partner login", tokenPartner], ["admin", tokenAdmin]
    ]) {
      const r = await post(token, { action: "resume_ad", ad_id: ads.gates, request_id: `u15-${who}` },
        { fetch: meta.fetch });
      assert.equal(r.code, 403, `${who}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.error, "forbidden", who);
      assert.equal(r.body.message, "Only Chris can turn ads on.", who);
    }
    assert.equal(meta.calls.length, 0, "Meta must never hear from a refused caller");
    assert.equal((await adRow(ads.gates)).status, "PAUSED");
    assert.equal((await logRows(ads.gates)).length, 0, "a refused caller leaves no action_log row");
  });

  test("switch list unset or empty: 403 for everyone, the owner too", async () => {
    const meta = fakeMeta();
    for (const env of [{}, { [AD_SWITCH_ENV]: "" }, { [AD_SWITCH_ENV]: " , " }]) {
      for (const [who, token] of [
        ["owner", tokenOwner], ["admin", tokenAdmin], ["closer", tokenCloser],
        ["csm", tokenCsm], ["partner login", tokenPartner]
      ]) {
        const r = await post(token, { action: "resume_ad", ad_id: ads.gates }, { env, fetch: meta.fetch });
        assert.equal(r.code, 403, `${who} with ${JSON.stringify(env)}: ${JSON.stringify(r.body)}`);
        assert.equal(r.body.message, ONLY_CHRIS);
      }
    }
    assert.equal(meta.calls.length, 0);
    assert.equal((await adRow(ads.gates)).status, "PAUSED");
    assert.equal((await logRows(ads.gates)).length, 0);
  });

  /* ── the listed owner ─────────────────────────────────────────────────── */

  test("the listed owner turns the ad on: 200, exactly one POST to that ad's Meta id with ACTIVE", async () => {
    const campBefore = (await asStaff((tx) => tx.query(
      `SELECT status, approval_state, updated_at FROM campaigns WHERE id = $1`, [campaignId]))).rows[0];
    const setBefore = (await asStaff((tx) => tx.query(
      `SELECT status, approval_state, updated_at FROM ad_sets WHERE id = $1`, [adSetId]))).rows[0];

    const meta = fakeMeta();
    const r = await post(tokenOwner,
      { action: "resume_ad", ad_id: ads.on, request_id: "u15-req-1" }, { fetch: meta.fetch });

    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.ok, true);
    assert.deepEqual(r.body.ad, { id: ads.on, status: "ACTIVE" });

    assert.equal(meta.calls.length, 1, JSON.stringify(meta.calls));
    const call = meta.calls[0];
    assert.equal(call.method, "POST");
    const u = new URL(call.url);
    assert.equal(u.hostname, "graph.facebook.com");
    assert.match(u.pathname, new RegExp(`^/v\\d+\\.\\d+/${EXT_AD_ON}$`),
      "the POST goes to the ad's own Meta id and nothing else");
    assert.equal(u.search, "");
    assert.deepEqual(call.body, { status: "ACTIVE" });

    const row = await adRow(ads.on);
    assert.equal(row.status, "ACTIVE", "ads.status mirrors what Meta confirmed");
    assert.equal(row.last_error, null);

    const logs = await logRows(ads.on);
    assert.equal(logs.length, 1);
    const log = logs[0];
    assert.equal(log.actor, "human");
    assert.equal(log.target_type, "ad");
    assert.equal(log.target_id, ads.on);
    assert.equal(log.org_id, org);
    assert.equal(log.partner_id, partnerId);
    assert.equal(log.after.staff_id, owner, "the staff id who turned it on is on the row");
    assert.equal(log.after.status, "ACTIVE");
    assert.equal(log.after.request_id, "u15-req-1");
    assert.equal(log.before.status, "PAUSED");
    // user_id references accounts (partner/client logins), not staff.
    assert.equal(log.user_id, null);
    assert.ok(log.executed_at, "stamped as executed");
    assert.equal(log.execute_error, null);
    assert.match(log.reason, /Ad 915101/);
    assert.equal(typeof r.body.action_log_id, "string");

    // Never a campaign, never an ad set.
    const campAfter = (await asStaff((tx) => tx.query(
      `SELECT status, approval_state, updated_at FROM campaigns WHERE id = $1`, [campaignId]))).rows[0];
    const setAfter = (await asStaff((tx) => tx.query(
      `SELECT status, approval_state, updated_at FROM ad_sets WHERE id = $1`, [adSetId]))).rows[0];
    assert.deepEqual(campAfter, campBefore, "the campaign row is untouched");
    assert.deepEqual(setAfter, setBefore, "the ad set row is untouched");
    assert.equal((await logRows(campaignId)).length, 0);
    assert.equal((await logRows(adSetId)).length, 0);
  });

  test("a repeat re-sends ACTIVE once more and answers 200 again", async () => {
    const first = fakeMeta();
    const a = await post(tokenOwner, { action: "resume_ad", ad_id: ads.repeat, request_id: "u15-rep" },
      { fetch: first.fetch });
    assert.equal(a.code, 200, JSON.stringify(a.body));
    const second = fakeMeta();
    const b = await post(tokenOwner, { action: "resume_ad", ad_id: ads.repeat, request_id: "u15-rep" },
      { fetch: second.fetch });
    assert.equal(b.code, 200, JSON.stringify(b.body));
    assert.deepEqual(b.body.ad, { id: ads.repeat, status: "ACTIVE" });
    assert.equal(first.calls.length, 1);
    assert.equal(second.calls.length, 1);
    assert.deepEqual(second.calls[0].body, { status: "ACTIVE" });
    assert.ok(second.calls[0].url.endsWith(`/${EXT_AD_REPEAT}`));
    assert.equal((await adRow(ads.repeat)).status, "ACTIVE");
    assert.equal((await logRows(ads.repeat)).length, 2, "each press is its own logged action");
  });

  /* ── which ad ─────────────────────────────────────────────────────────── */

  test("a campaign uuid, an ad set uuid or a raw Meta id is 404 and Meta is called zero times", async () => {
    const meta = fakeMeta();
    const tries = [
      ["campaign uuid", campaignId],
      ["ad set uuid", adSetId],
      ["connection uuid", connId],
      ["raw Meta ad id", EXT_AD_GATES],
      ["raw Meta campaign id", EXT_CAMPAIGN],
      ["Meta id as a number", Number(EXT_AD_GATES)],
      ["act_ account id", EXT_ACCOUNT],
      ["a uuid that is no row", crypto.randomUUID()]
    ];
    for (const [what, value] of tries) {
      const r = await post(tokenOwner, { action: "resume_ad", ad_id: value }, { fetch: meta.fetch });
      assert.equal(r.code, 404, `${what}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.error, "not_found", what);
      assert.equal(r.body.message, NOT_OUR_AD, what);
    }
    assert.equal(meta.calls.length, 0, "no wrong-kind id may reach Meta");
    const camp = (await asStaff((tx) => tx.query(
      `SELECT status FROM campaigns WHERE id = $1`, [campaignId]))).rows[0];
    assert.equal(camp.status, "PAUSED");
    assert.equal((await adRow(ads.gates)).status, "PAUSED");
  });

  test("no ad_id is 400 invalid ad_id; an ad not in Meta yet is 400; Meta is not called", async () => {
    const meta = fakeMeta();
    const none = await post(tokenOwner, { action: "resume_ad" }, { fetch: meta.fetch });
    assert.equal(none.code, 400, JSON.stringify(none.body));
    assert.equal(none.body.error, "invalid");
    assert.equal(none.body.field, "ad_id");

    const notLoaded = await post(tokenOwner, { action: "resume_ad", ad_id: ads.notLoaded }, { fetch: meta.fetch });
    assert.equal(notLoaded.code, 400, JSON.stringify(notLoaded.body));
    assert.equal(notLoaded.body.field, "ad_id");
    assert.match(notLoaded.body.message, /not in Meta yet/);

    const badReq = await post(tokenOwner, { action: "resume_ad", ad_id: ads.gates, request_id: 42 },
      { fetch: meta.fetch });
    assert.equal(badReq.code, 400, JSON.stringify(badReq.body));
    assert.equal(badReq.body.field, "request_id");

    assert.equal(meta.calls.length, 0);
    assert.equal((await logRows(ads.notLoaded)).length, 0);
  });

  /* ── only after Meta says yes ─────────────────────────────────────────── */

  test("Meta says no: 502 in plain words, ads.status stays PAUSED, Meta's words are kept", async () => {
    const meta = fakeMeta({
      status: 400,
      answer: { error: { message: "(#100) The ad account is disabled", code: 100 } }
    });
    const r = await post(tokenOwner, { action: "resume_ad", ad_id: ads.refused }, { fetch: meta.fetch });
    assert.equal(r.code, 502, JSON.stringify(r.body));
    assert.equal(r.body.ok, false);
    assert.equal(r.body.error, "platform_error");
    assert.match(r.body.message, /^Meta said no: \(#100\) The ad account is disabled\. The ad is still paused\.$/);
    assert.equal(meta.calls.length, 1);

    const row = await adRow(ads.refused);
    assert.equal(row.status, "PAUSED", "no yes from Meta, no ACTIVE");
    assert.match(String(row.last_error), /ad account is disabled/);

    const logs = await logRows(ads.refused);
    assert.equal(logs.length, 1, "the attempt is still logged");
    assert.equal(logs[0].target_type, "ad");
    assert.ok(logs[0].executed_at);
    assert.match(String(logs[0].execute_error), /ad account is disabled/);
  });

  test("Meta answers without success:true: not counted as on", async () => {
    const meta = fakeMeta({ status: 200, answer: {} });
    const r = await post(tokenOwner, { action: "resume_ad", ad_id: ads.unsure }, { fetch: meta.fetch });
    assert.equal(r.code, 502, JSON.stringify(r.body));
    assert.equal((await adRow(ads.unsure)).status, "PAUSED");
    assert.match(String((await logRows(ads.unsure))[0].execute_error), /did not say the ad is on/);
  });

  /* ── the old campaign actions, unchanged ──────────────────────────────── */

  test("a staff login without partner_id still gets 400 partner_id_required on a campaign action", async () => {
    const r = await post(tokenOwner, { action: "resume", campaign_id: campaignId });
    assert.equal(r.code, 400, JSON.stringify(r.body));
    assert.equal(r.body.error, "partner_id_required");
  });

  test("an unknown action is still 400 unknown_action, and the list names resume_ad", async () => {
    const r = await post(tokenPartner, { action: "turn_everything_on", campaign_id: campaignId });
    assert.equal(r.code, 400, JSON.stringify(r.body));
    assert.equal(r.body.error, "unknown_action");
    assert.deepEqual(r.body.allowed, ["pause", "resume", "update_budget", "resume_ad"]);
  });

  test("a partner login still pauses its own campaign the old way", async () => {
    // The campaign path takes no fake Meta through deps (it never did), so the
    // global fetch is swapped for this one call and put back.
    const meta = fakeMeta();
    const realFetch = globalThis.fetch;
    globalThis.fetch = meta.fetch;
    let r;
    try {
      r = await post(tokenPartner, { action: "pause", campaign_id: campaignId });
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.action, "pause");
    assert.equal(meta.calls.length, 1);
    assert.ok(meta.calls[0].url.endsWith(`/${EXT_CAMPAIGN}`), meta.calls[0].url);
    assert.deepEqual(meta.calls[0].body, { status: "PAUSED" });
    const camp = (await asStaff((tx) => tx.query(
      `SELECT status, approval_state FROM campaigns WHERE id = $1`, [campaignId]))).rows[0];
    assert.deepEqual(camp, { status: "PAUSED", approval_state: "paused" });
    const logs = await logRows(campaignId);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].target_type, "campaign");
  });
});
