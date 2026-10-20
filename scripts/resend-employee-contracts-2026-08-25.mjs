#!/usr/bin/env node
/**
 * COMPLIANCE REVIEW REQUIRED — void prior unsigned employee sends, prove a live
 * signing link, then resend Closer (Justice) + SM (Sarah) with 10-year links.
 *
 * Usage: node scripts/resend-employee-contracts-2026-08-25.mjs [--send]
 * Without --send: test sample only (mock closer → prove inbox).
 */
import { loadEnv } from "./load-env.mjs";
loadEnv();

import { db, close } from "../src/db.mjs";
import { liveSendRequested, runOneOffSend } from "../src/ops/one-off-send-receipt.mjs";
import { createStore, memoryProvider } from "../src/documents/store.mjs";
import {
  createDraft, send, voidContract, getTemplateByKey, getContract
} from "../src/contracts/index.mjs";
import { EMPLOYMENT_LINK_TTL_SECONDS } from "../src/contracts/signed-link.mjs";

const BASE_URL = (process.env.PUBLIC_BASE_URL || "https://fundhub.ai").replace(/\/$/, "");
const DO_SEND = liveSendRequested();
const DOC_STORE = createStore({ provider: memoryProvider() });

const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const OWNER_STAFF = "52bc675a-db0f-4e24-9b53-80f7fd077f72";

const HIRES = [
  {
    key: "justice",
    templateKey: "EMPLOYEE-CLOSER-AGREEMENT",
    staffId: "968bb01e-0079-4508-aded-8a361d54ecbb",
    clientId: "d2e4d98f-50d7-48fe-a16f-bcd0c89459c7",
    title: "Closer Agreement — Justice Nikkel",
    signer: { name: "Justice Nikkel", email: "justice.nikkel@gmail.com", role_label: "Employee", client_id: "d2e4d98f-50d7-48fe-a16f-bcd0c89459c7" },
    voidIds: ["e29f0a6b-16f5-4554-8476-4da38ea0e267"],
    values: {
      company_name: "Fundhub LLC",
      company_address: "218 Bostick Rd 64, Bowling Green, FL 33834",
      start_date: "2026-08-24",
      comp_terms:
        "Per Company closer pay plan on file with ownership. Starter agreement — ownership will confirm final numbers in writing."
    }
  },
  {
    key: "sarah",
    templateKey: "EMPLOYEE-SALES-MANAGER-AGREEMENT",
    staffId: "6ccdca88-60af-4b7e-af15-28259ead4786",
    clientId: "c6b3f0f0-3089-40f5-b69d-376253f34ffd",
    title: "Sales Manager Agreement — Sarah Blankstein",
    signer: { name: "Sarah Blankstein", email: "sarahblankstein247@gmail.com", role_label: "Employee", client_id: "c6b3f0f0-3089-40f5-b69d-376253f34ffd" },
    voidIds: ["73b280c2-e7ac-4816-ba84-c14f17324012"],
    values: {
      company_name: "Fundhub LLC",
      company_address: "218 Bostick Rd 64, Bowling Green, FL 33834",
      start_date: "2026-07-08",
      comp_terms:
        "Deposit commission: 5% of funded deposit. Backend: 0.25% of funded amount. Downsell: 5%. Residuals / recurring compensation only while engaged under the then-current Company plan. On resignation, termination, or any other departure, all recurring, residual, trailing, and potential recurring revenue is forfeited immediately — no ongoing residuals after separation."
    }
  }
];

const MOCK = {
  templateKey: "EMPLOYEE-CLOSER-AGREEMENT",
  staffId: "d9860cd2-d802-4de4-8899-0f88d80b8ae3",
  clientId: null,
  title: "PROVE Closer Agreement — link test only (void after)",
  signer: {
    name: "Mock CloserSign",
    email: "stanbridgejchris+mock-closer-sign@gmail.com",
    role_label: "Employee"
  },
  values: {
    company_name: "Fundhub LLC",
    company_address: "218 Bostick Rd 64, Bowling Green, FL 33834",
    start_date: "2026-08-25",
    comp_terms: "Prove send only — not a hire agreement."
  }
};

async function proveLink(url, label) {
  const u = new URL(url, BASE_URL);
  const api = `${BASE_URL}/api/contracts/sign${u.search}`;
  const res = await fetch(api, { method: "GET", headers: { accept: "application/json" } });
  const body = await res.json().catch(() => ({}));
  const row = {
    label,
    http: res.status,
    ok: res.ok && body.ok === true,
    signable: body.contract?.signable ?? null,
    title: body.contract?.title ?? null,
    error: body.error || null
  };
  if (!row.ok) throw new Error(`${label} link failed: HTTP ${res.status} ${body.error || ""}`);
  return row;
}

async function voidIfSent(id, reason) {
  const c = await getContract(db, { orgId: ORG, id });
  if (!c) return { id, skipped: "missing" };
  if (c.status === "void") return { id, skipped: "already_void" };
  if (c.status === "signed") return { id, skipped: "signed_cannot_void" };
  if (c.status === "draft") return { id, skipped: "draft" };
  const row = await voidContract(db, {
    orgId: ORG, staffId: OWNER_STAFF, id, reason
  });
  return { id, status: row.status, voided_at: row.voided_at };
}

async function mintAndSend({ templateKey, staffId, clientId, title, signer, values }) {
  const template = await getTemplateByKey(db, { orgId: ORG, templateKey });
  if (!template) throw new Error(`template missing: ${templateKey}`);
  const draft = await createDraft(db, {
    orgId: ORG,
    staffId: OWNER_STAFF,
    clientId,
    templateId: template.id,
    values,
    title,
    subjectStaffId: staffId,
    signers: [signer]
  });
  const out = await send(db, {
    orgId: ORG,
    staffId: OWNER_STAFF,
    id: draft.id,
    baseUrl: BASE_URL,
    ttlSeconds: EMPLOYMENT_LINK_TTL_SECONDS,
    store: DOC_STORE
  });
  const signUrl = out.links?.[0]?.url || out.link?.url;
  const expires = out.links?.[0]?.expires_at || out.link?.expiresAtIso;
  return {
    contract_id: out.contract.id,
    status: out.contract.status,
    link_expires_at: out.contract.link_expires_at,
    sign_url: signUrl,
    expires_at: expires,
    notified: out.notified
  };
}

async function mintAndSendWithReceipt(input) {
  const sent = await runOneOffSend({
    db,
    orgId: ORG,
    clientId: input.clientId || null,
    scriptId: "resend-employee-contracts-2026-08-25",
    channel: "email",
    send: () => mintAndSend(input),
    summarize: (out) => {
      const delivery = out.notified?.delivery || {};
      const attempted = Array.isArray(delivery.outcomes)
        ? delivery.outcomes.length
        : Number(delivery.sent || 0) + Number(delivery.failed || 0) + Number(delivery.blocked || 0);
      return {
        attempted: attempted || 1,
        sent: Number(delivery.sent || 0),
        failed: Number(delivery.failed || 0) + (delivery.paused ? 1 : 0),
        blocked: Number(delivery.blocked || 0),
        providerRef: out.contract_id,
        error: delivery.paused ? "outbound mail is paused" : null,
      };
    },
  });
  return { ...sent.outcome, receipt_id: sent.receipt.id, receipt_status: sent.receipt.status };
}

async function main() {
  const report = { phase: [], hires: [], test: null };

  if (!DO_SEND) {
    console.log(JSON.stringify({
      ok: true,
      mode: "dry_run",
      message: "NOTHING WAS SENT — add --send to run the sample proof and employee resends.",
      planned_hires: HIRES.map((hire) => hire.key),
    }, null, 2));
    await close();
    return;
  }

  // Resolve mock client id
  const mockClientByEmail = (
    await db.query(
      `SELECT id FROM clients WHERE org_id = $1::uuid AND lower(email) = lower($2) LIMIT 1`,
      [ORG, MOCK.signer.email]
    )
  ).rows[0];
  MOCK.clientId = mockClientByEmail?.id;
  if (!MOCK.clientId) {
    const ins = await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1, 'Mock', 'CloserSign', $2)
       RETURNING id`,
      [ORG, MOCK.signer.email]
    );
    MOCK.clientId = ins.rows[0].id;
  }

  report.phase.push("sample_send");
  const sample = await mintAndSendWithReceipt(MOCK);
  report.test = { ...sample, prove: await proveLink(sample.sign_url, "sample") };

  // Void the sample so it does not linger as a hire doc
  await voidContract(db, {
    orgId: ORG,
    staffId: OWNER_STAFF,
    id: sample.contract_id,
    reason: "Prove link test only — superseded before real hire sends"
  });
  report.test.voided = true;

  for (const hire of HIRES) {
    report.phase.push(`void_${hire.key}`);
    const voided = [];
    for (const id of hire.voidIds) {
      voided.push(await voidIfSent(id, `Owner resend ${hire.key} — prior link cancelled`));
    }

    report.phase.push(`send_${hire.key}`);
    const sent = await mintAndSendWithReceipt(hire);
    const prove = await proveLink(sent.sign_url, hire.key);
    report.hires.push({ key: hire.key, voided, sent, prove });
  }

  console.log(JSON.stringify({ ok: true, mode: "sent", report }, null, 2));
  await close();
}

main().catch(async (e) => {
  console.error(e);
  try { await close(); } catch { /* ignore */ }
  process.exit(1);
});
