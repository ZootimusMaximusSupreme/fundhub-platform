// THE GATE, THE DOCUMENT, AND THE CHAIN BETWEEN THEM — against a real Postgres,
// on the database's own trigger rather than on a comment.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): payout timing.
//
// WHY THIS FILE. src/contracts/partner-license.test.mjs proves the module refuses
// to stamp without a signed licence, using stubs, and never skips. What stubs
// cannot prove is the other half of the claim:
//
//   * that 042_partners.sql's trigger really is still there and really raises,
//   * that db/migrations/283_partner_license_template.sql really put a
//     PARTNER-LICENSE row in the database this application runs on,
//   * that stamping through the module really does release the same payout that
//     was refused a moment earlier.
//
// So this walks the whole sequence on real rows:
//
//   partner active, nothing signed  → payout refused by the database
//                                   → stampPartnerAgreement refuses too
//   a real PARTNER-LICENSE signed   → stamped from the moment on the document
//                                   → the same payout goes through
//   somebody else's signed licence  → does nothing for this partner
//
// SKIPS unless DATABASE_URL is set, with the reason printed, so an unset database
// reads as skipped and never as green. That is exactly why the stub file exists
// alongside it: the claim these tests carry must be provable with no database.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";

import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { bodyHash } from "./send.mjs";
import { renderContract, mergeContext } from "./render.mjs";
import {
  PARTNER_LICENSE_TEMPLATE_KEY, PARTNER_LICENSE_SUBTYPE, PARTNER_ID_MERGE_KEY,
  getPartnerLicenseTemplate, findSignedPartnerLicense, stampPartnerAgreement
} from "./partner-license.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const SKIP = HAS_DB ? false : "no DATABASE_URL";
const STAMP = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

let orgId = null;
let staffId = null;
let clientId = null;
let partnerId = null;      // the partner under test
let otherPartnerId = null; // a second partner, whose licence must not travel
const payoutIds = [];
const contractIds = [];

/** One payout row at whatever status the caller is testing. 042's trigger is
 *  BEFORE INSERT OR UPDATE OF status, so an INSERT straight at 'processing' is
 *  the same door a settlement run walks through. */
async function insertPayout(forPartner, status) {
  const row = (await db.query(
    `INSERT INTO partner_payouts
       (org_id, partner_id, period_start, period_end, amount, status)
     VALUES ($1, $2, now() - interval '30 days', now(), 1234.00, $3)
     RETURNING id`,
    [orgId, forPartner, status]
  )).rows[0];
  payoutIds.push(row.id);
  return row.id;
}

/** The message the database raised, or null when it let the write through.
 *  Asserting on null vs a message is what makes a broken gate loud. */
async function refusal(fn) {
  try { await fn(); return null; } catch (err) { return String((err && err.message) || err); }
}

/**
 * A REAL signed partner licence, built from the REAL seeded template row.
 *
 * The e-sign pipeline (send → link → sign → flatten) is covered end to end by
 * src/contracts/lifecycle.pg.test.mjs and is not re-walked here; what this needs
 * is a row in the shape that pipeline leaves behind, generated from the seeded
 * words through the real renderer so a template that stopped rendering would
 * fail here too.
 *
 * draft → signed in a single UPDATE is deliberate: trg_contracts_frozen only
 * refuses once OLD.status is no longer 'draft', which is the same reason send()
 * writes the frozen columns in one statement.
 */
async function signLicenceFor(forPartner, { signedAt, template }) {
  const merge = {
    company_name: "Fundhub",
    partner_brand: `Brandname ${STAMP}`,
    [PARTNER_ID_MERGE_KEY]: forPartner
  };
  const rendered = renderContract(
    template.body,
    mergeContext({
      contact: { full_name: `Partner Principal ${STAMP}`, email: `pl-${STAMP}@example.test` },
      values: merge,
      at: signedAt
    })
  );

  const row = (await db.query(
    `INSERT INTO contracts
       (org_id, client_id, template_id, template_key, title, kind, subtype,
        merge_values, rendered_body, body_sha, signature_statement, signature_required,
        status, sent_at, sent_by, signed_at, signer_name, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,true,
             'signed', $12, $13, $12, $14, $13)
     RETURNING id, signed_at`,
    [orgId, clientId, template.id, template.template_key, template.name,
     template.kind, template.subtype,
     JSON.stringify(merge), rendered, bodyHash(rendered), template.signature_statement,
     signedAt, staffId, `Partner Principal ${STAMP}`]
  )).rows[0];
  contractIds.push(row.id);
  return row;
}

before(async () => {
  if (!HAS_DB) return;
  orgId = await resolveDefaultOrg(db);

  staffId = (await db.query(
    `INSERT INTO staff (org_id, name, email, role, status)
     VALUES ($1, $2, $3, 'owner', 'active') RETURNING id`,
    [orgId, "Partner Licence Owner", `pl-owner-${STAMP}@example.test`]
  )).rows[0].id;

  clientId = (await db.query(
    `INSERT INTO clients (org_id, first_name, last_name, email)
     VALUES ($1, 'Partner', 'Principal', $2) RETURNING id`,
    [orgId, `pl-client-${STAMP}@example.test`]
  )).rows[0].id;

  // Active, and nobody has signed anything. This is the exact state 042's gate
  // exists for.
  partnerId = (await db.query(
    `INSERT INTO partners (org_id, name, slug, status) VALUES ($1, $2, $3, 'active')
     RETURNING id`,
    [orgId, `Licence Partner ${STAMP}`, `pl-a-${STAMP.toLowerCase()}`]
  )).rows[0].id;

  otherPartnerId = (await db.query(
    `INSERT INTO partners (org_id, name, slug, status) VALUES ($1, $2, $3, 'active')
     RETURNING id`,
    [orgId, `Licence Partner Two ${STAMP}`, `pl-b-${STAMP.toLowerCase()}`]
  )).rows[0].id;
});

after(async () => {
  if (!HAS_DB) return;
  try {
    if (payoutIds.length) {
      await db.query(`DELETE FROM partner_payouts WHERE id = ANY($1::uuid[])`, [payoutIds]);
    }
    if (contractIds.length) {
      // Contracts block DELETE by trigger (124). A fixture unwinds with the
      // guard off; nothing in src/ can do this, which is the point of it.
      await db.query(`ALTER TABLE contracts DISABLE TRIGGER trg_contracts_no_delete`);
      await db.query(`DELETE FROM contracts WHERE id = ANY($1::uuid[])`, [contractIds]);
      await db.query(`ALTER TABLE contracts ENABLE TRIGGER trg_contracts_no_delete`);
    }
    for (const id of [partnerId, otherPartnerId]) {
      if (id) await db.query(`DELETE FROM partners WHERE id = $1`, [id]);
    }
    if (clientId) await db.query(`DELETE FROM clients WHERE id = $1`, [clientId]);
    if (staffId) await db.query(`DELETE FROM staff WHERE id = $1`, [staffId]);
  } catch { /* a leftover fixture row must not red the suite */ }
  await close();
});

/* ═════════════════════════════════════════════════════════════════════════ */

describe("the document 042's gate holds out for", { skip: SKIP }, () => {
  test("migration 283 seeded the partner licence and 530 retired new sends", async () => {
    const tpl = await getPartnerLicenseTemplate(db, { orgId, activeOnly: false });
    assert.ok(
      tpl,
      "there is no PARTNER-LICENSE template in this database. Every partner payout is " +
      "held on partners.agreement_signed_at (042_partners.sql) and this is the document " +
      "that stamps it — without the row, a partner can be approved, produce, and never " +
      "be paid.");
    assert.equal(tpl.template_key, PARTNER_LICENSE_TEMPLATE_KEY);
    assert.equal(tpl.subtype, PARTNER_LICENSE_SUBTYPE);
    assert.equal(tpl.signature_required, true);
    assert.equal(tpl.source_kind, "text");
    assert.equal(tpl.active, false, "retired partner licences must stay unavailable for new sends");
    assert.equal(await getPartnerLicenseTemplate(db, { orgId }), null,
      "an archived partner licence must not be offered for a new send");
    assert.ok(tpl.body && tpl.body.length > 2000, "the seeded licence has no words in it");
  });

  test("the seeded words render with nothing left blank", async () => {
    const tpl = await getPartnerLicenseTemplate(db, { orgId, activeOnly: false });
    const rendered = renderContract(tpl.body, mergeContext({
      contact: { full_name: "A Person", email: "a@example.test" },
      values: { company_name: "Fundhub", partner_brand: "Their Brand" },
      at: new Date()
    }));
    assert.doesNotMatch(rendered, /\{\{/, "a merge tag survived rendering, so it prints raw");
    assert.match(rendered, /You keep 50%\. We keep 50%\./);
    assert.match(rendered, /Their Brand/);
  });
});

describe("before anybody signs", { skip: SKIP }, () => {
  test("the database itself refuses to pay an unsigned partner", async () => {
    const msg = await refusal(() => insertPayout(partnerId, "processing"));
    assert.ok(msg, "an unsigned partner was paid — 042's payout gate is not working");
    assert.match(msg, /has not signed an agreement/i);
  });

  test("and refuses 'paid' for the same reason", async () => {
    const msg = await refusal(() => insertPayout(partnerId, "paid"));
    assert.ok(msg, "an unsigned partner reached 'paid'");
    assert.match(msg, /has not signed an agreement/i);
  });

  test("but money may still be recorded — a held payout is not a blocked one", async () => {
    // 042: "revenue keeps accruing; it just does not release." A debt an
    // unsigned partner is owed must still be recordable or it disappears.
    const id = await insertPayout(partnerId, "pending");
    assert.ok(id);
  });

  test("stampPartnerAgreement will not open the gate on their behalf", async () => {
    await assert.rejects(
      () => stampPartnerAgreement(db, { orgId, partnerId }),
      (err) => {
        assert.equal(err.code, "partner_license_not_signed",
          "with the template seeded, the refusal has to name the missing SIGNATURE");
        return true;
      });

    const row = (await db.query(
      `SELECT agreement_signed_at FROM partners WHERE id = $1`, [partnerId])).rows[0];
    assert.equal(row.agreement_signed_at, null, "the refusal still wrote to the partner row");
  });

  test("a licence signed by somebody else does nothing for this partner", async () => {
    const tpl = await getPartnerLicenseTemplate(db, { orgId, activeOnly: false });
    await signLicenceFor(otherPartnerId, { signedAt: new Date("2026-08-01T10:00:00Z"), template: tpl });

    assert.equal(await findSignedPartnerLicense(db, { orgId, partnerId }), null,
      "another partner's signed licence resolved as this partner's");

    await assert.rejects(
      () => stampPartnerAgreement(db, { orgId, partnerId }),
      (err) => err.code === "partner_license_not_signed");

    const msg = await refusal(() => insertPayout(partnerId, "processing"));
    assert.ok(msg, "another partner's signature opened this partner's payout gate");
  });
});

describe("a signed licence, and only that, releases the money", { skip: SKIP }, () => {
  const SIGNED_AT = new Date("2026-08-20T15:04:05.000Z");

  test("the licence is found, and it is this partner's", async () => {
    const tpl = await getPartnerLicenseTemplate(db, { orgId, activeOnly: false });
    const contract = await signLicenceFor(partnerId, { signedAt: SIGNED_AT, template: tpl });

    const found = await findSignedPartnerLicense(db, { orgId, partnerId });
    assert.ok(found, "the signed licence did not resolve");
    assert.equal(found.id, contract.id);
    assert.equal(found.merge_values[PARTNER_ID_MERGE_KEY], partnerId);
    assert.equal(found.status, "signed");
  });

  test("the stamp is the moment on the document, not the moment of the run", async () => {
    const out = await stampPartnerAgreement(db, { orgId, partnerId });
    assert.equal(out.stamped, true);

    const row = (await db.query(
      `SELECT agreement_signed_at FROM partners WHERE id = $1`, [partnerId])).rows[0];
    assert.ok(row.agreement_signed_at, "nothing was stamped");
    assert.equal(
      new Date(row.agreement_signed_at).toISOString(), SIGNED_AT.toISOString(),
      "the partner became payable at a moment nobody signed anything");
  });

  test("the same payout the database refused now goes through", async () => {
    const msg = await refusal(() => insertPayout(partnerId, "processing"));
    assert.equal(
      msg, null,
      `042's gate still refuses a signed, active partner: ${msg}`);
  });

  test("running it again changes nothing", async () => {
    const before = (await db.query(
      `SELECT agreement_signed_at FROM partners WHERE id = $1`, [partnerId])).rows[0];
    const out = await stampPartnerAgreement(db, { orgId, partnerId });
    const after_ = (await db.query(
      `SELECT agreement_signed_at FROM partners WHERE id = $1`, [partnerId])).rows[0];

    assert.equal(out.stamped, false, "a second run re-stamped the partner");
    assert.equal(
      String(after_.agreement_signed_at), String(before.agreement_signed_at),
      "re-running onboarding moved the moment a partner became payable");
  });

  test("a paused partner is still refused, signature or not", async () => {
    // 042 gates on BOTH halves. Proving the signature alone is not enough is
    // what stops "they signed" being read as "they can be paid".
    await db.query(`UPDATE partners SET status = 'paused' WHERE id = $1`, [partnerId]);
    const msg = await refusal(() => insertPayout(partnerId, "processing"));
    assert.ok(msg, "a paused partner was paid");
    assert.match(msg, /not active/i);
    await db.query(`UPDATE partners SET status = 'active' WHERE id = $1`, [partnerId]);
  });
});
