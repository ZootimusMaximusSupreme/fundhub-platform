#!/usr/bin/env node
// Capital Blueprint — a 20-second, 4K, SIMULATED timelapse of six months on the
// real shipped screens.
//
//   node scripts/demo/blueprint-timelapse.mjs            build the video
//   node scripts/demo/blueprint-timelapse.mjs --dry      print the simulated beats only
//   --frames-only  capture frames, skip ffmpeg · --fresh  ignore the simulation cache · --crf N
//
// WHAT IS REAL AND WHAT IS SIMULATED.
//   Real: every screen (public/app/client-portal.html, public/progress.html,
//   public/app/closer-dashboard.html, served as files from public/), and every
//   number and sentence those screens show is produced by the shipped server
//   code run in this process: the one sample person's credit file
//   (src/finance/sample-credit-file.mjs, the same Visa as the portal sample
//   bundle src/demo/client-portal-sample-bundle.json), the UnderwriteIQ engine
//   (withEngineResult), the Blueprint purchase hook (seedChecklistForPurchase),
//   the checklist verifier (evaluateWaypoints), the client tick
//   (setClientTick), the progress read (readClientProgress), the letter pack
//   (buildLetterPack) and the shared client file (fetchContext). They run
//   against an in-memory stand-in for the database (SimDb below), never a real
//   one.
//   Simulated, and labelled on every frame: the passage of time, the client's
//   card balance going down each month, the client's clicks and uploads, the
//   client's replies and the coach call's words. The bureau scores are inputs
//   on the sample file, so they stay as the file states them; nothing here
//   predicts a score change.
//
// SAFETY. No DATABASE_URL is read. No network: the browser's /api/** calls are
// answered by page.route() from SimDb, and every request that is not the local
// static server is aborted. No message, call, credit pull or provider call is
// made; the model call the coach would make is not made (its intent is chosen
// below and the server-owned sentence for that intent is used).
//
// OUTPUT (4K law, .claude/rules/video-4k-unless-ad.md): frames are rendered at
// 1920x1080 CSS pixels with deviceScaleFactor 2, so every frame is a native
// 3840x2160 render, then joined with ffmpeg into a 30 fps H.264 MP4.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const imp = (rel) => import(path.join(ROOT, rel));
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));

const ARGS = process.argv.slice(2);
const DRY = ARGS.includes("--dry");
const STILLS_ONLY = ARGS.includes("--frames-only");
const argValue = (name, fallback) => {
  const i = ARGS.indexOf(name);
  return i >= 0 && ARGS[i + 1] ? ARGS[i + 1] : fallback;
};

const OUT_DIR = path.resolve(ROOT, argValue("--out", "ops/workflows/build-evidence/blueprint-timelapse-2026-10-21"));
const VIDEO = path.join(OUT_DIR, "blueprint-6-month-timelapse.mp4");
const FPS = 30;
const SECONDS = 20;
const TOTAL_FRAMES = FPS * SECONDS;
const FFMPEG = process.env.FFMPEG || (fs.existsSync("/Users/chrisstanbridge/.local/bin/ffmpeg") ? "/Users/chrisstanbridge/.local/bin/ffmpeg" : "ffmpeg");

/* ── the shipped code this simulation runs ─────────────────────────────── */
const { buildSampleCreditFile, withEngineResult } = await imp("src/finance/sample-credit-file.mjs");
const { runTierEngineFromCrsResult } = await imp("src/finance/crs-tier.mjs");
const { seedChecklistForPurchase } = await imp("src/waypoints/purchase.mjs");
const { seedClientWaypoints } = await imp("src/waypoints/seed.mjs");
const { evaluateWaypoints } = await imp("src/waypoints/verify.mjs");
const { setClientTick, closedBy } = await imp("src/waypoints/self-attest.mjs");
const { isOverdue } = await imp("src/waypoints/store.mjs");
const { readClientProgress } = await imp("src/progress/read.mjs");
const { fetchContext, formatPromptBlock } = await imp("src/agents/context.mjs");
const { blueprintCoachQuestion } = await imp("src/blueprint/coach-prompt.mjs");
const { buildLetterPack } = await imp("src/underwrite/letter-pack.mjs");
const { FUNDING_ANALYSIS_SUBTYPE, FUNDING_LETTER_SUBTYPE } = await imp("src/underwrite/funding-letter-pdf.mjs");
const { titleFor } = await imp("src/documents/kinds.mjs");
const { offersForClient } = await imp("src/config/offers.mjs");
const { creditOverview } = await imp("src/finance/credit-overview.mjs");
const { buildCockpit } = await imp("src/sales/cockpit.mjs");

const BUNDLE = readJson("src/demo/client-portal-sample-bundle.json");
const DEFINITIONS = readJson("scripts/demo/fixtures/blueprint-waypoint-definitions.json").definitions;
const SIM = readJson("scripts/demo/fixtures/blueprint-timelapse-story.json");

const ORG_ID = "0b1e0000-0000-4000-8000-0000000000aa";
const CLIENT_ID = "0b1e0000-0000-4000-8000-0000000000c1";
const PERSON = SIM.person;
const PERSONAL = {
  name: `${PERSON.first} ${PERSON.last}`,
  address: `${PERSON.home.line1}\n${PERSON.home.city}, ${PERSON.home.state} ${PERSON.home.zip}`,
  city: PERSON.home.city, state: PERSON.home.state, zip: PERSON.home.zip
};
const VISA = BUNDLE.facts.accounts.find((a) => a.name === "Personal Visa");
if (!VISA) throw new Error("the sample bundle has no Personal Visa");
if (VISA.currentCents !== SIM.pulls[0].visa_balance_cents) {
  throw new Error(`story Day 0 balance ${SIM.pulls[0].visa_balance_cents} does not match the sample bundle's Visa ${VISA.currentCents}`);
}

const uuidFrom = (s) => {
  const h = crypto.createHash("sha1").update(String(s)).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const at = (iso) => new Date(iso);
const cents = (n) => `$${(n / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/* ═══════════════════════════════════════════════════════════════════════
   SimDb — an in-memory stand-in for the handful of tables the shipped
   functions above read and write. Each query is matched by its SQL; anything
   not modelled answers no rows, which every caller already treats as "none".
   ═════════════════════════════════════════════════════════════════════ */
class SimDb {
  constructor() {
    this.waypoints = new Map();   // key -> row
    this.crs = [];                // { id, created_at, result }
    this.documents = [];          // { id, kind, subtype, title, generated_at, created_at }
    this.events = [];             // { name, ts }
    this.messages = [];           // messages rows
    this.calls = [];              // call_outcomes rows
    this.tasks = [];
    this.client = {
      id: CLIENT_ID, org_id: ORG_ID, first_name: PERSON.first, last_name: PERSON.last,
      email: null, phone: null, funded: false, funded_amount: null, tags: [], outcome_tier: null,
      dnd_sms: false, dnd_email: false, dnd_voice: false, custom_fields: {}
    };
    this.payment = null;
    this.contract = null;
    this.entitled = false;
  }

  wpRows() {
    return [...this.waypoints.values()].sort((a, b) => (a.position - b.position) || a.key.localeCompare(b.key));
  }

  async query(sql, params = []) {
    const s = String(sql).replace(/\s+/g, " ").trim();
    const rows = (r) => ({ rows: r, rowCount: r.length });

    if (/FROM waypoint_definitions/.test(s)) return rows(DEFINITIONS.filter((d) => d.active));

    if (/^INSERT INTO client_waypoints/.test(s)) {
      const [org, client, key, title, detail, position, ownerKind, state, dueAt, completedAt,
        paidCents, paidLabel, paidKind, verifyKind, paramsJson] = params;
      const old = this.waypoints.get(key);
      const row = old ? {
        ...old, title, detail, position, owner_kind: ownerKind, due_at: dueAt,
        paid_alternative_price_cents: paidCents, paid_alternative_label: paidLabel, paid_alternative_kind: paidKind,
        verify_kind: verifyKind, params: paramsJson == null ? null : JSON.parse(paramsJson)
      } : {
        id: uuidFrom(`waypoint:${key}`), org_id: org, client_id: client, key, title, detail, position,
        owner_kind: ownerKind, state, state_reason: null, due_at: dueAt, completed_at: completedAt,
        paid_alternative_price_cents: paidCents, paid_alternative_label: paidLabel, paid_alternative_kind: paidKind,
        verify_kind: verifyKind, params: paramsJson == null ? null : JSON.parse(paramsJson)
      };
      this.waypoints.set(key, row);
      return rows([{ ...row }]);
    }
    if (/^UPDATE client_waypoints SET state = 'done'/.test(s)) {
      const row = this.waypoints.get(params[2]);
      if (!row) return rows([]);
      row.state = "done";
      row.completed_at = params[3] ? new Date(params[3]) : new Date();
      return rows([{ ...row }]);
    }
    if (/^UPDATE client_waypoints SET state = \$4, state_reason = \$5, completed_at = NULL/.test(s)) {
      const row = this.waypoints.get(params[2]);
      if (!row) return rows([]);
      row.state = params[3];
      row.state_reason = params[4];
      row.completed_at = null;
      return rows([{ ...row }]);
    }
    if (/^SELECT key, due_at, verify_kind, params, state FROM client_waypoints/.test(s)) {
      return rows(this.wpRows().map((r) => ({ key: r.key, due_at: r.due_at, verify_kind: r.verify_kind, params: r.params, state: r.state })));
    }
    if (/^SELECT \* FROM client_waypoints WHERE id = \$1/.test(s)) {
      return rows(this.wpRows().filter((r) => r.id === params[0]).map((r) => ({ ...r })));
    }
    if (/^SELECT \* FROM client_waypoints .*verify_kind IS NOT NULL/.test(s)) {
      return rows(this.wpRows().filter((r) => r.verify_kind && !["done", "skipped"].includes(r.state)).map((r) => ({ ...r })));
    }
    if (/^SELECT \* FROM client_waypoints/.test(s)) return rows(this.wpRows().map((r) => ({ ...r })));

    if (/FROM crs_results/.test(s)) {
      const sorted = [...this.crs].sort((a, b) => b.created_at - a.created_at);
      return rows(/LIMIT 1\b/.test(s) ? sorted.slice(0, 1) : sorted);
    }
    if (/^SELECT kind, subtype FROM documents/.test(s)) return rows(this.documents.map((d) => ({ kind: d.kind, subtype: d.subtype })));
    if (/FROM documents .*kind = 'deliverable'/.test(s)) {
      return rows(this.documents.filter((d) => d.kind === "deliverable")
        .sort((a, b) => b.generated_at - a.generated_at)
        .map((d) => ({ id: d.id, subtype: d.subtype, title: d.title, generated_at: d.generated_at })));
    }
    if (/FROM documents .*dispute_mail_receipt/.test(s)) {
      return rows(this.documents.filter((d) => (d.kind === "client_upload" && d.subtype === "dispute_mail_receipt") || d.kind === "bureau_response")
        .sort((a, b) => b.created_at - a.created_at)
        .map((d) => ({ id: d.id, title: d.title, kind: d.kind, subtype: d.subtype, created_at: d.created_at.toISOString() })));
    }
    if (/FROM events/.test(s)) {
      const names = new Set(params[2] || []);
      return rows(this.events.filter((e) => names.has(e.name)).sort((a, b) => b.ts - a.ts).map((e) => ({ ts: e.ts, name: e.name })));
    }
    if (/FROM clients WHERE id = \$1 AND org_id = \$2/.test(s) && /first_name, last_name, email/.test(s)) return rows([{ ...this.client }]);
    if (/SELECT first_name, last_name, custom_fields FROM clients/.test(s)) return rows([{ ...this.client }]);
    if (/FROM clients c LEFT JOIN businesses b/.test(s)) {
      return rows([{ ...this.client, channel_source: null, business_name: null, age_months: null, utm_source: null, utm_campaign: null, utm_medium: null, cf_setter_user_id: null }]);
    }
    if (/FROM transactions WHERE client_id = \$1/.test(s)) {
      return rows(this.payment ? [{ id: this.payment.id, product_name: "Consulting Services Package", amount_paid: this.payment.amount_paid, status: this.payment.status, created_at: this.payment.created_at }] : []);
    }
    if (/^SELECT id, first_name, last_name, custom_fields FROM clients/.test(s)) return rows([{ ...this.client }]);
    if (/SELECT custom_fields FROM clients/.test(s)) return rows([{ custom_fields: {} }]);
    if (/FROM clients c LEFT JOIN staff s/.test(s)) return rows([{ assigned_csm_staff_id: null, staff_id: null, name: null, status: null, is_demo: null }]);
    if (/FROM messages/.test(s) && /ORDER BY created_at DESC/.test(s)) {
      const limit = Number(params[2]) || 20;
      return rows([...this.messages].sort((a, b) => b.created_at - a.created_at).slice(0, limit).map((m) => ({ ...m, rendered_body: m.body, template_key: null, created_at: m.created_at.toISOString() })));
    }
    if (/FROM call_outcomes/.test(s)) return rows([...this.calls].sort((a, b) => b.logged_at - a.logged_at).slice(0, 3).map((c) => ({ ...c, logged_at: c.logged_at.toISOString() })));
    if (/FROM transactions t JOIN products p/.test(s)) return rows(this.payment ? [{ ...this.payment }] : []);
    if (/FROM v_client_entitlements/.test(s)) return rows(this.entitled ? [{ entitlement_code: "credit-optimization-roadmap", active: true, expires_at: null }] : []);
    if (/FROM contracts/.test(s)) return rows(this.contract ? [{ ...this.contract }] : []);
    if (/FROM tasks/.test(s)) return rows(this.tasks.filter((t) => !t.done));
    return rows([]);
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   THE STORY — every beat comes from scripts/demo/fixtures/blueprint-timelapse-story.json.
   ═════════════════════════════════════════════════════════════════════ */

/** One monthly pull of the ONE sample file: same person, same Visa, a new
 *  balance (simulated) and a new pull date. The engine prints the rest. */
function creditFileAt(pull) {
  const built = buildSampleCreditFile({
    pulledAt: pull.at,
    person: { first: PERSON.first, last: PERSON.last },
    visa: {
      mask: VISA.mask, balanceCents: pull.visa_balance_cents, limitCents: VISA.limitCents,
      aprPct: VISA.purchaseApr, minimumPaymentCents: VISA.minimumPaymentCents,
      highBalanceCents: VISA.maxEodCents, lastActivityOn: VISA.lastPostedOn
    }
  });
  const scored = withEngineResult(built.payload, { submittedName: PERSONAL.name, submittedAddress: PERSONAL.address });
  return { payload: scored.payload, counts: built.counts, tier: scored.outcomeTier, estimate: scored.fundingEstimate };
}

/** The pack the real letter-pack builder makes from this pull, as document rows. */
async function packDocuments(file, when, { lettersOnly = false } = {}) {
  const engine = runTierEngineFromCrsResult(file.payload, { submittedName: PERSONAL.name, submittedAddress: PERSONAL.address });
  const pack = await buildLetterPack({
    crsResult: engine, personal: PERSONAL, pack: "funding", storedCrs: file.payload,
    generateDeliverablesFn: async () => [], scoreCompanyReportsFn: () => []
  });
  const docs = [];
  let disputes = 0;
  for (const f of pack.files || []) {
    const type = f.type || f.docType;
    const bureau = String(f.bureau || (String(f.name || f.filename || "").match(/^(ex|eq|tu)_|_(ex|eq|tu)\./i) || []).slice(1).find(Boolean) || "").toUpperCase();
    if (type === "dispute") { disputes += 1; continue; }
    if (FUNDING_LETTER_SUBTYPE[type]) {
      docs.push({ subtype: FUNDING_LETTER_SUBTYPE[type], disc: bureau, title: `${type === "inquiry_removal" ? "Inquiry removal" : "Personal info"} — ${bureau}` });
    } else if (FUNDING_ANALYSIS_SUBTYPE[type] && !lettersOnly) {
      const subtype = FUNDING_ANALYSIS_SUBTYPE[type];
      docs.push({ subtype, disc: "", title: titleFor(subtype, subtype) });
    }
  }
  if (disputes) docs.push({ subtype: "metro2_dispute_letter_pack", disc: "", title: titleFor("metro2_dispute_letter_pack") });
  return { docs: docs.map((d) => ({ ...d, when })), fileCount: (pack.files || []).length, disputes };
}

function upsertDocs(db, docs) {
  for (const d of docs) {
    const id = uuidFrom(`doc:${d.subtype}:${d.disc}`);
    const old = db.documents.find((x) => x.id === id);
    if (old) { old.generated_at = d.when; continue; }
    db.documents.push({ id, kind: "deliverable", subtype: d.subtype, title: d.title, generated_at: d.when, created_at: d.when });
  }
}

/** Coach SMS / email words: the server-owned sentence for the intent the coach
 *  model would choose, inside the reviewed template body (migrations 488/490). */
async function coachWords(db, intent, channel) {
  const ctx = await fetchContext(db, { orgId: ORG_ID, clientId: CLIENT_ID });
  const step = ctx.checklist.open_step;
  const q = blueprintCoachQuestion(intent, ctx);
  if (!q.ok) throw new Error(`coach intent ${intent}: ${q.reason}`);
  const reminder = `Fundhub AI coach: ${q.text}${step.verify_kind && !q.text.includes("saved proof") ? " This step needs saved proof before it can close." : ""}`;
  return channel === "email"
    ? `${reminder}\n\nReply here with your next update or ask our team for help.`
    : `${reminder} Reply STOP to opt out.`;
}

function addMessage(db, m) {
  db.messages.push({
    id: uuidFrom(`msg:${db.messages.length}:${m.at}`), direction: m.direction, channel: m.channel,
    body: m.body, subject: m.subject || null, sender_kind: m.sender_kind || null,
    sender_agent_code: m.sender_agent_code || null, created_at: at(m.at), status: m.status || null,
    provider: m.provider || null, provider_ref: null
  });
}

/**
 * Run the whole six months once, in time order, on one SimDb, and snapshot what
 * the three screens would read after each beat. Returns the snapshots.
 */
async function simulate() {
  const db = new SimDb();
  const snaps = [];
  const pulls = [];
  const take = async (beat, now) => {
    const progress = await readClientProgress(db, { orgId: ORG_ID, clientId: CLIENT_ID, now });
    const ctx = await fetchContext(db, { orgId: ORG_ID, clientId: CLIENT_ID });
    // fetchContext reads the wall clock for `overdue`; give it the simulated one.
    if (ctx.checklist.open_step) {
      const row = db.wpRows().find((r) => r.id === ctx.checklist.open_step.id);
      ctx.checklist.open_step.overdue = isOverdue(row, now);
    }
    ctx.as_prompt_block = formatPromptBlock(ctx);
    const credit = db.crs.length ? await creditOverview(db, { orgId: ORG_ID, clientId: CLIENT_ID, asOf: now }) : null;
    const cockpit = await buildCockpit(db, { orgId: ORG_ID, staffId: "0b1e0000-0000-4000-8000-0000000000f1", clientId: CLIENT_ID, now });
    const pull = pulls[pulls.length - 1] || null;
    snaps.push({
      beat, at: now.toISOString(), progress: { ok: true, ...progress }, context: ctx,
      credit: credit ? { ok: true, ...credit } : null,
      cockpit: cockpit ? { ok: true, ...cockpit } : null,
      paid: !!db.payment, contractSignedAt: db.contract ? db.contract.signed_at : null,
      pull: pull ? { at: pull.at, balance_cents: pull.visa_balance_cents, util: pull.util, tier: pull.tier, estimate: pull.estimate } : null,
      waypoints: db.wpRows().map((r) => ({ id: r.id, key: r.key, title: r.title, state: r.state, closedBy: closedBy(r) }))
    });
  };

  for (const beat of SIM.beats) {
    const now = at(beat.at);
    switch (beat.kind) {
      case "pull": {
        const pull = SIM.pulls.find((p) => p.at === beat.at);
        const file = creditFileAt(pull);
        db.crs.push({ id: uuidFrom(`crs:${pull.at}`), created_at: now, result: file.payload });
        pulls.push({ ...pull, util: file.counts.utilizationPct, tier: file.tier, estimate: file.estimate });
        if (db.entitled) {
          // CB-09 aftercare: the saved result feeds checklist verification and
          // re-seeding, and the letter files are regenerated.
          await seedClientWaypoints(db, { orgId: ORG_ID, clientId: CLIENT_ID, now, crsResult: file.payload, personal: PERSONAL, blueprintDisputeSteps: true });
          await evaluateWaypoints(db, { orgId: ORG_ID, clientId: CLIENT_ID, crsResult: file.payload, now });
          const pack = await packDocuments(file, now, { lettersOnly: true });
          upsertDocs(db, pack.docs);
        }
        break;
      }
      case "contract_signed":
        db.events.push({ name: "contract.signed", ts: now });
        db.contract = { id: uuidFrom("contract"), status: "signed", merge_values: { package_fee: SIM.package_fee }, sent_at: now.toISOString(), signed_at: now.toISOString(), created_at: now.toISOString() };
        break;
      case "payment": {
        db.events.push({ name: "payment.received", ts: now });
        db.payment = { id: uuidFrom("payment"), amount_paid: SIM.package_amount_dollars, status: "succeeded", created_at: now.toISOString() };
        db.entitled = true;
        // The shipped purchase hook. It reads the freshest stored file itself.
        db.client.custom_fields = { address: PERSON.home.line1, city: PERSON.home.city, state: PERSON.home.state, zip: PERSON.home.zip };
        const seeded = await seedChecklistForPurchase(db, { orgId: ORG_ID, clientId: CLIENT_ID, productCode: "consulting-package", now });
        if (!seeded.ok || !seeded.seeded.length) throw new Error(`purchase hook seeded nothing: ${JSON.stringify(seeded)}`);
        break;
      }
      case "pack": {
        const latest = [...db.crs].sort((a, b) => b.created_at - a.created_at)[0];
        const pack = await packDocuments({ payload: latest.result }, now);
        upsertDocs(db, pack.docs);
        beat.detail = `${pack.fileCount} files from the letter-pack builder (${pack.disputes} round-1 dispute letters)`;
        break;
      }
      case "tick":
        for (const key of beat.keys) {
          const row = db.waypoints.get(key);
          const out = await setClientTick(db, { orgId: ORG_ID, clientId: CLIENT_ID, waypointId: row.id, done: true, at: now });
          if (!out.ok) throw new Error(`tick ${key}: ${out.reason}`);
        }
        break;
      case "upload":
        db.documents.push({ id: uuidFrom(`upload:${beat.at}`), kind: beat.doc_kind, subtype: beat.doc_subtype || null, title: beat.doc_title, generated_at: now, created_at: now });
        break;
      case "verify":
        await evaluateWaypoints(db, { orgId: ORG_ID, clientId: CLIENT_ID, now });
        break;
      case "coach": {
        const body = beat.body || await coachWords(db, beat.intent, beat.channel);
        addMessage(db, { at: beat.at, direction: "outbound", channel: beat.channel, body, subject: beat.subject,
          sender_kind: "agent", sender_agent_code: beat.agent || "BP-COACH", status: beat.status, provider: beat.provider });
        break;
      }
      case "coach_call": {
        const step = db.wpRows().find((r) => r.key === beat.waypoint);
        addMessage(db, { at: beat.at, direction: "outbound", channel: "voice",
          body: `Fundhub AI coach call started for the saved current step: ${step.title}.`,
          sender_kind: "agent", sender_agent_code: "BP-COACH-VOICE", status: "sent", provider: "bland" });
        db.calls.push({ outcome: "completed", notes: beat.summary, recording_url: null, transcript: beat.transcript, logged_at: at(beat.ended_at) });
        break;
      }
      case "client_reply":
        addMessage(db, { at: beat.at, direction: "inbound", channel: beat.channel, body: beat.body, status: "received", provider: "twilio" });
        break;
      case "progress_note": {
        const row = db.waypoints.get(beat.waypoint);
        await db.query("UPDATE client_waypoints SET state = $4, state_reason = $5, completed_at = NULL WHERE org_id = $1::uuid AND client_id = $2::uuid AND key = $3 RETURNING *",
          [ORG_ID, CLIENT_ID, row.key, "in_progress", `Client report (${beat.event}): ${beat.reply}`]);
        break;
      }
      default:
        throw new Error(`unknown beat kind ${beat.kind}`);
    }
    await take(beat, now);
  }
  return { snaps, pulls };
}

/* ── run the simulation (cached: the letter-pack builder takes ~20 s a run) ── */
/* Bump SIM_VERSION when simulate() or SimDb changes; --fresh ignores the cache. */
const SIM_VERSION = "4";
const CACHE_KEY = crypto.createHash("sha1")
  .update(SIM_VERSION)
  .update(JSON.stringify(SIM)).update(JSON.stringify(DEFINITIONS)).update(JSON.stringify(VISA))
  .digest("hex").slice(0, 16);
const CACHE = path.join(os.tmpdir(), `fundhub-blueprint-timelapse-sim-${CACHE_KEY}.json`);
const { snaps, pulls } = !ARGS.includes("--fresh") && fs.existsSync(CACHE)
  ? JSON.parse(fs.readFileSync(CACHE, "utf8"))
  : await simulate();
fs.writeFileSync(CACHE, JSON.stringify({ snaps, pulls }));

if (DRY) {
  for (const p of pulls) {
    console.log(`pull ${p.at.slice(0, 10)}  Visa ${cents(p.visa_balance_cents)} of ${cents(VISA.limitCents)} (${p.util}%)  engine ${p.tier} $${p.estimate?.toLocaleString("en-US")}`);
  }
  for (const s of snaps) {
    const open = s.waypoints.filter((w) => w.state !== "done").length;
    console.log(`${s.at.slice(0, 16)}  ${s.beat.label}  · open ${open}/${s.waypoints.length}  · next: ${s.context.checklist.open_step?.title || "—"}`);
  }
  console.log("\n" + snaps[snaps.length - 1].context.as_prompt_block);
  process.exit(0);
}

/* ═══════════════════════════════════════════════════════════════════════
   CAPTURE — the real pages, served as files, every /api/** answered from the
   snapshot the simulation saved for that moment.
   ═════════════════════════════════════════════════════════════════════ */
const DAY0 = at(SIM.beats.find((b) => b.kind === "payment").at).getTime();
const DAY_MS = 86_400_000;
const snapAt = (t) => {
  let pick = snaps[0];
  for (const s of snaps) if (Date.parse(s.at) <= t) pick = s;
  return pick;
};
const beatTime = (label) => {
  const s = snaps.find((x) => x.beat.label === label);
  if (!s) throw new Error(`no beat labelled ${label}`);
  return Date.parse(s.at);
};
const PHX = new Intl.DateTimeFormat("en-US", { timeZone: "America/Phoenix", weekday: "short", month: "short", day: "numeric", year: "numeric" });
function clockText(t) {
  const day = Math.max(0, Math.floor((t - DAY0) / DAY_MS));
  const month = Math.min(6, Math.max(1, Math.ceil(day / 30)));
  return `Month ${month} · Day ${day} — ${PHX.format(new Date(t))}`;
}

/* What the portal reads. portal-summary is the sample bundle's own read, with
   the facts this simulation changed: the latest pull's scores and the engine's
   estimate, the signed agreement and the posted payment. */
function portalSummary(snap) {
  const base = structuredClone(BUNDLE.reads["/api/read/portal-summary"]);
  const est = snap.pull ? snap.pull.estimate : base.prequal_amount;
  base.prequal_amount = est;
  base.prequal_display = est == null ? null : `$${Number(est).toLocaleString("en-US")}`;
  base.documents = (snap.progress.deliverables || []).map((d) => ({ id: d.documentId, title: d.title, mime_type: "application/pdf", created_at: d.generatedAt }));
  base.stage = { ...base.stage, key: snap.paid ? "paid" : base.stage.key, before_call: false, call_held: true,
    contract_signed_at: snap.contractSignedAt, agreement_signed: !!snap.contractSignedAt, payment_posted: snap.paid };
  return base;
}
const ENTITLEMENTS = (snap) => ({
  ok: true, count: snap.paid ? 2 : 0, limit: 200, offset: 0, hasMore: false,
  items: snap.paid ? ["credit-optimization-roadmap", "metro2-letter-pack"].map((code) => ({
    entitlement_code: code, active: true, granted_at: SIM.beats.find((b) => b.kind === "payment").at, expires_at: null
  })) : []
});
const CLIENT_SESSION = { ok: true, principal: "client", staff: { id: CLIENT_ID, client_id: CLIENT_ID, role: "client", name: `${PERSON.first} ${PERSON.last}`, email: "sample@example.test", org_id: ORG_ID, status: "active", had_call: true } };
const CLOSER_SESSION = { ok: true, staff: { id: "staff-sim-closer", name: "Fundhub team", email: "team@example.test", role: "closer", org_id: ORG_ID, status: "active" } };

function apiAnswer(url, method, snap, role) {
  const u = new URL(url);
  const p = u.pathname;
  if (p === "/api/auth/session") return role === "client" ? CLIENT_SESSION : CLOSER_SESSION;
  if (p === "/api/read/client-progress") return snap.progress;
  if (p === "/api/read/portal-summary") return portalSummary(snap);
  if (p === "/api/read/entitlements") return ENTITLEMENTS(snap);
  if (p === "/api/money/credit") return snap.credit || { ok: false, error: "no_credit_file" };
  if (p === "/api/money/overview") return { ok: true, client: { name: `${PERSON.first} ${PERSON.last}` }, sandbox: false };
  if (p === "/api/read/agent-context") return { ok: true, context: snap.context };
  if (p === "/api/read/closer-deck") {
    return { ok: true, survey: { name: `${PERSON.first} ${PERSON.last}` }, offers: offersForClient(), businesses: [],
      engine: { available: false, tier: snap.pull?.tier || null, fico: {}, reasons: [], plan: [] } };
  }
  if (p === "/api/read/closer-call") return snap.cockpit;
  if (p === "/api/read/closer-now") return { ok: true, current: null, next: null };
  if (p === "/api/read/tradelines") return { ok: true, data: [] };
  if (p === "/api/read/lender-matches") return { ok: true, matches: [] };
  if (method !== "GET") return { ok: true };
  return { ok: true, count: 0, limit: 200, offset: 0, hasMore: false, items: [] };
}

async function startStaticServer() {
  const child = spawn(process.execPath, [path.join(ROOT, "e2e/static-server.mjs")], { env: { ...process.env, E2E_PORT: "0" }, stdio: ["ignore", "pipe", "inherit"] });
  const port = await new Promise((resolve, reject) => {
    let buf = "";
    child.stdout.on("data", (d) => {
      buf += d;
      const m = buf.match(/127\.0\.0\.1:(\d+)/);
      if (m) resolve(Number(m[1]));
    });
    child.on("exit", (code) => reject(new Error(`static server exited ${code}`)));
  });
  return { child, base: `http://127.0.0.1:${port}` };
}

const OVERLAY_JS = ({ clock, caption, role }) => {
  let el = document.getElementById("__sim_overlay");
  if (!el) {
    el = document.createElement("div");
    el.id = "__sim_overlay";
    el.setAttribute("aria-hidden", "true");
    el.style.cssText = "position:fixed;right:14px;bottom:14px;z-index:2147483647;background:rgba(17,17,19,.84);color:#fff;"
      + "font:600 12px/1.35 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:7px 11px;border-radius:9px;"
      + "max-width:430px;pointer-events:none;box-shadow:0 4px 14px rgba(0,0,0,.22)";
    el.innerHTML = '<div style="color:#ffb4a8;letter-spacing:.03em;font-size:10.5px">SIMULATION — sample file, not a real client</div>'
      + '<div id="__sim_clock" style="font-size:13.5px;font-variant-numeric:tabular-nums"></div>'
      + '<div id="__sim_cap" style="font-weight:500;color:#d4d4d8;font-size:11.5px"></div>';
    document.documentElement.appendChild(el);
    const cur = document.createElement("div");
    cur.id = "__sim_cursor";
    cur.style.cssText = "position:fixed;left:-50px;top:-50px;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;"
      + "background:rgba(37,99,235,.28);border:2px solid rgba(37,99,235,.9);z-index:2147483646;pointer-events:none;transition:none";
    document.documentElement.appendChild(cur);
  }
  document.getElementById("__sim_clock").textContent = clock;
  document.getElementById("__sim_cap").textContent = (role === "client" ? "Client view · " : "Staff view · ") + caption;
};

async function capture() {
  const { chromium } = await import("@playwright/test");
  const cfg = (await import(path.join(ROOT, "playwright.config.mjs"))).default;
  const executablePath = cfg.use?.launchOptions?.executablePath;
  const marks = {};
  const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), "fundhub-blueprint-frames-"));
  const { child, base } = await startStaticServer();
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
  await context.addInitScript(() => {
    try {
      const v = Number(sessionStorage.getItem("__sim_now"));
      if (v) {
        const Real = Date;
        const off = v - Real.now();
        Date = class extends Real {
          constructor(...a) { if (a.length === 0) super(Real.now() + off); else super(...a); }
          static now() { return Real.now() + off; }
        };
      }
      localStorage.setItem("fh_token", "sim-token");
      localStorage.setItem("fh_role", sessionStorage.getItem("__sim_role") || "client");
      localStorage.removeItem("fh_demo");
    } catch { /* storage blocked: the page shows its own state */ }
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  const state = { snap: snaps[0], role: "client", t: Date.parse(snaps[0].at), caption: "", n: 0, cursor: null };
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (!url.startsWith(base)) return route.abort();
    if (!url.startsWith(`${base}/api/`)) return route.continue();
    const method = route.request().method();
    if (url.includes("/api/waypoint-tick") && method === "POST") {
      const id = route.request().postDataJSON()?.waypoint_id;
      const after = state.tickAfter;
      const w = after && after.progress.waypoints.find((x) => x.id === id);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(
        w ? { ok: true, changed: true, waypoint: { id, state: w.state, completedAt: w.completedAt, closedBy: w.closedBy } } : { ok: false, error: "not_found" }) });
    }
    if (url.includes("/api/documents-upload") && method === "POST") {
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(apiAnswer(url, method, state.snap, state.role)) });
  });

  const overlay = () => page.evaluate(OVERLAY_JS, { clock: clockText(state.t), caption: state.caption, role: state.role }).catch(() => {});
  async function frame() {
    await overlay();
    if (state.cursor) await page.evaluate(([x, y]) => { const c = document.getElementById("__sim_cursor"); if (c) { c.style.left = x + "px"; c.style.top = y + "px"; } }, state.cursor).catch(() => {});
    const file = path.join(framesDir, `f${String(state.n).padStart(5, "0")}.jpg`);
    await page.screenshot({ path: file, type: "jpeg", quality: 92 });
    state.n += 1;
  }
  const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
  /** n frames; sim clock t0→t1; optional window scroll y0→y1 and cursor glide. */
  async function run(n, { t1 = state.t, scrollTo = null, cursorTo = null, scrollEl = null } = {}) {
    const t0 = state.t;
    const y0 = scrollEl ? await page.evaluate((sel) => document.querySelector(sel)?.scrollTop || 0, scrollEl) : await page.evaluate(() => scrollY);
    const c0 = state.cursor || cursorTo;
    for (let i = 1; i <= n; i += 1) {
      const k = ease(i / n);
      state.t = t0 + (t1 - t0) * (i / n);
      if (scrollTo !== null) {
        const y = y0 + (scrollTo - y0) * k;
        if (scrollEl) await page.evaluate(([sel, v]) => { const e = document.querySelector(sel); if (e) e.scrollTop = v; }, [scrollEl, y]);
        else await page.evaluate((v) => window.scrollTo(0, v), y);
      }
      if (cursorTo && c0) {
        state.cursor = [c0[0] + (cursorTo[0] - c0[0]) * k, c0[1] + (cursorTo[1] - c0[1]) * k];
        await page.mouse.move(state.cursor[0], state.cursor[1]);
      }
      await frame();
    }
  }
  async function setSim(t, role) {
    state.t = t;
    state.role = role;
    state.snap = snapAt(t);
    await page.evaluate(([v, r]) => { sessionStorage.setItem("__sim_now", String(v)); sessionStorage.setItem("__sim_role", r); }, [t, role]).catch(() => {});
  }
  async function open(url, t, role, ready) {
    if (!page.url().startsWith(base)) await page.goto(`${base}/__sim_blank`);
    await setSim(t, role);
    await page.goto(`${base}${url}`);
    await page.waitForSelector(ready, { timeout: 15000 });
    await page.waitForTimeout(250);
  }
  async function reload(t, ready, { keepScroll = true, scrollEl = null } = {}) {
    const y = await page.evaluate(() => scrollY);
    const inner = scrollEl ? await page.evaluate((sel) => document.querySelector(sel)?.scrollTop || 0, scrollEl) : 0;
    await setSim(t, state.role);
    await page.reload();
    await page.waitForSelector(ready, { timeout: 15000 });
    await page.waitForTimeout(200);
    if (keepScroll) await page.evaluate((v) => window.scrollTo(0, v), y);
    return inner;
  }
  const centerOf = async (sel) => {
    const b = await page.locator(sel).first().boundingBox();
    if (!b) throw new Error(`not on screen: ${sel}`);
    return [b.x + b.width / 2, b.y + b.height / 2];
  };
  const docY = (sel, offset = 0) => page.evaluate(([s, o]) => {
    const e = document.querySelector(s);
    return e ? Math.max(0, e.getBoundingClientRect().top + scrollY - o) : 0;
  }, [sel, offset]);
  async function click(sel, frames = 7) {
    await page.locator(sel).first().scrollIntoViewIfNeeded();
    const xy = await centerOf(sel);
    await run(frames, { cursorTo: xy });
    await page.evaluate(() => { const c = document.getElementById("__sim_cursor"); if (c) c.style.background = "rgba(37,99,235,.65)"; });
    await page.mouse.click(xy[0], xy[1]);
  }
  const unpress = () => page.evaluate(() => { const c = document.getElementById("__sim_cursor"); if (c) c.style.background = "rgba(37,99,235,.28)"; });

  return { marks, page, base, state, run, open, reload, click, unpress, docY, centerOf, setSim, frame, framesDir, errors,
    async close() { await browser.close(); child.kill(); } };
}

const caption = (cam, label) => { cam.state.caption = label; };
const T = (label) => beatTime(label);
const labelAt = (iso) => SIM.beats.find((b) => b.at === iso).label;

async function film() {
  const cam = await capture();
  const PROGRESS_READY = "#main:not(.hidden) #cWaypoints";
  try {
    /* 1 · Client portal, Day 0, right after the purchase. Real link click to the progress page. */
    const tPack = T(labelAt("2026-10-17T16:30:00.000Z"));
    await cam.open(`/app/client-portal.html?id=${CLIENT_ID}`, tPack, "client", "#prog-link a");
    caption(cam, "Day 0 · paid · Capital Blueprint unlocked");
    await cam.run(10, { t1: tPack + 5 * 60_000 });
    await cam.run(12, { scrollTo: await cam.docY('[data-tile="UWIQ_DELIVERABLES"]', 300), t1: tPack + 10 * 60_000 });
    await cam.run(10, { t1: tPack + 15 * 60_000 });
    await cam.run(10, { scrollTo: 0, t1: tPack + 20 * 60_000 });
    await cam.click("#prog-link a", 8);
    await cam.page.waitForSelector(PROGRESS_READY, { timeout: 15000 });
    await cam.unpress();
    await cam.page.waitForTimeout(200);

    /* 2 · Progress page, weeks 1–3: the checklist the purchase built, ticked with real clicks. */
    caption(cam, "Checklist built from the sample file · paydown target from the engine");
    await cam.run(14);
    await cam.run(16, { scrollTo: await cam.docY(".checklist-block", 24) });
    const tickBeat = async (iso, keys) => {
      const t = Date.parse(iso);
      await cam.run(10, { t1: t - 60_000 });
      cam.state.caption = labelAt(iso);
      cam.state.tickAfter = snaps.find((s) => s.at === iso);
      for (const key of keys) {
        const id = cam.state.tickAfter.waypoints.find((w) => w.key === key).id;
        await cam.click(`button[data-tick="${id}"]`, 6);
        await cam.page.waitForSelector(`button[data-tick="${id}"][aria-checked="true"]`, { timeout: 5000 });
        await cam.unpress();
        await cam.run(3, { t1: t });
      }
      await cam.reload(t, PROGRESS_READY);
    };
    await tickBeat("2026-10-19T17:00:00.000Z", ["form_llc", "get_ein", "business_checking"]);
    await tickBeat("2026-10-26T18:00:00.000Z", ["blueprint_dispute_mail_letters"]);
    await tickBeat("2026-10-29T18:00:00.000Z", ["personal_loan"]);

    /* Mailing proof: the real upload button, a real file chooser, then the verifier closes it. */
    const tUp = Date.parse("2026-11-02T17:30:00.000Z");
    await cam.run(8, { t1: tUp - 60_000 });
    caption(cam, labelAt("2026-11-02T17:30:00.000Z"));
    const proofWp = snaps.find((s) => s.at === "2026-11-02T17:30:00.000Z").waypoints.find((w) => w.key === "blueprint_dispute_mail_receipt");
    const chooser = cam.page.waitForEvent("filechooser");
    await cam.click(`button[data-proof="${proofWp.id}"]`, 8);
    await (await chooser).setFiles({ name: "mailing-receipt-SAMPLE.jpg", mimeType: "image/jpeg", buffer: Buffer.from("SIMULATED SAMPLE RECEIPT") });
    await cam.page.waitForFunction((id) => /Got it/.test(document.querySelector(`[data-proof-msg="${id}"]`)?.textContent || ""), proofWp.id);
    await cam.unpress();
    await cam.run(8, { t1: tUp });
    const tVer = Date.parse("2026-11-02T18:07:00.000Z");
    caption(cam, labelAt("2026-11-02T18:07:00.000Z"));
    await cam.reload(tVer, PROGRESS_READY);
    await cam.run(12, { t1: tVer + 3600_000 });

    /* Month 1 pull lands; the paydown goes overdue. */
    const tM1 = Date.parse("2026-11-16T12:00:00.000Z");
    await cam.run(8, { t1: tM1 - 3600_000 });
    caption(cam, labelAt("2026-11-16T12:00:00.000Z"));
    await cam.reload(tM1 + 5 * 3600_000, PROGRESS_READY);
    await cam.run(8, { scrollTo: 0 });
    await cam.run(8, { t1: tM1 + 5 * 3600_000 });

    /* 3 · Staff side: the AI coach ladder arrives in the shared client file. */
    const tSms1 = Date.parse("2026-11-16T17:07:00.000Z");
    await cam.open(`/app/closer-dashboard.html?client_id=${CLIENT_ID}`, tSms1, "closer", "[data-fh-shared-context] summary");
    caption(cam, "Closer Dashboard · AI coach and Fundhub team shared file");
    await cam.run(8);
    await cam.run(10, { scrollTo: await cam.docY("[data-fh-shared-context]", 520) });
    await cam.click("[data-fh-shared-context] summary", 8);
    await cam.unpress();
    await cam.page.waitForSelector("[data-fh-context-lines]");
    await cam.run(6, { scrollTo: await cam.docY("[data-fh-shared-context]", 120) });
    const LINES = "[data-fh-context-lines]";
    const coachBeats = ["2026-11-16T17:07:00.000Z", "2026-11-18T17:07:00.000Z", "2026-11-21T17:07:00.000Z", "2026-11-21T18:07:00.000Z", "2026-11-21T19:30:00.000Z", "2026-11-21T19:31:30.000Z"];
    for (const iso of coachBeats) {
      const t = Date.parse(iso);
      await cam.run(5, { t1: t });
      caption(cam, labelAt(iso));
      await cam.reload(t, "[data-fh-shared-context]");
      await cam.page.locator("[data-fh-shared-context] summary").click();
      await cam.page.waitForSelector(LINES);
      const bottom = await cam.page.evaluate((sel) => { const e = document.querySelector(sel); return e ? e.scrollHeight : 0; }, LINES);
      await cam.run(10, { scrollTo: bottom, scrollEl: LINES });
    }

    /* 4 · Client again: bureau response uploaded, then the monthly pulls land on the Credit page. */
    const tBr = Date.parse("2026-11-24T18:07:00.000Z");
    await cam.open("/progress.html", tBr, "client", PROGRESS_READY);
    caption(cam, labelAt("2026-11-24T18:07:00.000Z"));
    await cam.page.evaluate((y) => window.scrollTo(0, y), await cam.docY(".checklist-block", 24));
    await cam.run(16, { t1: tBr + 12 * 3600_000 });

    const pullsIso = ["2026-11-16T12:00:00.000Z", "2026-12-16T12:00:00.000Z", "2027-01-15T12:00:00.000Z", "2027-02-14T12:00:00.000Z", "2027-03-16T12:00:00.000Z", "2027-04-15T12:00:00.000Z"];
    const ACCT = '#fos-credit section[aria-labelledby="c-acct"]';
    await cam.open("/app/financeos.html#credit", Date.parse(pullsIso[1]) - 2 * DAY_MS, "client", ACCT);
    caption(cam, "FinanceOS Credit · Month 1 pull on file");
    await cam.run(6);
    await cam.run(10, { scrollTo: await cam.docY(ACCT, 610) });
    for (const iso of pullsIso.slice(1)) {
      const t = Date.parse(iso);
      await cam.run(5, { t1: t });
      caption(cam, labelAt(iso));
      await cam.reload(t + 3600_000, ACCT);
      await cam.run(11, { t1: t + 3 * 3600_000 });
      if (iso.startsWith("2027-01-15")) cam.marks.month3 = cam.state.n - 1;
    }

    /* 5 · Progress page, Month 6: every step closed (the paydown by the Month 4 pull). */
    const tEnd = Date.parse(pullsIso[5]) + 4 * 3600_000;
    await cam.open("/progress.html", tEnd, "client", PROGRESS_READY);
    caption(cam, "Month 6 · checklist done · no-new-credit stays a standing rule");
    await cam.run(12);
    await cam.run(18, { scrollTo: await cam.docY(".checklist-block", 24) });
    await cam.run(14);
    cam.marks.month6 = cam.state.n - 1;

    /* 6 · Staff side, Month 6: the same saved file. */
    await cam.open(`/app/closer-dashboard.html?client_id=${CLIENT_ID}`, tEnd, "closer", "[data-fh-shared-context] summary");
    caption(cam, "Closer Dashboard · same saved file, Month 6");
    await cam.run(16);
    await cam.run(10, { scrollTo: await cam.docY("[data-fh-shared-context]", 520) });
    await cam.click("[data-fh-shared-context] summary", 8);
    await cam.unpress();
    await cam.page.waitForSelector(LINES);
    await cam.run(6, { scrollTo: await cam.docY("[data-fh-shared-context]", 120) });
    const bottom = await cam.page.evaluate((sel) => document.querySelector(sel)?.scrollHeight || 0, LINES);
    while (cam.state.n < TOTAL_FRAMES - 10) await cam.run(Math.min(20, TOTAL_FRAMES - 10 - cam.state.n), { scrollTo: bottom, scrollEl: LINES, t1: tEnd + 6 * 3600_000 });
    while (cam.state.n < TOTAL_FRAMES) await cam.run(1);
    if (cam.state.n !== TOTAL_FRAMES) console.warn(`frame count ${cam.state.n}, planned ${TOTAL_FRAMES}`);
    if (cam.errors.length) console.warn(`page errors:\n${cam.errors.join("\n")}`);
    return { framesDir: cam.framesDir, marks: cam.marks };
  } finally {
    await cam.close();
  }
}

function encode({ framesDir, marks }) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const frames = fs.readdirSync(framesDir).filter((f) => f.endsWith(".jpg")).length;
  const fps = frames / SECONDS;
  const r = spawnSync(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", "-framerate", String(fps), "-i", path.join(framesDir, "f%05d.jpg"),
    "-vf", "scale=3840:2160:flags=lanczos,format=yuv420p", "-r", String(FPS), "-c:v", "libx264", "-preset", "slow", "-crf", argValue("--crf", "20"),
    "-tune", "stillimage", "-movflags", "+faststart", VIDEO], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("ffmpeg failed");
  for (const [name, i] of [["still-01-start.png", 4], ["still-02-month-3.png", marks.month3], ["still-03-month-6.png", marks.month6]]) {
    spawnSync(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", "-i", path.join(framesDir, `f${String(i).padStart(5, "0")}.jpg`), path.join(OUT_DIR, name)], { stdio: "inherit" });
  }
  const probe = spawnSync(FFMPEG, ["-hide_banner", "-i", VIDEO], { encoding: "utf8" });
  console.log(String(probe.stderr).split("\n").filter((l) => /Duration|Stream/.test(l)).join("\n"));
  console.log(`size: ${(fs.statSync(VIDEO).size / 1e6).toFixed(1)} MB`);
}

const filmed = await film();
if (!STILLS_ONLY) encode(filmed);
console.log(`frames: ${filmed.framesDir}\nvideo: ${VIDEO}`);
