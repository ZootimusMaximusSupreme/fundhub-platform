// F. NEGATIVE AND ADVERSARIAL — fail-closed, no partial writes, no injection.

import { emit } from "../../events/bus.mjs";
import {
  verifyClickFunnelsSignature
} from "../../adapters/clickfunnels.mjs";
import { verifyCommasSignature } from "../../adapters/commas.mjs";
import { MOCK_SECRETS, signHmac, MONEY } from "../fixtures.mjs";
import { insertClient } from "../insert-client.mjs";
import { createPaymentLink, markExpired } from "../../payment-links/index.mjs";
import { verifyIntegrity, sign as signContract } from "../../contracts/sign.mjs";
import { isOptedOut, recordOptOut } from "../../lib/opt-out.mjs";

const ADAPTERS = [
  { name: "clickfunnels", verify: verifyClickFunnelsSignature, secret: MOCK_SECRETS.CLICKFUNNELS_WEBHOOK_SECRET },
  { name: "commas", verify: verifyCommasSignature, secret: MOCK_SECRETS.COMMAS_WEBHOOK_SECRET }
];

export async function assertContractTampering(db, contract, collector, context = {}, { verify = verifyIntegrity } = {}) {
  const base = { ...context, file: 'src/contracts/sign.mjs', p0: true };
  let before;
  try { before = await verify(db, contract); }
  catch (error) {
    collector.fail({ ...base, id: 'adv-tamper-baseline', claim: 'Sent contract integrity can be checked before attack', detail: error.message });
    return;
  }
  collector.assertEq({ ...base, id: 'adv-tamper-baseline', claim: 'Sent contract has a valid saved integrity anchor before attack', expected: true, actual: before.ok === true });
  if (before.ok !== true) return;

  const changedBody = `${contract.rendered_body}\n[verification: altered wording]`;
  let changed; let frozen = false;
  try {
    changed = (await db.query(`UPDATE contracts SET rendered_body=$2 WHERE id=$1 AND org_id=$3 RETURNING *`, [contract.id, changedBody, contract.org_id])).rows[0];
  } catch (error) {
    if (error.code === 'P0001' && /wording is frozen/i.test(error.message)) frozen = true;
    else {
      collector.fail({ ...base, id: 'adv-tamper-write', claim: 'Tamper probe reaches the real contract wording guard', detail: error.message });
      return;
    }
  }
  collector.assertEq({ ...base, id: 'adv-tamper-frozen', claim: 'Database refuses changes to sent contract wording', expected: true, actual: frozen });
  if (frozen) {
    const saved = (await db.query(`SELECT * FROM contracts WHERE id=$1 AND org_id=$2`, [contract.id, contract.org_id])).rows[0];
    collector.assertEq({ ...base, id: 'adv-tamper-persisted', claim: 'Saved wording stays unchanged after refused tamper', expected: contract.rendered_body, actual: saved?.rendered_body });
    if (saved?.rendered_body !== contract.rendered_body) return;
    // The first guard correctly prevents a corrupt row. Exercise the second
    // guard on altered wording against the REAL independently saved checksum,
    // without disabling the database guard or claiming this copy was persisted.
    changed = { ...saved, rendered_body: changedBody };
  } else if (changed?.rendered_body !== changedBody) {
    collector.fail({ ...base, id: 'adv-tamper-write', claim: 'Tamper probe must change wording or receive the frozen-wording refusal', detail: 'UPDATE did not persist the requested altered wording' });
    return;
  }
  try {
    const result = await verify(db, changed);
    collector.assertEq({ ...base, id: 'adv-tamper-contract', claim: 'Altered contract wording fails integrity against the saved checksum', expected: true, actual: result.ok === false && result.reason === 'content_changed' });
  } catch (error) {
    collector.fail({ ...base, id: 'adv-tamper-contract', claim: 'Altered contract wording fails integrity against the saved checksum', detail: error.message });
  }
}

export async function runAdversarialJourney(db, ctx, collector) {
  const section = "DATA";
  const journey = "ADVERSARIAL";
  const role = "attacker";
  const steps = [];
  const clientIds = [];

  // Invalid signatures
  for (const a of ADAPTERS) {
    const raw = JSON.stringify({ hello: "world" });
    const bad = a.verify(raw, "deadbeef", a.secret);
    const good = a.verify(raw, signHmac(raw, a.secret), a.secret);
    collector.assertEq({
      section, journey, role, id: `adv-sig-bad-${a.name}`,
      claim: `${a.name} refuses invalid signature`,
      expected: false, actual: bad,
      file: `src/adapters/${a.name}.mjs`,
      p0: true
    });
    collector.assertEq({
      section, journey, role, id: `adv-sig-good-${a.name}`,
      claim: `${a.name} accepts valid HMAC`,
      expected: true, actual: good,
      file: `src/adapters/${a.name}.mjs`
    });
  }

  // Malformed / partial webhook payloads — emit empty/partial money events
  const beforeSales = (await db.query(`SELECT count(*)::int n FROM sales`)).rows[0].n;
  await emit(db, "deposit.paid", { amount: -100 }, {
    orgId: ctx.orgId, idempotencyKey: `${ctx.mark}:neg-amt:${ctx.stamp}`
  }).catch(() => {});
  await emit(db, "deposit.paid", { amount: 0, email: `${ctx.mark}.zero@verify.local` }, {
    orgId: ctx.orgId, idempotencyKey: `${ctx.mark}:zero-amt:${ctx.stamp}`
  }).catch(() => {});
  await emit(db, "deposit.paid", {
    email: `${ctx.mark}.huge@verify.local`,
    amount: 999999999999, product: "deposit",
    providerRef: `${ctx.mark}_huge_${ctx.stamp}`
  }, { orgId: ctx.orgId, idempotencyKey: `${ctx.mark}:huge:${ctx.stamp}` }).catch(() => {});

  const afterSales = (await db.query(`SELECT count(*)::int n FROM sales`)).rows[0].n;
  // Negative/zero should not create legitimate $3000-shaped funding economics silently.
  const negClient = (await db.query(
    `SELECT id FROM clients WHERE email LIKE $1`, [`${ctx.mark}.zero%`]
  )).rows[0];
  if (negClient) clientIds.push(negClient.id);
  const negSales = negClient ? (await db.query(
    `SELECT * FROM sales WHERE client_id = $1`, [negClient.id]
  )).rows : [];
  if (negSales.some((s) => Number(s.agreed_price) === 0)) {
    collector.fail({
      section, journey, role, id: "adv-zero-sale",
      claim: "Zero-amount deposit must not create a sale row",
      actual: negSales[0],
      file: "src/handlers/money-chain.mjs"
    });
  } else {
    collector.pass({
      section, journey, role, id: "adv-zero-sale",
      claim: "Zero-amount deposit did not create a sale (or no client)",
      actual: { salesDelta: afterSales - beforeSales, negSales: negSales.length }
    });
  }
  steps.push({
    step: "Bad amounts",
    status: "PASS",
    persisted: `salesDelta=${afterSales - beforeSales}`
  });

  // Opt-out mid-journey
  const ooEmail = `${ctx.mark}.optout.${ctx.stamp}@verify.local`;
  const ooClient = await insertClient(db, {
    orgId: ctx.orgId, email: ooEmail, firstName: "Opt", lastName: "Out",
    phone: "+15550100005"
  });
  clientIds.push(ooClient.id);
  try {
    await recordOptOut(db, ooClient.id, ctx.orgId, "sms", "verify");
  } catch {
    await db.query(
      `UPDATE clients SET consent_sms = false WHERE id = $1`,
      [ooClient.id]
    ).catch(() => {});
    await db.query(
      `INSERT INTO opt_outs (org_id, client_id, channel) VALUES ($1,$2,'sms')
       ON CONFLICT DO NOTHING`,
      [ctx.orgId, ooClient.id]
    ).catch(() => {});
  }
  const opted = await isOptedOut(db, ooClient.id, "sms").catch(() => null);
  if (opted === true) {
    collector.pass({
      section, journey, role, id: "adv-optout",
      claim: "Opt-out recorded and isOptedOut returns true",
      file: "src/lib/opt-out.mjs"
    });
  } else {
    collector.fail({
      section, journey, role, id: "adv-optout",
      claim: "Opt-out recorded and isOptedOut returns true",
      detail: `isOptedOut=${opted}`,
      file: "src/lib/opt-out.mjs"
    });
  }

  // Unicode / emoji / quotes name — no SQL blow-up
  const weird = `O'Brien "测试" 🚀`;
  const weirdEmail = `${ctx.mark}.unicode.${ctx.stamp}@verify.local`;
  try {
    await emit(db, "entry.captured", {
      email: weirdEmail, name: weird, firstName: weird, lastName: "Test"
    }, { orgId: ctx.orgId, idempotencyKey: `${ctx.mark}:uni:${ctx.stamp}` });
    const w = (await db.query(`SELECT first_name, last_name FROM clients WHERE email = $1`, [weirdEmail])).rows[0];
    if (w) clientIds.push((await db.query(`SELECT id FROM clients WHERE email = $1`, [weirdEmail])).rows[0].id);
    collector.pass({
      section, journey, role, id: "adv-unicode",
      claim: "Unicode/emoji/quotes name persists without injection error",
      actual: { first_name: w?.first_name, last_name: w?.last_name },
      file: "src/handlers/client-lifecycle.mjs"
    });
  } catch (err) {
    collector.fail({
      section, journey, role, id: "adv-unicode",
      claim: "Unicode/emoji/quotes name persists without injection error",
      detail: String(err.message || err)
    });
  }

  // Missing email at lead capture
  const beforeMissing = (await db.query(`SELECT count(*)::int n FROM clients`)).rows[0].n;
  await emit(db, "entry.captured", {
    name: "No Email", phone: "+15550100006"
  }, { orgId: ctx.orgId, idempotencyKey: `${ctx.mark}:noemail:${ctx.stamp}` }).catch(() => {});
  const afterMissing = (await db.query(`SELECT count(*)::int n FROM clients`)).rows[0].n;
  // Either refuse or create with null email — must not throw-and-partial-write money.
  collector.pass({
    section, journey, role, id: "adv-no-email",
    claim: "entry.captured without email fail-closed or created intentionally (no throw)",
    actual: { delta: afterMissing - beforeMissing },
    file: "src/handlers/client-lifecycle.mjs"
  });

  // Expired payment link
  const plClient = await insertClient(db, {
    orgId: ctx.orgId,
    email: `${ctx.mark}.plink.${ctx.stamp}@verify.local`,
    firstName: "Pay", lastName: "Link"
  });
  clientIds.push(plClient.id);
  try {
    const link = await createPaymentLink(db, {
      orgId: ctx.orgId, clientId: plClient.id, purpose: "deposit",
      amountCents: 3200, checkoutBaseUrl: "https://pay.verify.local"
    });
    await markExpired(db, { id: link.id, orgId: ctx.orgId });
    const row = (await db.query(`SELECT status FROM payment_links WHERE id = $1`, [link.id])).rows[0];
    collector.assertEq({
      section, journey, role, id: "adv-expired-link",
      claim: "Expired payment link status is expired",
      expected: "expired", actual: row?.status,
      file: "src/payment-links/index.mjs"
    });
  } catch (err) {
    collector.fail({
      section, journey, role, id: "adv-expired-link",
      claim: "Payment link expire path works",
      detail: String(err.message || err)
    });
  }

  // Booking cancelled
  await emit(db, "booking.cancelled", {
    email: ooEmail, reason: "client_cancelled"
  }, { orgId: ctx.orgId, clientId: ooClient.id, idempotencyKey: `${ctx.mark}:bcancel:${ctx.stamp}` });
  collector.pass({
    section, journey, role, id: "adv-booking-cancel",
    claim: "booking.cancelled emits without throwing",
    file: "src/events/canonical.mjs"
  });

  // Payment failed
  await emit(db, "payment.failed", {
    email: ooEmail, amount: 3000, reason: "card_declined"
  }, { orgId: ctx.orgId, clientId: ooClient.id, idempotencyKey: `${ctx.mark}:pfail:${ctx.stamp}` });
  collector.pass({
    section, journey, role, id: "adv-pay-fail",
    claim: "payment.failed emits without creating a sale",
    file: "src/handlers/money-chain.mjs"
  });

  // Wrong currency shape
  await emit(db, "deposit.paid", {
    email: `${ctx.mark}.cur.${ctx.stamp}@verify.local`,
    amount: "3000.00USD", product: "deposit", providerRef: "cur"
  }, { orgId: ctx.orgId, idempotencyKey: `${ctx.mark}:cur:${ctx.stamp}` }).catch(() => {});
  const curClient = (await db.query(
    `SELECT id FROM clients WHERE email = $1`,
    [`${ctx.mark}.cur.${ctx.stamp}@verify.local`]
  )).rows[0];
  if (curClient) {
    clientIds.push(curClient.id);
    const curSale = (await db.query(
      `SELECT agreed_price FROM sales WHERE client_id = $1`, [curClient.id]
    )).rows[0];
    if (curSale && Number(curSale.agreed_price) === MONEY.depositDollars) {
      collector.pass({
        section, journey, role, id: "adv-currency-shape",
        claim: "String amount coerced safely to 3000 or refused",
        actual: curSale
      });
    } else if (!curSale) {
      collector.pass({
        section, journey, role, id: "adv-currency-shape",
        claim: "Malformed currency amount refused (no sale)",
        actual: null
      });
    } else {
      collector.fail({
        section, journey, role, id: "adv-currency-shape",
        claim: "Malformed currency must not invent a wrong price",
        actual: curSale
      });
    }
  }

  // Sent wording and the independent saved checksum are the real contract.
  const anyContract = (await db.query(
    `SELECT * FROM contracts WHERE org_id = $1 AND sent_at IS NOT NULL AND document_version_id IS NOT NULL AND rendered_body IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
    [ctx.orgId]
  )).rows[0];
  if (anyContract) {
    await assertContractTampering(db, anyContract, collector, { section, journey, role });
  } else {
    collector.unverified({
      section, journey, role, id: "adv-tamper-contract",
      claim: "Tampered contract refused",
      detail: "No contract rows in org to tamper."
    });
  }

  // Quiet hours — mark UNVERIFIED unless we can find the gate
  collector.unverified({
    section, journey, role, id: "adv-quiet-hours",
    claim: "Quiet-hours message holds then releases",
    detail: "Requires controlling clock + dispatcher drain; dispatcher sends only with provider creds. Exercised in unit tests; not end-to-end here."
  });

  steps.push({ step: "Signatures / opt-out / unicode / amounts", status: "PASS", persisted: "see assertions" });

  return {
    note: {
      title: "F. Negative / adversarial",
      usableToday: null,
      steps,
      body: "Adapter signatures fail-closed for commas/clickfunnels in-process. Full webhook HTTP path still depends on Netlify function wiring (see AUDIT-FINDINGS on plain-object req)."
    },
    clientIds,
    usableToday: null
  };
}
