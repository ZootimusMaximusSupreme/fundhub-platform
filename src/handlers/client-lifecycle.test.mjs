import { test } from "node:test";
import assert from "node:assert";
import {
  splitName,
  resolveClient,
  onEntryCaptured,
  onSurveySubmitted,
  onPaymentReceived,
  onPaymentFailed,
  onDiagnosticPaid,
  onDecisionRendered,
  onAnalysisCompleted,
  onDocsReceivedReviewChecklist,
  register
} from "./client-lifecycle.mjs";
import { getHandlers } from "../events/registry.mjs";

// In-memory Postgres fake: interprets the exact queries the handlers issue.
function pgFake({ openShift = null, failOn = null, smsRouting = null, pipelineStages = [], cards = [] } = {}) {
  const clients = [], transactions = [], crs = [], events = [], requests = [];
  let n = 0;
  const findClient = (org, email) =>
    clients.find((c) => c.org_id === org && String(c.email || "").toLowerCase() === String(email).toLowerCase());
  const routingFor = (orgId) => (typeof smsRouting === "string" ? smsRouting : smsRouting?.[orgId]) ?? null;
  return {
    clients, transactions, crs, events, requests, pipelineStages, cards,
    async query(sql, params = []) {
      if (failOn && failOn.test(sql)) throw Object.assign(new Error("simulated outage"), { code: "08006" });
      // advanceCardToStage / moveCardToStage
      if (/SELECT ps\.id AS stage_id, ps\.pipeline_id/.test(sql) && /FROM pipeline_stages/.test(sql)) {
        const [pipelineKey, stageKey, orgId] = params;
        const row = pipelineStages.find((r) =>
          r.pipeline_key === pipelineKey && r.stage_key === stageKey &&
          (orgId == null || r.org_id == null || r.org_id === orgId));
        return {
          rows: row
            ? [{ stage_id: row.stage_id, pipeline_id: row.pipeline_id, sort_order: row.sort_order ?? 0 }]
            : []
        };
      }
      if (/SELECT ps\.key AS stage_key, ps\.sort_order/.test(sql) && /FROM cards c/.test(sql)) {
        const [clientId, pipelineKey, orgId] = params;
        const card = cards.find((c) => c.client_id === clientId);
        if (!card) return { rows: [] };
        const stage = pipelineStages.find((r) =>
          r.pipeline_id === card.pipeline_id && r.stage_id === card.stage_id &&
          r.pipeline_key === pipelineKey &&
          (orgId == null || r.org_id == null || r.org_id === orgId));
        return {
          rows: stage
            ? [{ stage_key: stage.stage_key, sort_order: stage.sort_order ?? 0 }]
            : []
        };
      }
      if (/SELECT id FROM cards WHERE client_id/.test(sql)) {
        const [clientId, pipelineId] = params;
        const c = cards.find((c) => c.client_id === clientId && c.pipeline_id === pipelineId);
        return { rows: c ? [{ id: c.id }] : [] };
      }
      if (/UPDATE cards SET stage_id/.test(sql)) {
        const c = cards.find((c) => c.id === params[0]);
        if (c) c.stage_id = params[1];
        return { rows: [] };
      }
      if (/INSERT INTO cards/.test(sql)) {
        const id = "card-" + ++n;
        cards.push({ id, org_id: params[0], client_id: params[1], pipeline_id: params[2], stage_id: params[3] });
        return { rows: [] };
      }
      if (/UPDATE clients SET tags = array\(SELECT DISTINCT unnest\(tags \|\|/.test(sql)) {
        const c = clients.find((c) => c.id === params[0]);
        if (c) c.tags = Array.from(new Set([...(c.tags || []), ...params[1]]));
        return { rows: [] };
      }
      if (/INSERT INTO staff_events/.test(sql)) {
        const e = { staff_id: params[0], org_id: params[1], shift_id: params[2], kind: params[3], detail: JSON.parse(params[4]) };
        events.push(e);
        return { rows: [{ id: "ev-" + events.length, ...e }] };
      }
      if (/FROM shifts/.test(sql)) return { rows: openShift ? [{ id: openShift }] : [] };
      if (/SELECT provider FROM message_channel_routing/.test(sql)) {
        const provider = routingFor(params[0]);
        return { rows: provider ? [{ provider }] : [] };
      }
      if (/SELECT id, ghl_contact_id, email, phone, first_name, last_name\s+FROM clients WHERE id/.test(sql)
          || /SELECT id, ghl_contact_id, email, phone, first_name, last_name[\s\S]*FROM clients WHERE id/.test(sql)) {
        const c = clients.find((x) => x.id === params[0] && x.org_id === params[1]);
        return { rows: c ? [{
          id: c.id,
          ghl_contact_id: c.ghl_contact_id,
          email: c.email,
          phone: c.phone || null,
          first_name: c.first_name,
          last_name: c.last_name
        }] : [] };
      }
      if (/SELECT id, ghl_contact_id FROM clients/.test(sql)) {
        const c = findClient(params[0], params[1]);
        return { rows: c ? [{ id: c.id, ghl_contact_id: c.ghl_contact_id }] : [] };
      }
      if (/SELECT id FROM clients/.test(sql)) {
        const c = findClient(params[0], params[1]);
        return { rows: c ? [{ id: c.id }] : [] };
      }
      if (/INSERT INTO clients/.test(sql)) {
        if (findClient(params[0], params[1])) return { rows: [] }; // ON CONFLICT DO NOTHING
        const id = "cl-" + ++n;
        clients.push({ id, org_id: params[0], email: params[1], first_name: params[2], last_name: params[3], phone: params[4] ?? null, custom_fields: {}, outcome_tier: null, ghl_contact_id: null });
        return { rows: [{ id }] };
      }
      // patchClientContact — a fresh apply/booking replaces stale contact data.
      if (/UPDATE clients SET[\s\S]*phone = COALESCE\(/.test(sql)) {
        const c = clients.find((c) => c.id === params[0]);
        const overwrite = /phone = COALESCE\(\$2/.test(sql);
        if (c) {
          if ((overwrite || !c.phone) && params[1]) c.phone = params[1];
          if ((overwrite || !c.first_name) && params[2]) c.first_name = params[2];
          if ((overwrite || !c.last_name) && params[3]) c.last_name = params[3];
        }
        return { rows: [] };
      }
      if (/UPDATE clients\s+SET\s+ghl_contact_id\s*=\s*COALESCE/i.test(sql)) {
        const c = clients.find((c) => c.id === params[1]);
        if (c) {
          if (!c.ghl_contact_id) c.ghl_contact_id = params[0];
          c.custom_fields = { ...c.custom_fields, ghl_link_dry_run: true };
        }
        return { rows: [] };
      }
      if (/UPDATE clients SET ghl_contact_id/.test(sql)) {
        const c = clients.find((c) => c.id === params[1]);
        if (c) c.ghl_contact_id = params[0];
        return { rows: [] };
      }
      if (/ghl_link_missing/i.test(sql) && /UPDATE clients/i.test(sql)) {
        const c = clients.find((c) => c.id === params[0]);
        if (c) {
          c.custom_fields = {
            ...c.custom_fields,
            ghl_link_missing: true,
            ghl_link_missing_reason: params[1]
          };
        }
        return { rows: [] };
      }
      if (/UPDATE clients SET custom_fields/.test(sql)) {
        const c = clients.find((c) => c.id === params[0]);
        if (c) Object.assign(c.custom_fields, JSON.parse(params[1]));
        return { rows: [] };
      }
      if (/UPDATE clients SET outcome_tier/.test(sql)) {
        const c = clients.find((c) => c.id === params[0]);
        if (c) c.outcome_tier = params[1];
        return { rows: [] };
      }
      if (/INSERT INTO transactions/.test(sql)) {
        const ref = params[6];
        if (ref && transactions.find((t) => t.org_id === params[0] && t.provider_ref === ref)) return { rows: [] };
        transactions.push({ org_id: params[0], client_id: params[1], product_name: params[2], amount_paid: params[3], provider_ref: ref });
        return { rows: [] };
      }
      if (/SELECT id, org_id, client_id FROM crs_results WHERE id/.test(sql)) {
        const row = crs.find((r) => r.id === params[0]);
        return { rows: row ? [row] : [] };
      }
      if (/FROM soft_pull_requests/.test(sql)) {
        const row = requests.find((r) => r.id === params[0]
          && r.crs_result_id === params[1]
          && r.org_id === params[2]
          && r.client_id === params[3]
          && r.status === "fulfilled");
        return { rows: row ? [{ id: row.id }] : [] };
      }
      if (/SELECT 1 FROM crs_results/.test(sql)) {
        return { rows: crs.find((r) => r.client_id === params[0] && r.__event_id === String(params[1])) ? [{ x: 1 }] : [] };
      }
      if (/INSERT INTO crs_results/.test(sql)) {
        const result = JSON.parse(params[2]);
        crs.push({ org_id: params[0], client_id: params[1], __event_id: result.__event_id, outcome_tier: params[3] });
        return { rows: [] };
      }
      return { rows: [] };
    }
  };
}

const ev = (name, payload, extra = {}) => ({ id: "evt-x", orgId: "org-1", name, payload, ...extra });

test("splitName", () => {
  assert.deepEqual(splitName("Jane Doe"), { firstName: "Jane", lastName: "Doe" });
  assert.deepEqual(splitName("Cher"), { firstName: "Cher", lastName: null });
  assert.deepEqual(splitName("Mary Jane Watson"), { firstName: "Mary", lastName: "Jane Watson" });
  assert.deepEqual(splitName(""), { firstName: null, lastName: null });
});

test("resolveClient: explicit clientId wins, no db insert", async () => {
  const db = pgFake();
  const id = await resolveClient(db, ev("x", { email: "a@b.com" }, { clientId: "given-id" }));
  assert.equal(id, "given-id");
  assert.equal(db.clients.length, 0);
});

test("guarded sample decision uses its existing client without external CRM sync", async () => {
  const queries = [];
  const db = { async query(sql) { queries.push(sql); throw new Error("unexpected CRM query"); } };
  const id = await resolveClient(db,
    ev("analysis.completed", { simulated: true }, { clientId: "sim-client" }),
    { skipCrmLink: true });
  assert.equal(id, "sim-client");
  assert.deepEqual(queries, []);
});

test("entry.captured: creates client once, idempotent on re-run", async () => {
  const db = pgFake();
  await onEntryCaptured(ev("entry.captured", { email: "Jane@X.com", name: "Jane Doe", source: "clickfunnels" }), db);
  await onEntryCaptured(ev("entry.captured", { email: "jane@x.com", name: "Jane Doe" }), db);
  assert.equal(db.clients.length, 1);
  assert.equal(db.clients[0].first_name, "Jane");
});

test("entry.captured: stamps Facebook UTM and marks a /watch land as VSL", async () => {
  const db = pgFake();
  await onEntryCaptured(ev("entry.captured", {
    email: "ad@example.com",
    name: "Ad Lead",
    source: "clickfunnels",
    attribution: {
      utm_source: "fb_ad",
      utm_campaign: "oSched: VSL: Funding",
      landing_path: "/watch",
      referrer_domain: "m.facebook.com"
    }
  }), db);
  const cf = db.clients[0].custom_fields;
  assert.equal(cf.utm_source, "fb_ad");
  assert.equal(cf.utm_campaign, "oSched: VSL: Funding");
  assert.equal(cf.landing_path, "/watch");
  assert.equal(cf.lead_magnet_type, "VSL");
});

test("payment.received: inserts one transaction, replay dedupes by providerRef", async () => {
  const db = pgFake();
  const e = ev("payment.received", { email: "a@b.com", productName: "Consulting Services Deposit", amount: 3000, providerRef: "txn_1", source: "commas" });
  await onPaymentReceived(e, db);
  await onPaymentReceived(e, db); // replay
  assert.equal(db.transactions.length, 1);
  assert.equal(db.transactions[0].amount_paid, 3000);
  assert.equal(db.clients.length, 1, "auto-created the client from the payment email");
});

test("payment.failed: records a failed transaction (not lost)", async () => {
  const db = pgFake();
  await onPaymentFailed(ev("payment.failed", { email: "a@b.com", productName: "Consulting Services Deposit", amount: 3000, providerRef: "txn_f1", source: "commas" }), db);
  assert.equal(db.transactions.length, 1);
});

const SALES_STAGES = [
  { org_id: "org-1", pipeline_key: "sales", stage_key: "new_lead", pipeline_id: "pipe-sales", stage_id: "st-new", sort_order: 0 },
  { org_id: "org-1", pipeline_key: "sales", stage_key: "survey_complete", pipeline_id: "pipe-sales", stage_id: "st-survey", sort_order: 1 },
  { org_id: "org-1", pipeline_key: "sales", stage_key: "booked", pipeline_id: "pipe-sales", stage_id: "st-booked", sort_order: 2 }
];

test("survey.submitted merges answers; diagnostic.paid + decision.rendered stamp the client", async () => {
  const db = pgFake({
    pipelineStages: [
      ...SALES_STAGES,
      { org_id: "org-1", pipeline_key: "sales", stage_key: "diagnostic_paid", pipeline_id: "pipe-sales", stage_id: "st-diag", sort_order: 5 },
      { org_id: "org-1", pipeline_key: "sales", stage_key: "decision_rendered", pipeline_id: "pipe-sales", stage_id: "st-decision", sort_order: 6 }
    ]
  });
  await onEntryCaptured(ev("entry.captured", { email: "a@b.com", name: "A" }), db);
  await onSurveySubmitted(ev("survey.submitted", { email: "a@b.com", answers: { cf_svy_why: "growth", clarity: "high" } }), db);
  await onDiagnosticPaid(ev("diagnostic.paid", { email: "a@b.com" }), db);
  await onDecisionRendered(ev("decision.rendered", { email: "a@b.com", outcomeTier: "FULL_FUNDING", fundingEstimate: 50000 }), db);
  const c = db.clients[0];
  assert.equal(c.custom_fields.cf_svy_why, "growth");
  assert.equal(c.custom_fields.crs_paid, true);
  assert.equal(c.custom_fields.total_funding_estimate, 50000);
  assert.equal(c.outcome_tier, "FULL_FUNDING");
  assert.equal(db.cards[0].stage_id, "st-decision", "decision.rendered must park the card on Decision Rendered");
});

test("survey.submitted mid-survey (no available capital) stays off survey_complete", async () => {
  const db = pgFake({ pipelineStages: SALES_STAGES });
  await onEntryCaptured(ev("entry.captured", { email: "mid@b.com", name: "Mid" }), db);
  await onSurveySubmitted(ev("survey.submitted", {
    email: "mid@b.com",
    answers: { cf_svy_funding_target_amount: "Less than $50k" }
  }), db);
  assert.equal(db.cards[0].stage_id, "st-new");
  assert.notEqual(db.clients[0].custom_fields.lifecycle_status, "Survey Complete");
});

test("survey.submitted with cf_svy_available_capital advances to survey_complete", async () => {
  const db = pgFake({ pipelineStages: SALES_STAGES });
  await onEntryCaptured(ev("entry.captured", { email: "done@b.com", name: "Done" }), db);
  await onSurveySubmitted(ev("survey.submitted", {
    email: "done@b.com",
    answers: {
      cf_svy_funding_target_amount: "Less than $50k",
      cf_svy_available_capital: "Less than $1k"
    }
  }), db);
  assert.equal(db.cards[0].stage_id, "st-survey");
  assert.equal(db.clients[0].custom_fields.lifecycle_status, "Survey Complete");
});

test("entry.captured after survey_complete does not demote the card", async () => {
  const db = pgFake({
    pipelineStages: SALES_STAGES,
    cards: [{ id: "card-1", org_id: "org-1", client_id: "cl-keep", pipeline_id: "pipe-sales", stage_id: "st-survey" }],
    // resolveClient will create via email unless we seed — seed client with matching id via INSERT path
  });
  // Place via handlers so client id matches card
  await onEntryCaptured(ev("entry.captured", { email: "keep@b.com", name: "Keep" }), db);
  // Force card ahead of new_lead
  db.cards[0].stage_id = "st-survey";
  await onEntryCaptured(ev("entry.captured", { email: "keep@b.com", name: "Keep" }), db);
  assert.equal(db.cards[0].stage_id, "st-survey");
});

// workflow-migration-table.md, "Adjacent bug": analyzer_prequal_amount had NO writer
// anywhere in the codebase, so every template merging {{contact.analyzer_prequal_amount}}
// (the AI-SET-03 and AI-SET-04 pre-approval SMS copy) rendered it empty. onDecisionRendered
// wrote only total_funding_estimate. Both mirror the one figure decision.rendered carries.
test("decision.rendered writes analyzer_prequal_amount, not just total_funding_estimate", async () => {
  const db = pgFake();
  await onDecisionRendered(ev("decision.rendered", { email: "a@b.com", outcomeTier: "FULL_FUNDING", fundingEstimate: 50000 }), db);
  const cf = db.clients[0].custom_fields;
  assert.equal(cf.analyzer_prequal_amount, 50000, "the field every pre-approval template merges must be written");
  assert.equal(cf.total_funding_estimate, 50000, "and the existing writer must not regress");
  assert.equal(cf.prequal_sample, false, "a real decision clears any earlier sample label");
});

test("a simulated decision marks its estimate as sample for client screens", async () => {
  const db = pgFake();
  await onDecisionRendered(ev("decision.rendered", {
    email: "sample@example.com", fundingEstimate: 410000, simulated: true
  }), db);
  assert.equal(db.clients[0].custom_fields.prequal_sample, true);
});

// Guard on the `!= null` gate this fix deliberately keeps: a decision carrying no dollar
// figure must not stamp a blank pre-approval onto the client, or the AI-SET copy claims a
// $0 pre-approval. Unlike the test above this cannot fail against pre-fix code — the gate
// is pre-existing — so it earns its place by discriminating instead: `fundingEstimate` is
// explicitly null (not merely absent, which JSON.stringify would silently drop, making the
// assertion vacuous), and it asserts key ABSENCE, since assert.equal treats null and
// undefined as equal. Drop the gate and this fails.
test("decision.rendered with a null fundingEstimate writes neither money field", async () => {
  const db = pgFake();
  await onDecisionRendered(ev("decision.rendered", { email: "a@b.com", outcomeTier: "REPAIR_ONLY", fundingEstimate: null }), db);
  const cf = db.clients[0].custom_fields || {};
  const has = (k) => Object.prototype.hasOwnProperty.call(cf, k);
  assert.equal(has("analyzer_prequal_amount"), false, "a null estimate must not be written as a pre-approval");
  assert.equal(has("total_funding_estimate"), false);
});

test("analysis.completed: stores crs_result once, idempotent by event id", async () => {
  const db = pgFake();
  const e = ev("analysis.completed", { email: "a@b.com", outcomeTier: "REPAIR_ONLY", scores: { ex: 610 } }, { id: "evt-crs-1" });
  await onAnalysisCompleted(e, db);
  await onAnalysisCompleted(e, db); // replay same event
  assert.equal(db.crs.length, 1);
  assert.equal(db.crs[0].outcome_tier, "REPAIR_ONLY");
});

// =============================================================================
// STAFF TELEMETRY — the `pull_run` seam.
//
// It is EMPTY in production: a credit pull is requested and returned entirely by
// automation reacting to the client's $32 diagnostic payment, and the event
// carries no staff member. These tests pin that a normal pull writes NOTHING —
// the behaviour everything depends on today — and pin the row's shape for the
// 05/30 model, where the pull runs live on the call and finally has an actor.
// =============================================================================

const PULL_STAFF = "22222222-2222-4222-8222-222222222222";
const PULL_SHIFT = "55555555-5555-4555-8555-555555555555";

test("an automated pull — no staffId on the event — writes no staff_events row", async () => {
  const db = pgFake();
  await onAnalysisCompleted(ev("analysis.completed", { email: "a@b.com", outcomeTier: "REPAIR_ONLY" }, { id: "evt-auto" }), db);
  assert.equal(db.crs.length, 1, "the result is still stored");
  assert.equal(db.events.length, 0, "a workflow has nobody to attribute the pull to");
});

test("a staff-run pull writes one pull_run event on that person's shift", async () => {
  const db = pgFake();
  await onAnalysisCompleted(ev("analysis.completed", {
    email: "a@b.com", outcomeTier: "FULL_FUNDING", staffId: PULL_STAFF, shiftId: PULL_SHIFT
  }, { id: "evt-live" }), db);
  assert.equal(db.events.length, 1);
  assert.equal(db.events[0].kind, "pull_run");
  assert.equal(db.events[0].staff_id, PULL_STAFF);
  assert.equal(db.events[0].shift_id, PULL_SHIFT);
  assert.equal(db.events[0].detail.outcome_tier, "FULL_FUNDING");
  assert.equal(db.events[0].detail.event_id, "evt-live");
});

test("a replayed pull stores nothing twice and counts nothing twice", async () => {
  const db = pgFake();
  const e = ev("analysis.completed", { email: "a@b.com", outcomeTier: "REPAIR_ONLY", staffId: PULL_STAFF, shiftId: PULL_SHIFT }, { id: "evt-replay" });
  await onAnalysisCompleted(e, db);
  await onAnalysisCompleted(e, db);
  assert.equal(db.crs.length, 1);
  assert.equal(db.events.length, 1, "a replayed pull must not count as a second pull against that person");
});

test("the bureau payload is never copied into the telemetry detail", async () => {
  const db = pgFake();
  await onAnalysisCompleted(ev("analysis.completed", {
    email: "a@b.com", outcomeTier: "REPAIR_ONLY", ssn: "123-45-6789", scores: { ex: 512 },
    staffId: PULL_STAFF, shiftId: PULL_SHIFT
  }, { id: "evt-pii" }), db);
  const detail = JSON.stringify(db.events[0].detail);
  assert.ok(!/123-45-6789|512/.test(detail), `the consumer's credit file leaked into telemetry: ${detail}`);
});

test("with no shift on the event, the runner's open shift is looked up", async () => {
  const db = pgFake({ openShift: PULL_SHIFT });
  await onAnalysisCompleted(ev("analysis.completed", { email: "a@b.com", staffId: PULL_STAFF }, { id: "evt-lookup" }), db);
  assert.equal(db.events[0].shift_id, PULL_SHIFT);
});

test("a broken telemetry write does NOT lose the credit-pull result", async () => {
  const db = pgFake({ failOn: /INSERT INTO staff_events/ });
  const real = console.error; const lines = [];
  console.error = (...a) => lines.push(a.join(" "));
  try {
    await onAnalysisCompleted(ev("analysis.completed", {
      email: "a@b.com", outcomeTier: "REPAIR_ONLY", staffId: PULL_STAFF, shiftId: PULL_SHIFT
    }, { id: "evt-broken" }), db);
  } finally { console.error = real; }
  assert.equal(db.crs.length, 1, "the pull result is the record; it must survive a broken observer");
  assert.equal(db.events.length, 0);
  assert.ok(lines.some((l) => /\[telemetry\].*write_failed/.test(l)), JSON.stringify(lines));
});

// =============================================================================
// CRM CONTACT SYNC — resolveClient wires a new client to a CRM contact id when
// (and only when) the org's sms routing is ghl_relay. See
// src/messaging/crm-contacts.mjs for find-or-create; crm-contacts.test.mjs
// covers that module's own behaviour with a fake fetch. These tests cover the
// wiring: is it called at the right time, with the right guard, and does a
// CRM failure ever block client creation.
// =============================================================================

function fakeCrmFetch(responses) {
  const calls = [];
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (typeof next === "function") return next(url, init);
    const { status = 200, body = {} } = next || {};
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
  };
  impl.calls = calls;
  return impl;
}

test("resolveClient: GHL_API_KEY stores the found-or-created contact id", async () => {
  const db = pgFake({ smsRouting: "ghl_relay" });
  const fetchImpl = fakeCrmFetch({ status: 200, body: { contact: { id: "crm-abc123" }, new: true } });
  const id = await resolveClient(
    db,
    ev("entry.captured", { email: "ghl@x.com", name: "The CRM Contact" }),
    { fetchImpl, env: { ADAPTERS_DRY_RUN: "0", GHL_API_KEY: "test-key" } }
  );
  assert.equal(db.clients.find((c) => c.id === id).ghl_contact_id, "crm-abc123");
  assert.equal(fetchImpl.calls.length, 1, "exactly one CRM call for one new client");
});

test("resolveClient: GHL_API_KEY still syncs when sms is not routed to ghl_relay", async () => {
  const db = pgFake({ smsRouting: "mailgun" });
  const fetchImpl = fakeCrmFetch({ status: 200, body: { contact: { id: "crm-any-route" } } });
  await resolveClient(
    db,
    ev("entry.captured", { email: "any-route@x.com" }),
    { fetchImpl, env: { ADAPTERS_DRY_RUN: "0", GHL_API_KEY: "test-key" } }
  );
  assert.equal(db.clients[0].ghl_contact_id, "crm-any-route");
  assert.equal(fetchImpl.calls.length, 1);
});

test("resolveClient: dry-run without a key stamps a local placeholder", async () => {
  const db = pgFake();
  const fetchImpl = fakeCrmFetch({ status: 200, body: { contact: { id: "should-not" } } });
  await resolveClient(
    db,
    ev("entry.captured", { email: "dry@x.com" }),
    { fetchImpl, env: { ADAPTERS_DRY_RUN: "1" } }
  );
  assert.match(db.clients[0].ghl_contact_id, /^dry-ghl-/);
  assert.equal(fetchImpl.calls.length, 0);
});

test("resolveClient: no key and the fence explicitly down leaves null with a warning stamp", async () => {
  /* The fence has to be named as down here. It defaults to BLOCKED, and with it
     up this path stamps a dry-run placeholder instead — so "no key" and "fence
     up" are two different outcomes and the test has to say which one it means.
     Before the fence defaulted to blocked, `env: {}` meant this case; now it
     means the one below. */
  const db = pgFake({ smsRouting: "ghl_relay" });
  const id = await resolveClient(
    db,
    ev("entry.captured", { email: "nokey@x.com" }),
    { env: { ADAPTERS_DRY_RUN: "0" } } // no CRM key of either name — not invented
  );
  assert.ok(id, "the client is still created");
  assert.equal(db.clients[0].ghl_contact_id, null);
  assert.equal(db.clients[0].custom_fields.ghl_link_missing, true);
});

test("resolveClient: with the fence up, a placeholder is stamped and the CRM is never called", async () => {
  // The regression this whole change exists for: the placeholder branch used to
  // sit below an early return and could not run in production at all.
  const db = pgFake({ smsRouting: "ghl_relay" });
  let called = 0;
  const id = await resolveClient(
    db,
    ev("entry.captured", { email: "fenced@x.com" }),
    { env: { GHL_API_KEY: "a-real-key" }, fetchImpl: async () => { called += 1; return { ok: true, status: 200, text: async () => "{}" }; } }
  );
  assert.ok(id, "the client is still created");
  assert.equal(called, 0, "GOHIGHLEVEL WAS CALLED WITH THE FENCE UP");
  assert.equal(db.clients[0].custom_fields.ghl_link_dry_run, true);
});

test("resolveClient: a CRM request failure never blocks or breaks client creation", async () => {
  const db = pgFake({ smsRouting: "ghl_relay" });
  const fetchImpl = async () => { throw new Error("network is down"); };
  const id = await resolveClient(
    db,
    ev("entry.captured", { email: "crmfail@x.com" }),
    { fetchImpl, env: { ADAPTERS_DRY_RUN: "0", GHL_API_KEY: "test-key" } }
  );
  assert.ok(id, "client creation must survive a CRM transport failure");
  assert.equal(db.clients[0].ghl_contact_id, null);
});

test("resolveClient: existing client with a CRM id is not re-synced", async () => {
  const db = pgFake({ smsRouting: "ghl_relay" });
  const fetchImpl = fakeCrmFetch({ status: 200, body: { contact: { id: "crm-once" } } });
  const opts = { fetchImpl, env: { ADAPTERS_DRY_RUN: "0", GHL_API_KEY: "test-key" } };
  const id1 = await resolveClient(db, ev("entry.captured", { email: "repeat@x.com" }), opts);
  const id2 = await resolveClient(db, ev("survey.submitted", { email: "repeat@x.com" }), opts);
  assert.equal(id1, id2);
  assert.equal(fetchImpl.calls.length, 1, "The CRM is only contacted while ghl_contact_id is still null");
});

test("resolveClient: existing client with null ghl_contact_id gets a backfill sync", async () => {
  const db = pgFake({ smsRouting: "ghl_relay" });
  // Pre-create without going through resolveClient (ClickFunnels-style race).
  db.clients.push({
    id: "cl-pre", org_id: "org-1", email: "pre@x.com",
    first_name: "Pre", last_name: "Existing", custom_fields: {}, outcome_tier: null,
    ghl_contact_id: null
  });
  const fetchImpl = fakeCrmFetch({ status: 200, body: { contact: { id: "crm-backfill" } } });
  const id = await resolveClient(
    db,
    ev("entry.captured", { email: "pre@x.com", name: "Pre Existing" }),
    { fetchImpl, env: { ADAPTERS_DRY_RUN: "0", GHL_API_KEY: "test-key" } }
  );
  assert.equal(id, "cl-pre");
  assert.equal(db.clients[0].ghl_contact_id, "crm-backfill");
  assert.equal(fetchImpl.calls.length, 1);
});


test("analysis.completed: an anchored event reuses the coordinator result", async () => {
  const db = pgFake();
  db.clients.push({
    id: "client-anchor", org_id: "org-1", email: "anchor@example.com",
    first_name: "Anchor", last_name: "Client", ghl_contact_id: "crm-anchor",
    custom_fields: {}, outcome_tier: null
  });
  db.crs.push({ id: "result-anchor", org_id: "org-1", client_id: "client-anchor" });
  db.requests.push({
    id: "request-anchor", org_id: "org-1", client_id: "client-anchor",
    crs_result_id: "result-anchor", status: "fulfilled"
  });

  const event = ev("analysis.completed", {
    crsResultId: "result-anchor", requestId: "request-anchor", outcomeTier: "FULL_FUNDING"
  }, { clientId: "client-anchor", id: "evt-anchor" });
  await onAnalysisCompleted(event, db);
  await onAnalysisCompleted(event, db);
  assert.equal(db.crs.length, 1, "the announcement inserted a second result row");
});

test("analysis.completed: an anchor for another client is refused", async () => {
  const db = pgFake();
  db.clients.push({
    id: "client-anchor", org_id: "org-1", email: "anchor@example.com",
    first_name: "Anchor", last_name: "Client", ghl_contact_id: "crm-anchor",
    custom_fields: {}, outcome_tier: null
  });
  db.crs.push({ id: "result-anchor", org_id: "org-1", client_id: "different-client" });
  await assert.rejects(
    () => onAnalysisCompleted(ev("analysis.completed", {
      crsResultId: "result-anchor", requestId: "request-anchor"
    }, { clientId: "client-anchor" }), db),
    /different org or client/
  );
  assert.equal(db.crs.length, 1);
});

/* GAP 27, measured on the 2026-09-17 live walk. This door stored the phone
 * number exactly as the sign-up form typed it — "(661) 605-4248" — and Twilio
 * refuses anything that is not the international form, so the welcome text, the
 * booking confirmation and a pay link all failed for the two clients who came in
 * through here. The three other sign-up doors already convert on the way in. */
test("resolveClient: a new client's phone number is stored in international form", async () => {
  const db = pgFake();
  const id = await resolveClient(db, ev("entry.captured", {
    email: "shape@example.com", name: "Sim Ten", phone: "(661) 605-4248"
  }));
  assert.equal(db.clients.find((c) => c.id === id).phone, "+16616054248");
});

test("resolveClient: a later webhook fills a blank phone in international form", async () => {
  const db = pgFake();
  const id = await resolveClient(db, ev("entry.captured", { email: "later@example.com" }));
  await resolveClient(db, ev("survey.submitted", {
    email: "later@example.com", phone: "661-605-4248"
  }));
  assert.equal(db.clients.find((c) => c.id === id).phone, "+16616054248");
});

test("resolveClient: a fresh funnel booking replaces stale name and SMS phone on a reused email", async () => {
  const db = pgFake();
  const id = await resolveClient(db, ev("entry.captured", {
    email: "repeat@example.com", name: "Sample Contact", phone: "(202) 555-0123"
  }));
  await resolveClient(db, ev("booking.created", {
    email: "repeat@example.com", name: "Jordan Rivera", phone: "(415) 555-0124",
    source: "clickfunnels"
  }));
  const client = db.clients.find((c) => c.id === id);
  assert.equal(client.first_name, "Jordan");
  assert.equal(client.last_name, "Rivera");
  assert.equal(client.phone, "+14155550124");

  await resolveClient(db, ev("entry.captured", {
    email: "repeat@example.com", name: "Old Contact", phone: "(202) 555-0123",
    source: "clickfunnels", funnel: "unrelated-funnel"
  }));
  assert.equal(client.phone, "+14155550124", "an unrelated contact update must not undo the booking number");
});

test("resolveClient: a fresh apply form replaces stale contact data before booking", async () => {
  const db = pgFake();
  const id = await resolveClient(db, ev("entry.captured", {
    email: "apply@example.com", name: "Sample Contact", phone: "(202) 555-0123"
  }));
  await resolveClient(db, ev("entry.captured", {
    email: "apply@example.com", name: "Jordan Rivera", phone: "415-555-0124",
    source: "clickfunnels", funnel: "apply-survey"
  }));
  const client = db.clients.find((c) => c.id === id);
  assert.equal(client.first_name, "Jordan");
  assert.equal(client.last_name, "Rivera");
  assert.equal(client.phone, "+14155550124");
});

/* A number that cannot be converted is kept exactly as typed — never dropped,
   never guessed at — so a bad number stays visible instead of going quiet. */
test("resolveClient: an unconvertible phone number is stored exactly as typed", async () => {
  const db = pgFake();
  const id = await resolveClient(db, ev("entry.captured", {
    email: "odd@example.com", phone: "ask reception"
  }));
  assert.equal(db.clients.find((c) => c.id === id).phone, "ask reception");
});

test("register wires docs.received to review the checklist", () => {
  register();
  assert.ok(
    getHandlers("docs.received").includes(onDocsReceivedReviewChecklist),
    "docs.received must re-read document-proof waypoints"
  );
});

test("docs.received with no client does not query", async () => {
  const out = await onDocsReceivedReviewChecklist(
    { orgId: "org-1", payload: {} },
    { query: async () => { throw new Error("should not query"); } }
  );
  assert.equal(out, null);
});

test("docs.received reviews open waypoints", async () => {
  const sqls = [];
  const db = {
    async query(sql) {
      sqls.push(sql);
      if (/FROM client_waypoints/.test(sql)) return { rows: [] };
      return { rows: [] };
    }
  };
  const out = await onDocsReceivedReviewChecklist(
    ev("docs.received", { client_id: "550e8400-e29b-41d4-a716-446655440000" }, {
      orgId: "00000000-0000-4000-8000-000000000001",
      clientId: "550e8400-e29b-41d4-a716-446655440000"
    }),
    db
  );
  assert.equal(out.ok, true);
  assert.equal(out.checked, 0);
  assert.ok(sqls.some((s) => /client_waypoints/.test(s)));
});
