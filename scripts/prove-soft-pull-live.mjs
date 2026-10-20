#!/usr/bin/env node
/** One-shot: $32 pay link + soft-pull approve URL + email + CRS pull for Chris prove client. */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { liveSendRequested, runOneOffSend } from "../src/ops/one-off-send-receipt.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const CLIENT_ID = "9af65808-a619-4e65-ae91-239766a006b7";
const BASE = "https://fundhub.ai";
const CHECKOUT_BASE = "https://www.fanbasis.com/public-api";
const PRODUCT_TITLE = "Business Financial Assessment — Fundhub";
const DO_SEND = liveSendRequested();

function loadEnv() {
  const p = path.join(ROOT, ".env");
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const i = line.indexOf("=");
      const k = line.slice(0, i).trim();
      let v = line.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (process.env[k] == null) process.env[k] = v;
    }
  }
  for (const k of ["DATABASE_URL", "COMMAS_API_KEY", "CRS_API_PASSWORD", "CRS_API_USERNAME", "CRS_API_HOST",
    "CRS_ALLOW_LIVE", "ADAPTERS_DRY_RUN", "PII_ENC_KEY", "DOCUMENT_URL_SECRET", "RESEND_API_KEY", "RESEND_FROM"]) {
    if (process.env[k]) continue;
    try {
      process.env[k] = execSync(`netlify env:get ${k} --context production`, {
        encoding: "utf8", stdio: ["pipe", "pipe", "ignore"]
      }).trim();
    } catch { /* local only */ }
  }
  process.env.ADAPTERS_DRY_RUN = "0";
}

async function createCheckout(apiKey, linkRef) {
  const res = await fetch(`${CHECKOUT_BASE}/checkout-sessions`, {
    method: "POST",
    headers: { "x-api-key": apiKey, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      amount_cents: 3200,
      product: { title: PRODUCT_TITLE, description: "UnderwriteIQ soft-pull assessment" },
      type: "onetime_non_reusable",
      metadata: { link_ref: linkRef, client_id: CLIENT_ID, org_id: ORG }
    })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`checkout ${res.status}: ${json.message || res.statusText}`);
  const url = json.data?.payment_link;
  if (!url) throw new Error("Commas returned no payment_link");
  return { url, sessionId: json.data?.checkout_session_id };
}

async function main() {
  if (!DO_SEND) {
    console.log("NOTHING WAS SENT — add --send to create the checkout, email the client, and run the live proof.");
    return;
  }
  loadEnv();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing");
  if (!process.env.COMMAS_API_KEY) throw new Error("COMMAS_API_KEY missing");

  const { db, pool } = await import("../src/db.mjs");
  const { generateLinkRef, markSent } = await import("../src/payment-links/index.mjs");
  const { signSoftPullApproveUrl } = await import("../src/consent/approve-token.mjs");
  const { send: sendEmail } = await import("../src/messaging/providers/resend.mjs");
  const { requestSoftPull } = await import("../src/finance/soft-pulls.mjs");
  const { runCrsPull, CRS_PROVIDER, DIAGNOSTIC_PULL_REASON } = await import("../src/finance/crs-pull.mjs");
  const { clientAccountId } = await import("../src/workflows/c-00-crs-soft-pull-request.mjs");

  const client = (await db.query(
    `SELECT id, email, first_name FROM clients WHERE id = $1 AND org_id = $2`, [CLIENT_ID, ORG]
  )).rows[0];
  if (!client) throw new Error("Chris prove client not found");

  const staff = (await db.query(
    `SELECT id FROM staff WHERE org_id = $1 ORDER BY created_at LIMIT 1`, [ORG]
  )).rows[0];

  const linkRef = generateLinkRef();
  const checkout = await createCheckout(process.env.COMMAS_API_KEY, linkRef);

  const link = (await db.query(
    `INSERT INTO payment_links
       (org_id, client_id, purpose, description, amount_cents, currency, link_ref, checkout_url, created_by_staff_id, status, sent_at)
     VALUES ($1,$2,'diagnostic',$3,3200,'USD',$4,$5,$6,'sent',now())
     RETURNING *`,
    [ORG, CLIENT_ID, PRODUCT_TITLE, linkRef, checkout.url, staff?.id || null]
  )).rows[0];

  const approve = signSoftPullApproveUrl({
    orgId: ORG, clientId: CLIENT_ID, baseUrl: BASE,
    secret: process.env.DOCUMENT_URL_SECRET
  });

  const first = client.first_name || "Chris";
  const body =
    `Hi ${first},\n\n` +
    `Your $32 soft-pull assessment:\n\n` +
    `1) Pay here:\n${checkout.url}\n\n` +
    `2) Approve the soft pull and enter your details:\n${approve.url}\n\n` +
    `— Fundhub`;

  const sentEmail = await runOneOffSend({
    db,
    orgId: ORG,
    clientId: CLIENT_ID,
    scriptId: "prove-soft-pull-live",
    channel: "email",
    runId: `payment-link-${link.id}`,
    send: () => sendEmail({
      to: client.email,
      subject: "Your $32 soft-pull assessment",
      body,
      providerRef: `prove-soft-pull:${link.id}`
    }, { env: process.env }),
    summarize: (mail) => ({
      attempted: 1,
      sent: mail.status === "sent" ? 1 : 0,
      failed: mail.status === "sent" ? 0 : 1,
      providerRef: mail.providerMessageId,
      error: mail.error,
    }),
  });
  const mail = sentEmail.outcome;
  const emailSent = mail.status === "sent";

  const consent = (await db.query(
    `SELECT cc.revoked_at IS NULL AS valid FROM client_consents cc
      WHERE cc.client_id = $1 AND cc.kind = 'soft_pull_consent'
      ORDER BY cc.created_at DESC LIMIT 1`, [CLIENT_ID]
  )).rows[0];

  let pull = { skipped: true, reason: "no_consent" };
  if (consent?.valid) {
    const accountId = await clientAccountId(db, CLIENT_ID);
    if (accountId) {
      const requested = await requestSoftPull(db, {
        orgId: ORG,
        clientId: CLIENT_ID,
        requestedBy: { kind: "staff", id: staff?.id || accountId },
        reason: DIAGNOSTIC_PULL_REASON,
        costCents: null,
        provider: CRS_PROVIDER,
        idempotencyKey: `prove-soft-pull:${link.id}`
      });
      if (requested.created && requested.request?.id) {
        pull = await runCrsPull(db, {
          orgId: ORG,
          clientId: CLIENT_ID,
          requestId: requested.request.id,
          env: process.env
        });
      } else {
        pull = { skipped: true, reason: requested.reason || "not_created", requestId: requested.request?.id };
      }
    } else {
      pull = { skipped: true, reason: "no_client_account" };
    }
  }

  const out = {
    ok: true,
    client_email: client.email,
    pay_url: checkout.url,
    approve_url: approve.url,
    link_id: link.id,
    email_sent: emailSent,
    email_detail: emailSent ? "sent" : (mail.error || "failed"),
    email_receipt_id: sentEmail.receipt.id,
    consent_valid: !!consent?.valid,
    crs_host: process.env.CRS_API_HOST,
    pull_ok: pull.ok === true,
    pull_skipped: !!pull.skipped,
    pull_reason: pull.reason || pull.code || null,
    bureaus_pulled: pull.bureausPulled || [],
    crs_result_id: pull.crsResultId || null
  };

  console.log(JSON.stringify(out, null, 2));
  await pool.end();
  process.exit(out.email_sent ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
