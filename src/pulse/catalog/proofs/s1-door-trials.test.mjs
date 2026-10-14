// Slice 1 (money routes): the $297 Live Trial. Day 0 provisions what the buyer
// paid for; day 8 converts (opens the payout gate from a signed licence) or
// declines (pauses, keeps the leads). Real handlers, stand-in database.
import assert from "node:assert/strict";
import test from "node:test";

import convert from "../../../../api/trials/convert.mjs";
import provision from "../../../../api/trials/provision.mjs";
import { ROUTES } from "../../../../netlify/functions/api.mjs";
import {
  ORG_ID, STAFF_ID, fakeDb, makeRes, req, runWithSharedDb, staffSession,
} from "../../../testing/handler-harness.mjs";

const PARTNER_ID = "9a000000-0000-4000-8000-000000000001";
const TRIAL_ID = "7a000000-0000-4000-8000-000000000001";
const AFFILIATE_ID = "af000000-0000-4000-8000-000000000001";
const SIGNED_AT = "2026-10-10T15:00:00.000Z";

async function run(handler, request, rules) {
  const fake = fakeDb(rules);
  const res = makeRes();
  await runWithSharedDb(fake, () => handler(request, res));
  return { res, fake };
}

// ── day 0: provision ──────────────────────────────────────────────────────
const SELL = {
  name: "Pat Partner", email: "Pat@Example.test", company: "Pat Funding",
  has_ad_account: true, business_verified: true, can_fund_ad_spend: true,
};

function provisionRules() {
  return [
    staffSession({ role: "admin" }),
    [/FROM partners\s+WHERE org_id = \$1 AND lower\(contact_email\)/, []],
    [/SELECT 1 FROM partners WHERE org_id = \$1 AND slug/, []],
    [/INSERT INTO partners/, (sql, p) => [{ id: PARTNER_ID, slug: p[3], status: "invited" }]],
    [/FROM accounts WHERE org_id = \$1 AND lower\(email\)/, []],
    [/INSERT INTO affiliates/, [{ id: AFFILIATE_ID, tracking_id: "trk-0001" }]],
    [/SELECT id FROM staff\s+WHERE org_id = \$1 AND role = 'owner'/, [{ id: STAFF_ID }]],
    [/INSERT INTO accounts/, [{ id: "ac000000-0000-4000-8000-000000000001" }]],
    [/INSERT INTO live_trials/, (sql, p) => [{ id: TRIAL_ID, status: p[3] ?? "provisioned" }]],
    [/INSERT INTO live_trial_events/, [{ id: "ee000000-0000-4000-8000-000000000001", kind: "provisioned" }]],
  ];
}

test("trials/provision stands up the partner, affiliate, login, draft brand and draft page the $297 buys, and starts no clock", async () => {
  assert.equal(ROUTES["trials/provision"], provision);
  const { res, fake } = await run(provision, req("POST", { body: SELL }), provisionRules());
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.ok, true);
  assert.equal(res.body.partner_id, PARTNER_ID);
  assert.equal(res.body.affiliate_id, AFFILIATE_ID);
  assert.equal(res.body.live_trial_id, TRIAL_ID);
  assert.equal(res.body.held_start, false);
  assert.equal(res.body.agreement_signed, false, "no signature yet, so no payout");
  assert.equal(res.body.clock_started, false, "the seven days start at the first ad impression");
  assert.equal(res.body.email, "pat@example.test");
  assert.equal(typeof res.body.password, "string", "a first password is handed over once");

  const [partner] = fake.find(/INSERT INTO partners/);
  assert.equal(partner.params[0], ORG_ID);
  assert.equal(partner.params[1], "Pat Funding");
  assert.equal(partner.params[4], "pat@example.test");
  assert.match(fake.find(/INSERT INTO partners/)[0].sql, /'invited',50/, "invited at a 50 percent share");

  const [page] = fake.find(/INSERT INTO partner_pages/);
  assert.match(page.sql, /'draft'/, "the page is a draft; publishing is a separate human gate");
  assert.equal(fake.find(/INSERT INTO partner_brand/).length, 1);
  assert.equal(fake.find(/INSERT INTO accounts/).length, 1);
  assert.equal(fake.count("BEGIN"), 1);
  assert.equal(fake.count("COMMIT"), 1);
  assert.equal(fake.count("ROLLBACK"), 0);
});

test("trials/provision refuses a held sale with 409 and writes nothing; a closer cannot call it", async () => {
  const held = await run(provision, req("POST", { body: { ...SELL, has_ad_account: false } }), provisionRules());
  assert.equal(held.res.statusCode, 409);
  assert.equal(held.res.body.error, "not_eligible");
  assert.equal(held.fake.find(/INSERT INTO (partners|affiliates|accounts|live_trials)/).length, 0);

  const rules = provisionRules();
  rules[0] = staffSession({ role: "closer" });
  const closer = await run(provision, req("POST", { body: SELL }), rules);
  assert.equal(closer.res.statusCode, 403);
  assert.equal(closer.fake.find(/INSERT INTO partners/).length, 0);
});

// ── day 8: convert or decline ─────────────────────────────────────────────
const TRIAL = {
  id: TRIAL_ID, org_id: ORG_ID, partner_id: PARTNER_ID, affiliate_id: AFFILIATE_ID, status: "live",
  price_cents: 29700, contact_email: "pat@example.test", frozen_until: "2026-11-01T00:00:00.000Z",
};

function convertRules({ signedLicense = true, agreementAt = null, trial = TRIAL } = {}) {
  return [
    staffSession({ role: "admin" }),
    [/FROM live_trials WHERE org_id = \$1 AND partner_id = \$2/, trial ? [trial] : []],
    [/SELECT id, agreement_signed_at FROM partners/, [{ id: PARTNER_ID, agreement_signed_at: agreementAt }]],
    [/FROM contracts\s+WHERE org_id = \$1::uuid\s+AND template_key/, signedLicense ? [{ id: "c0000000-0000-4000-8000-000000000001", signed_at: SIGNED_AT }] : []],
    [/FROM contract_templates/, [{ template_key: "PARTNER-LICENSE" }]],
    [/UPDATE partners\s+SET agreement_signed_at/, [{ id: PARTNER_ID, agreement_signed_at: SIGNED_AT }]],
    [/UPDATE partners\s+SET status = 'active'/, [{ id: PARTNER_ID, status: "active", agreement_signed_at: SIGNED_AT, revenue_share_pct: "50" }]],
    [/FROM affiliate_referrals/, [{ id: "ae000000-0000-4000-8000-000000000001" }, { id: "ae000000-0000-4000-8000-000000000002" }]],
    [/UPDATE affiliate_referrals\s+SET status = 'void'/, (sql, p) => [{ id: p[0], status: "void" }]],
    [/UPDATE live_trials/, [{ id: TRIAL_ID }]],
    [/INSERT INTO live_trial_events/, [{ id: "ee000000-0000-4000-8000-000000000002" }]],
  ];
}

test("trials/convert flips the partner active from a SIGNED licence, voids the trial referrals and says nobody is paid yet", async () => {
  assert.equal(ROUTES["trials/convert"], convert);
  const { res, fake } = await run(convert, req("POST", {
    body: { partner_id: PARTNER_ID, decision: "convert", agreement_signed_at: SIGNED_AT },
  }), convertRules());
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.ok, true);
  assert.equal(res.body.partner_status, "active");
  assert.equal(res.body.referrals_voided, 2);
  assert.equal(res.body.payable, false);
  assert.equal(res.body.payable_blocked_reason, "no_production_accrual_writer");
  assert.equal(res.body.trial_rebate_cents, 29700);

  const [stamp] = fake.find(/UPDATE partners\s+SET agreement_signed_at/);
  assert.equal(stamp.params[2], SIGNED_AT, "the date comes off the signed document");
  const voids = fake.find(/UPDATE affiliate_referrals\s+SET status = 'void'/);
  assert.equal(voids.length, 2);
  assert.ok(voids.every((c) => c.params[1] === "converted_to_partner"), "unwound with a reason, never deleted");
  const [trialUpdate] = fake.find(/UPDATE live_trials/);
  assert.equal(trialUpdate.params[2], "converted");
  assert.equal(fake.find(/INSERT INTO live_trial_events/)[0].params[2], "converted");
});

test("trials/convert refuses with no signed licence (409) and without a signature moment (400); the payout gate stays shut", async () => {
  const unsigned = await run(convert, req("POST", {
    body: { partner_id: PARTNER_ID, decision: "convert", agreement_signed_at: SIGNED_AT },
  }), convertRules({ signedLicense: false }));
  assert.equal(unsigned.res.statusCode, 409);
  assert.equal(unsigned.res.body.error, "partner_license_not_signed");
  assert.equal(unsigned.fake.find(/UPDATE partners/).length, 0);
  assert.equal(unsigned.fake.find(/UPDATE live_trials/).length, 0);

  const noMoment = await run(convert, req("POST", { body: { partner_id: PARTNER_ID, decision: "convert" } }), convertRules());
  assert.equal(noMoment.res.statusCode, 400);
  assert.equal(noMoment.res.body.error, "agreement_signed_at_required");
  assert.equal(noMoment.fake.find(/UPDATE partners/).length, 0);

  const closer = convertRules();
  closer[0] = staffSession({ role: "closer" });
  const denied = await run(convert, req("POST", { body: { partner_id: PARTNER_ID, decision: "convert", agreement_signed_at: SIGNED_AT } }), closer);
  assert.equal(denied.res.statusCode, 403);
});

test("trials/convert decline pauses the partner, keeps the affiliate and every lead, and records the decision", async () => {
  const rules = convertRules();
  rules.splice(1, 0,
    [/FROM affiliates WHERE id = \$1 AND org_id = \$2/, [{ id: AFFILIATE_ID, name: "Pat Partner", tracking_id: "trk-0001" }]],
    [/UPDATE partner_pages/, [{ id: "pa000000-0000-4000-8000-000000000001" }]],
  );
  const { res, fake } = await run(convert, req("POST", {
    body: { partner_id: PARTNER_ID, decision: "decline", reason: "not a fit" },
  }), rules);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.partner_status, "paused");
  assert.equal(res.body.affiliate_id, AFFILIATE_ID);
  assert.equal(res.body.payable, false);
  assert.match(res.body.message, /You keep every lead/);
  const [pause] = fake.find(/UPDATE partners SET status = 'paused'/);
  assert.deepEqual(pause.params, [ORG_ID, PARTNER_ID]);
  assert.equal(fake.find(/UPDATE partners\s+SET agreement_signed_at/).length, 0, "decline never opens the payout gate");
  assert.equal(fake.find(/UPDATE affiliate_referrals/).length, 0, "no referral is touched");
  assert.equal(fake.find(/UPDATE live_trials/)[0].params[2], "declined");
});
