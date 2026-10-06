import { test } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import {
  verifyClickFunnelsSignature,
  normalizeClickFunnelsEvent,
  mapToCanonical,
  handleClickFunnelsWebhook,
  wrapApplySurveyIngestBody,
  isApplySurveyIngestBody,
  applySurveyCfContact
} from "./clickfunnels.mjs";
import { _resetOrgCache } from "../events/bus.mjs";
import { on, clearHandlers } from "../events/registry.mjs";

// Fake db — same fakeDb helper as commas.test.mjs.
function fakeDb({ dedup = false, store = [] } = {}) {
  let n = 0;
  return {
    query(sql, params) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      if (/INSERT INTO events/.test(sql)) {
        if (dedup) return { rows: [] };
        const row = { id: `evt-${++n}` };
        store.push({ ...row, name: params[1], payload: params[5] });
        return { rows: [row] };
      }
      return { rows: [] };
    }
  };
}

const SECRET = "whsec_cf_test";
const APPLY_INGEST = "apply_survey_ingest_test";
/** Legacy: HMAC(raw body) — still accepted when timestamp omitted. */
const sign = (raw) => crypto.createHmac("sha256", SECRET).update(raw).digest("hex");
/** CF 2.0 official: HMAC(`${timestamp}.${raw}`). */
const signV2 = (raw, ts) =>
  crypto.createHmac("sha256", SECRET).update(`${ts}.${raw}`).digest("hex");

// --- signature ---------------------------------------------------------------
test("verifyClickFunnelsSignature: accepts valid sig, rejects tampered / missing / no-secret", () => {
  const raw = JSON.stringify({ event: "form_submission" });
  assert.equal(verifyClickFunnelsSignature(raw, sign(raw), SECRET), true);
  assert.equal(verifyClickFunnelsSignature(raw, "sha256=" + sign(raw), SECRET), true); // prefixed variant
  assert.equal(verifyClickFunnelsSignature(raw, sign(raw + "x"), SECRET), false); // tampered
  assert.equal(verifyClickFunnelsSignature(raw, "", SECRET), false);              // missing header
  assert.equal(verifyClickFunnelsSignature(raw, sign(raw), null), false);         // no secret => closed
});

test("verifyClickFunnelsSignature: CF 2.0 timestamp.payload scheme", () => {
  const raw = JSON.stringify({ event_type: "contact.created" });
  const ts = String(Math.floor(Date.now() / 1000));
  assert.equal(verifyClickFunnelsSignature(raw, signV2(raw, ts), SECRET, ts), true);
  assert.equal(verifyClickFunnelsSignature(raw, "sha256=" + signV2(raw, ts), SECRET, ts), true);
  // Wrong: body-only sig against V2 signed payload
  assert.equal(verifyClickFunnelsSignature(raw, sign(raw), SECRET, ts), false);
  // Stale timestamp (>600s)
  const stale = String(Math.floor(Date.now() / 1000) - 601);
  assert.equal(verifyClickFunnelsSignature(raw, signV2(raw, stale), SECRET, stale), false);
});

test("handleClickFunnelsWebhook: CF 2.0 headers (x-webhook-clickfunnels-*) accept", async () => {
  clearHandlers();
  _resetOrgCache();
  const raw = JSON.stringify({
    event_type: "contact.created",
    data: { contact: { email: "v2sig@example.com", first_name: "V2" } }
  });
  const ts = String(Math.floor(Date.now() / 1000));
  const res = await handleClickFunnelsWebhook({
    db: fakeDb(),
    rawBody: raw,
    secret: SECRET,
    headers: {
      "x-webhook-clickfunnels-signature": signV2(raw, ts),
      "x-webhook-clickfunnels-timestamp": ts
    }
  });
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.ok(res.emitted.some((e) => e.name === "entry.captured"));
});

// --- normalize ---------------------------------------------------------------
test("normalizeClickFunnelsEvent: reads CF 2.0 shape (data.contact)", () => {
  const evt = normalizeClickFunnelsEvent({
    id: "sub_abc123",
    event: "contact_created",
    funnel_name: "Free Credit Audit",
    data: {
      contact: {
        email: "JANE@EXAMPLE.COM",
        first_name: "Jane",
        last_name: "Doe",
        phone: "555-123-4567"
      }
    }
  });
  assert.equal(evt.email, "jane@example.com");
  assert.equal(evt.name, "Jane Doe");
  assert.equal(evt.phone, "555-123-4567");
  assert.equal(evt.funnel, "Free Credit Audit");
  assert.equal(evt.id, "sub_abc123");
  assert.equal(evt.answers, null);
  assert.equal(evt.a1, null);
  assert.equal(evt.a2, null);
});

test("normalizeClickFunnelsEvent: extracts a1/a2 referral params from top-level", () => {
  const evt = normalizeClickFunnelsEvent({
    id: "sub_ref1",
    a1: "affiliate-abc",
    a2: "sub-affiliate-xyz",
    data: { contact: { email: "ref@example.com", first_name: "Ref" } }
  });
  assert.equal(evt.a1, "affiliate-abc");
  assert.equal(evt.a2, "sub-affiliate-xyz");
});

test("normalizeClickFunnelsEvent: extracts a1 from formData when top-level is empty", () => {
  const evt = normalizeClickFunnelsEvent({
    id: "sub_ref_form",
    data: {
      contact: { email: "ref2@example.com", first_name: "Ref" },
      formData: { a1: "AFF-000063", business_name: "Acme" }
    }
  });
  assert.equal(evt.a1, "AFF-000063");
});

test("normalizeClickFunnelsEvent: extracts a1 from visit landing URL query", () => {
  const evt = normalizeClickFunnelsEvent({
    id: "sub_ref_visit",
    data: {
      contact: {
        email: "ref3@example.com",
        first_name: "Ref",
        visits: { first_visit: { landing_page: "https://apply.fundhub.ai/watch?a1=AFF-000001&utm_source=fb" } }
      }
    }
  });
  assert.equal(evt.a1, "AFF-000001");
});

test("normalizeClickFunnelsEvent: extracts a1 from custom_attributes.ref alias", () => {
  const evt = normalizeClickFunnelsEvent({
    id: "sub_ref_alias",
    data: {
      contact: {
        email: "ref4@example.com",
        first_name: "Ref",
        custom_attributes: { ref: "AFF-000002" }
      }
    }
  });
  assert.equal(evt.a1, "AFF-000002");
});

test("normalizeClickFunnelsEvent: reads CF Classic top-level contact shape", () => {
  const evt = normalizeClickFunnelsEvent({
    type: "new_purchase",
    contact: {
      email: "bob@example.com",
      full_name: "Bob Smith",
      phone_number: "555-999-0000"
    },
    funnel: "Main Funnel"
  });
  assert.equal(evt.email, "bob@example.com");
  assert.equal(evt.name, "Bob Smith");
  assert.equal(evt.phone, "555-999-0000");
  assert.equal(evt.funnel, "Main Funnel");
});

test("normalizeClickFunnelsEvent: reads survey answers from data.survey_answers", () => {
  const answers = { q1: "Yes", q2: "750+" };
  const evt = normalizeClickFunnelsEvent({
    id: "sub_survey_1",
    data: {
      contact: { email: "alice@example.com", first_name: "Alice", last_name: "A" },
      survey_answers: answers
    }
  });
  assert.deepEqual(evt.answers, answers);
  assert.equal(evt.email, "alice@example.com");
});

test("normalizeClickFunnelsEvent: reads survey from data.formData (CF 2.0 variant)", () => {
  const formData = [{ field: "q1", value: "No" }];
  const evt = normalizeClickFunnelsEvent({
    data: {
      contact: { email: "carol@example.com" },
      formData
    }
  });
  assert.deepEqual(evt.answers, formData);
});

test("normalizeClickFunnelsEvent: CF 2.0 contact row is data (email_address + custom_attributes)", () => {
  const evt = normalizeClickFunnelsEvent({
    event_type: "contact.identified",
    event_id: "cf-evt-1",
    data: {
      id: 99,
      email_address: "Lead@Example.com",
      phone_number: "(602) 555-0151",
      first_name: "Chris",
      last_name: "Seam",
      custom_attributes: {
        cf_svy_planned_use: "Growth",
        sdk_ts: "ignore-me"
      }
    }
  });
  assert.equal(evt.email, "lead@example.com");
  assert.equal(evt.phone, "(602) 555-0151");
  assert.equal(evt.name, "Chris Seam");
  assert.deepEqual(evt.answers, { cf_svy_planned_use: "Growth" });
});

/* F8 / F11, live walk 2026-09-03. CF sends the answer-option row id on
   cf_svy_<key> and the words on cf_svy_<key>_label / _labels. Copying the id
   through verbatim put 207883 on a client-facing slide. The words are already
   in the same payload — resolve there, not on each screen. */
test("normalizeClickFunnelsEvent: an answer-option id resolves to the words CF sent with it", () => {
  const evt = normalizeClickFunnelsEvent({
    event_type: "contact.identified",
    data: {
      email_address: "sim05@example.com",
      custom_attributes: {
        cf_svy_funding_target_amount: 207883,
        cf_svy_funding_target_amount_label: "$200k - $400k",
        cf_svy_has_business: "207918",
        cf_svy_has_business_label: "Yes, 5+ years"
      }
    }
  });
  assert.equal(evt.answers.cf_svy_funding_target_amount, "$200k - $400k");
  assert.equal(evt.answers.cf_svy_has_business, "Yes, 5+ years");
  // The label keys still travel — screens and the fico band reader use them.
  assert.equal(evt.answers.cf_svy_funding_target_amount_label, "$200k - $400k");
});

test("normalizeClickFunnelsEvent: a multi-select id list resolves to its labels", () => {
  const evt = normalizeClickFunnelsEvent({
    event_type: "contact.identified",
    data: {
      email_address: "sim05@example.com",
      custom_attributes: {
        cf_svy_money_change_now: [207897, 207899],
        // CF sends the multi-select labels as a JSON-encoded string.
        cf_svy_money_change_now_labels:
          '["Grow faster (more customers / more reach)","Stability (cover bills / buffer slow weeks)"]'
      }
    }
  });
  assert.deepEqual(evt.answers.cf_svy_money_change_now, [
    "Grow faster (more customers / more reach)",
    "Stability (cover bills / buffer slow weeks)"
  ]);
});

test("normalizeClickFunnelsEvent: an id with no label is kept, and real words are untouched", () => {
  const evt = normalizeClickFunnelsEvent({
    event_type: "contact.identified",
    data: {
      email_address: "sim05@example.com",
      custom_attributes: {
        cf_svy_available_capital: 207975,
        cf_svy_planned_use: "Growth (marketing, inventory, hiring)"
      }
    }
  });
  // Nothing to resolve it with — keep it rather than dropping the answer.
  assert.equal(evt.answers.cf_svy_available_capital, 207975);
  assert.equal(evt.answers.cf_svy_planned_use, "Growth (marketing, inventory, hiring)");
});

test("normalizeClickFunnelsEvent: keeps Facebook UTM from first_visit, drops the click id", () => {
  const evt = normalizeClickFunnelsEvent({
    event_type: "contact.created",
    data: {
      email_address: "ad@example.com",
      first_name: "Ad",
      last_name: "Lead",
      visits: {
        first_visit: {
          landing_page: "https://apply.fundhub.ai/watch?utm_source=fb_ad&fbclid=DROPME",
          referring_domain: "m.facebook.com",
          utm_source: "fb_ad",
          utm_campaign: "oSched%3A+VSL%3A+Funding",
          utm_content: "oVid%3A+3"
        }
      }
    }
  });
  assert.deepEqual(evt.attribution, {
    utm_source: "fb_ad",
    utm_medium: null,
    utm_campaign: "oSched: VSL: Funding",
    utm_content: "oVid: 3",
    utm_term: null,
    landing_path: "/watch",
    referrer_domain: "m.facebook.com"
  });
});

test("normalizeClickFunnelsEvent: form_submission nested appointments_schedule_request", () => {
  const evt = normalizeClickFunnelsEvent({
    event_type: "form_submission.created",
    event_id: "fs-1",
    data: {
      id: 1,
      data: {
        contact: { email: "book@example.com" },
        appointments_schedule_request: {
          name: "Chris Seam",
          email: "Book@Example.com",
          phone_number: "(602) 555-0151",
          start_on: "2026-08-13T01:00:00Z",
          end_on: "2026-08-13T01:30:00Z",
          tzid: "America/Phoenix"
        }
      }
    }
  });
  assert.equal(evt.email, "book@example.com");
  assert.equal(evt.phone, "(602) 555-0151");
  assert.equal(evt.name, "Chris Seam");
  assert.equal(evt.startTime, "2026-08-13T01:00:00Z");
});

// --- mapToCanonical ----------------------------------------------------------
test("mapToCanonical: email-only lead => entry.captured only", () => {
  const names = mapToCanonical({ email: "a@b.com", answers: null }).map((c) => c.name);
  assert.deepEqual(names, ["entry.captured"]);
});

test("mapToCanonical: lead + survey => entry.captured + survey.submitted", () => {
  const names = mapToCanonical({ email: "a@b.com", answers: { q1: "Yes" } }).map((c) => c.name);
  assert.deepEqual(names, ["entry.captured", "survey.submitted"]);
});

test("mapToCanonical: no email => empty array", () => {
  assert.deepEqual(mapToCanonical({ email: "", answers: null }), []);
  assert.deepEqual(mapToCanonical(null), []);
});

test("mapToCanonical: appointment created => booking.created only (no entry.captured)", () => {
  const names = mapToCanonical({
    email: "a@b.com",
    type: "appointments/scheduled_event.created",
    answers: null
  }).map((c) => c.name);
  assert.deepEqual(names, ["booking.created"]);
});

test("mapToCanonical: appointment rescheduled => booking.rescheduled only", () => {
  const names = mapToCanonical({
    email: "a@b.com",
    type: "appointments/scheduled_event.rescheduled"
  }).map((c) => c.name);
  assert.deepEqual(names, ["booking.rescheduled"]);
});

test("mapToCanonical: appointment canceled => booking.cancelled only", () => {
  const names = mapToCanonical({
    email: "a@b.com",
    type: "appointments/scheduled_event.canceled"
  }).map((c) => c.name);
  assert.deepEqual(names, ["booking.cancelled"]);
});

test("mapToCanonical: form_submission with startTime => booking.created only", () => {
  const names = mapToCanonical({
    email: "book@example.com",
    type: "form_submission.created",
    startTime: "2026-08-13T01:00:00Z",
    answers: null
  }).map((c) => c.name);
  assert.deepEqual(names, ["booking.created"]);
});

test("mapToCanonical: form_submission without startTime stays entry.captured", () => {
  const names = mapToCanonical({
    email: "lead@example.com",
    type: "form_submission.created",
    answers: null
  }).map((c) => c.name);
  assert.deepEqual(names, ["entry.captured"]);
});

test("normalizeClickFunnelsEvent: appointment reads data.primary_contact + slot fields", () => {
  const evt = normalizeClickFunnelsEvent({
    id: "appt_99",
    event: "appointments/scheduled_event.created",
    data: {
      start_on: "2026-08-10T15:00:00Z",
      end_on: "2026-08-10T15:30:00Z",
      tzid: "America/Los_Angeles",
      event_type: { name: "Strategy Session" },
      primary_contact: {
        email_address: "BOOK@EXAMPLE.COM",
        first_name: "Book",
        last_name: "Me",
        phone_number: "555-222-3333"
      }
    }
  });
  assert.equal(evt.email, "book@example.com");
  assert.equal(evt.name, "Book Me");
  assert.equal(evt.phone, "555-222-3333");
  assert.equal(evt.type, "appointments/scheduled_event.created");
  assert.equal(evt.startTime, "2026-08-10T15:00:00Z");
  assert.equal(evt.endTime, "2026-08-10T15:30:00Z");
  assert.equal(evt.tzid, "America/Los_Angeles");
  assert.equal(evt.funnel, "Strategy Session");
  assert.equal(evt.bookingUid, "appt_99");
  assert.equal(evt.answers, null);
});

// --- full adapter ------------------------------------------------------------
test("wrapApplySurveyIngestBody: flat handoff payload → CF contact.custom_attributes", () => {
  assert.equal(isApplySurveyIngestBody({ funnel: "apply-survey" }), true);
  const wrapped = wrapApplySurveyIngestBody({
    funnel: "apply-survey",
    step_key: "cf_svy_funding_target_amount",
    email: "Lead@Example.com",
    name: "Jane Doe",
    phone: "555-123-4567",
    answers: { cf_svy_funding_target_amount: "$200k - $400k" },
    a1: "AFF-1",
    attribution: { utm_source: "meta", landing_path: "/apply" }
  });
  assert.equal(wrapped.data.email_address, "lead@example.com");
  assert.equal(wrapped.data.custom_attributes.cf_svy_funding_target_amount, "$200k - $400k");
  assert.equal(wrapped.data.custom_attributes.utm_source, "meta");
  assert.equal(wrapped.data.custom_attributes.a1, "AFF-1");
});

test("applySurveyCfContact: name, phone, cf_svy labels; multi-select is a JSON list", () => {
  const contact = applySurveyCfContact({
    source: "apply-survey",
    funnel: "apply-survey",
    email: "Lead@Example.com",
    name: "Jane Doe",
    phone: "(480) 555-1234",
    answers: {
      cf_svy_funding_target_amount: "$200k - $400k",
      cf_svy_money_change_now: [
        "Peace of mind (stop stressing about cash)",
        "Grow faster (more customers / more reach)"
      ],
      ssn: "123-45-6789"
    },
    a1: "AFF-1",
    attribution: { utm_source: "meta", landing_path: "/apply" }
  });
  assert.equal(contact.email_address, "lead@example.com");
  assert.equal(contact.first_name, "Jane");
  assert.equal(contact.last_name, "Doe");
  assert.equal(contact.phone_number, "(480) 555-1234");
  assert.equal(contact.custom_attributes.cf_svy_funding_target_amount, "$200k - $400k");
  assert.equal(
    contact.custom_attributes.cf_svy_money_change_now,
    JSON.stringify([
      "Peace of mind (stop stressing about cash)",
      "Grow faster (more customers / more reach)"
    ])
  );
  assert.equal(contact.custom_attributes.utm_source, "meta");
  assert.equal(contact.custom_attributes.landing_path, "/apply");
  assert.equal(contact.custom_attributes.a1, "AFF-1");
  assert.equal(contact.custom_attributes.ssn, undefined);
  assert.equal(JSON.stringify(contact).includes("123-45-6789"), false);
  for (const v of Object.values(contact.custom_attributes)) {
    assert.equal(typeof v, "string");
  }
  assert.equal(applySurveyCfContact({ funnel: "other" }), null);
  assert.equal(applySurveyCfContact({ funnel: "apply-survey" }), null);
});

test("normalizeClickFunnelsEvent: JSON list on a cf_svy key comes back as labels", () => {
  const evt = normalizeClickFunnelsEvent({
    event_type: "contact.updated",
    data: {
      email_address: "lead@example.com",
      custom_attributes: {
        cf_svy_money_change_now: JSON.stringify([
          "Peace of mind (stop stressing about cash)"
        ]),
        cf_svy_money_change_now_labels:
          '["Grow faster (more customers / more reach)"]'
      }
    }
  });
  assert.deepEqual(evt.answers.cf_svy_money_change_now, [
    "Peace of mind (stop stressing about cash)"
  ]);
  assert.equal(
    evt.answers.cf_svy_money_change_now_labels,
    '["Grow faster (more customers / more reach)"]'
  );
});

test("handleClickFunnelsWebhook: apply-survey browser ingest uses ingest secret, not CF HMAC", async () => {
  _resetOrgCache();
  clearHandlers();
  const raw = JSON.stringify({
    source: "apply-survey",
    funnel: "apply-survey",
    step_key: "contact",
    email: "browser@example.com",
    name: "Browser Lead",
    phone: "5550001111",
    answers: {},
    a1: null,
    a2: null,
    attribution: {}
  });
  const bad = await handleClickFunnelsWebhook({
    db: fakeDb(),
    rawBody: raw,
    signatureHeader: "",
    secret: SECRET,
    headers: {},
    env: { CLICKFUNNELS_APPLY_SURVEY_INGEST_SECRET: APPLY_INGEST }
  });
  assert.equal(bad.status, 401);

  const res = await handleClickFunnelsWebhook({
    db: fakeDb(),
    rawBody: raw,
    signatureHeader: "",
    secret: SECRET,
    headers: { "x-fundhub-apply-survey-ingest": APPLY_INGEST },
    env: { CLICKFUNNELS_APPLY_SURVEY_INGEST_SECRET: APPLY_INGEST }
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.emitted.map((e) => e.name), ["entry.captured"]);
});

test("handleClickFunnelsWebhook: apply-survey step with cf_svy_* emits survey.submitted", async () => {
  _resetOrgCache();
  clearHandlers();
  const raw = JSON.stringify({
    funnel: "apply-survey",
    step_key: "cf_svy_planned_use",
    email: "browser2@example.com",
    name: "Quiz Taker",
    phone: "5557778888",
    answers: { cf_svy_planned_use: "Growth (marketing, inventory, hiring)" },
    attribution: { utm_campaign: "slo" }
  });
  const res = await handleClickFunnelsWebhook({
    db: fakeDb(),
    rawBody: raw,
    signatureHeader: sign(raw),
    secret: SECRET,
    headers: { "x-fundhub-apply-survey-ingest": APPLY_INGEST },
    env: { CLICKFUNNELS_APPLY_SURVEY_INGEST_SECRET: APPLY_INGEST }
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.emitted.map((e) => e.name), ["entry.captured", "survey.submitted"]);
});

test("handleClickFunnelsWebhook: apply-survey upserts the ClickFunnels contact and still emits", async () => {
  const raw = JSON.stringify({
    source: "apply-survey",
    funnel: "apply-survey",
    step_key: "cf_svy_funding_target_amount",
    email: "browser@example.com",
    name: "Browser Lead",
    phone: "(480) 555-1234",
    answers: { cf_svy_funding_target_amount: "$200k - $400k" },
    a1: "AFF-1",
    attribution: { utm_source: "meta" }
  });
  const cfEnv = {
    CLICKFUNNELS_APPLY_SURVEY_INGEST_SECRET: APPLY_INGEST,
    CLICKFUNNELS_API_KEY: "test-key",
    CLICKFUNNELS_SUBDOMAIN: "myworkspace",
    CLICKFUNNELS_WORKSPACE_ID: "42",
    // The contact upsert is a vendor write behind the ADAPTERS fence
    // (src/analytics/clickfunnels.mjs upsertContact); live means switched off.
    ADAPTERS_DRY_RUN: "0"
  };
  const headers = { "x-fundhub-apply-survey-ingest": APPLY_INGEST };

  _resetOrgCache();
  clearHandlers();
  const calls = [];
  const res = await handleClickFunnelsWebhook({
    db: fakeDb(),
    rawBody: raw,
    signatureHeader: "",
    secret: SECRET,
    headers,
    env: cfEnv,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: 77, email_address: "browser@example.com" }),
        headers: { get: () => null }
      };
    }
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.emitted.map((e) => e.name), ["entry.captured", "survey.submitted"]);
  assert.equal(res.clickfunnelsContact.id, 77);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/workspaces\/42\/contacts\/upsert$/);
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.contact.email_address, "browser@example.com");
  assert.equal(sent.contact.first_name, "Browser");
  assert.equal(sent.contact.last_name, "Lead");
  assert.equal(sent.contact.phone_number, "(480) 555-1234");
  assert.equal(sent.contact.custom_attributes.cf_svy_funding_target_amount, "$200k - $400k");
  assert.equal(sent.contact.custom_attributes.a1, "AFF-1");
  assert.equal(sent.contact.custom_attributes.utm_source, "meta");
  assert.equal(calls[0].init.headers.authorization, "Bearer test-key");

  _resetOrgCache();
  clearHandlers();
  const skipped = await handleClickFunnelsWebhook({
    db: fakeDb(),
    rawBody: raw,
    signatureHeader: "",
    secret: SECRET,
    headers,
    env: { CLICKFUNNELS_APPLY_SURVEY_INGEST_SECRET: APPLY_INGEST },
    fetchImpl: async () => {
      throw new Error("should not call ClickFunnels");
    }
  });
  assert.equal(skipped.status, 200);
  assert.equal(skipped.clickfunnelsContact.skipped, true);
  assert.deepEqual(skipped.emitted.map((e) => e.name), ["entry.captured", "survey.submitted"]);

  _resetOrgCache();
  clearHandlers();
  const refused = await handleClickFunnelsWebhook({
    db: fakeDb(),
    rawBody: raw,
    signatureHeader: "",
    secret: SECRET,
    headers,
    env: cfEnv,
    fetchImpl: async () => ({
      ok: false,
      status: 422,
      text: async () => JSON.stringify({ error: "nope" }),
      headers: { get: () => null }
    })
  });
  assert.equal(refused.status, 200);
  assert.equal(refused.clickfunnelsContact.ok, false);
  assert.equal(refused.clickfunnelsContact.error, "clickfunnels_refused");
  assert.deepEqual(refused.emitted.map((e) => e.name), ["entry.captured", "survey.submitted"]);

  _resetOrgCache();
  clearHandlers();
  let echoCalls = 0;
  const nativeRaw = JSON.stringify({
    id: "cf_echo_1",
    event_type: "contact.updated",
    data: {
      email_address: "browser@example.com",
      first_name: "Browser",
      last_name: "Lead",
      custom_attributes: { cf_svy_funding_target_amount: "$200k - $400k" }
    }
  });
  const echo = await handleClickFunnelsWebhook({
    db: fakeDb(),
    rawBody: nativeRaw,
    signatureHeader: sign(nativeRaw),
    secret: SECRET,
    headers: {},
    env: cfEnv,
    fetchImpl: async () => {
      echoCalls += 1;
      return { ok: true, status: 200, text: async () => "{}", headers: { get: () => null } };
    }
  });
  assert.equal(echo.ok, true);
  assert.equal(echoCalls, 0);
  assert.equal(echo.clickfunnelsContact, null);
});

test("handleClickFunnelsWebhook: bad signature => 401, no emit", async () => {
  _resetOrgCache(); clearHandlers();
  const raw = JSON.stringify({ event: "form_submission", data: { contact: { email: "x@y.com" } } });
  const res = await handleClickFunnelsWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: "bad", secret: SECRET });
  assert.equal(res.ok, false);
  assert.equal(res.status, 401);
  assert.equal(res.emitted.length, 0);
});

test("handleClickFunnelsWebhook: lead without survey => entry.captured only, handler fires", async () => {
  _resetOrgCache(); clearHandlers();
  const seen = [];
  on("entry.captured", (e) => seen.push(e.name));
  const raw = JSON.stringify({
    id: "cf_lead_1",
    event: "contact_created",
    funnel_name: "Free Audit Funnel",
    data: { contact: { email: "lead@example.com", first_name: "Lead", last_name: "User", phone: "555-000-1111" } }
  });
  const res = await handleClickFunnelsWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.deepEqual(res.emitted.map((e) => e.name), ["entry.captured"]);
  assert.deepEqual(seen, ["entry.captured"]);
});

test("handleClickFunnelsWebhook: lead + survey => entry.captured + survey.submitted, both handlers fire", async () => {
  _resetOrgCache(); clearHandlers();
  const seen = [];
  on("entry.captured", (e) => seen.push(e.name));
  on("survey.submitted", (e) => seen.push(e.name));
  const raw = JSON.stringify({
    id: "cf_survey_42",
    event: "form_submission",
    data: {
      contact: { email: "quiz@example.com", first_name: "Quiz", last_name: "Taker", phone: "555-777-8888" },
      survey_answers: { q1: "Yes", q2: "Good" }
    }
  });
  const res = await handleClickFunnelsWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, true);
  assert.deepEqual(res.emitted.map((e) => e.name), ["entry.captured", "survey.submitted"]);
  assert.deepEqual(seen.sort(), ["entry.captured", "survey.submitted"]);
  // survey payload includes answers
  assert.equal(res.emitted.find((e) => e.name === "survey.submitted") !== undefined, true);
});

test("handleClickFunnelsWebhook: a1/a2 referral params flow into entry.captured payload", async () => {
  _resetOrgCache(); clearHandlers();
  const store = [];
  const db = {
    query(sql, params) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      if (/INSERT INTO events/.test(sql)) {
        store.push({ name: params[1], payload: params[5] });
        return { rows: [{ id: "evt-1" }] };
      }
      return { rows: [] };
    }
  };
  const raw = JSON.stringify({
    id: "cf_ref_42",
    a1: "tier1-aff",
    a2: "tier2-aff",
    event: "contact_created",
    data: { contact: { email: "reftest@example.com", first_name: "Ref" } }
  });
  const res = await handleClickFunnelsWebhook({ db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, true);
  const entryPayload = store.find((r) => r.name === "entry.captured")?.payload;
  assert.equal(entryPayload?.a1, "tier1-aff");
  assert.equal(entryPayload?.a2, "tier2-aff");
});

test("handleClickFunnelsWebhook: appointment created => booking.created, no entry.captured", async () => {
  _resetOrgCache(); clearHandlers();
  const store = [];
  const seen = [];
  on("booking.created", (e) => seen.push(e.name));
  on("entry.captured", (e) => seen.push(e.name));
  const db = {
    query(sql, params) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      if (/INSERT INTO events/.test(sql)) {
        store.push({ name: params[1], payload: params[5] });
        return { rows: [{ id: "evt-1" }] };
      }
      return { rows: [] };
    }
  };
  const raw = JSON.stringify({
    id: "cf_appt_1",
    event: "appointments/scheduled_event.created",
    data: {
      start_on: "2026-08-12T18:00:00Z",
      end_on: "2026-08-12T18:30:00Z",
      tzid: "America/New_York",
      event_type: { name: "Closer Call" },
      primary_contact: {
        email_address: "appt@example.com",
        first_name: "Appt",
        last_name: "Lead",
        phone_number: "555-444-5555"
      }
    }
  });
  const res = await handleClickFunnelsWebhook({ db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, true);
  assert.deepEqual(res.emitted.map((e) => e.name), ["booking.created"]);
  assert.deepEqual(seen, ["booking.created"]);
  const payload = store.find((r) => r.name === "booking.created")?.payload;
  assert.deepEqual(payload, {
    bookingUid: "cf_appt_1",
    startTime: "2026-08-12T18:00:00Z",
    endTime: "2026-08-12T18:30:00Z",
    email: "appt@example.com",
    name: "Appt Lead",
    phone: "555-444-5555",
    meetingUrl: null,
    rescheduleUid: null,
    source: "clickfunnels"
  });
});

test("handleClickFunnelsWebhook: form_submission with nested schedule => booking.created with email", async () => {
  _resetOrgCache(); clearHandlers();
  const store = [];
  const seen = [];
  on("booking.created", (e) => seen.push(e.name));
  on("entry.captured", (e) => seen.push(e.name));
  const db = {
    query(sql, params) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      if (/INSERT INTO events/.test(sql)) {
        store.push({ name: params[1], payload: params[5] });
        return { rows: [{ id: "evt-1" }] };
      }
      if (/FROM bookings/.test(sql)) return { rows: [] };
      return { rows: [] };
    }
  };
  const raw = JSON.stringify({
    event_type: "form_submission.created",
    event_id: "fs-book-1",
    data: {
      id: 1,
      data: {
        contact: { email: "book@example.com" },
        appointments_schedule_request: {
          name: "Chris Seam",
          email: "Book@Example.com",
          phone_number: "(602) 555-0151",
          start_on: "2026-08-13T01:00:00Z",
          end_on: "2026-08-13T01:30:00Z",
          tzid: "America/Phoenix"
        }
      }
    }
  });
  const res = await handleClickFunnelsWebhook({ db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, true);
  assert.deepEqual(res.emitted.map((e) => e.name), ["booking.created"]);
  assert.deepEqual(seen, ["booking.created"]);
  const payload = store.find((r) => r.name === "booking.created")?.payload;
  assert.equal(payload.email, "book@example.com");
  assert.equal(payload.startTime, "2026-08-13T01:00:00Z");
  assert.equal(payload.source, "clickfunnels");
});

test("handleClickFunnelsWebhook: appointment after same slot does not emit a second booking.created", async () => {
  _resetOrgCache(); clearHandlers();
  const seen = [];
  on("booking.created", (e) => seen.push(e.name));
  let eventInserts = 0;
  const db = {
    query(sql) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      if (/FROM bookings/.test(sql)) {
        return { rows: [{ id: "bk-1", client_id: "client-1", provider_uid: "fs-book-1" }] };
      }
      if (/UPDATE bookings/.test(sql)) return { rows: [] };
      if (/UPDATE tasks/.test(sql)) return { rows: [] };
      if (/INSERT INTO events/.test(sql)) {
        eventInserts += 1;
        return { rows: [{ id: "evt-should-not" }] };
      }
      return { rows: [] };
    }
  };
  const raw = JSON.stringify({
    id: "cf_appt_later",
    event: "appointments/scheduled_event.created",
    data: {
      start_on: "2026-08-13T01:00:00Z",
      end_on: "2026-08-13T01:30:00Z",
      primary_contact: {
        email_address: "book@example.com",
        first_name: "Chris",
        last_name: "Seam"
      }
    }
  });
  const res = await handleClickFunnelsWebhook({ db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, true);
  assert.equal(res.emitted[0].deduped, true);
  assert.equal(eventInserts, 0);
  assert.deepEqual(seen, []);
});

test("handleClickFunnelsWebhook: appointment canceled => booking.cancelled only", async () => {
  _resetOrgCache(); clearHandlers();
  const seen = [];
  on("booking.cancelled", (e) => seen.push(e.name));
  on("entry.captured", (e) => seen.push(e.name));
  const raw = JSON.stringify({
    id: "cf_appt_cancel",
    event: "appointments/scheduled_event.canceled",
    data: {
      start_on: "2026-08-12T18:00:00Z",
      end_on: "2026-08-12T18:30:00Z",
      primary_contact: { email_address: "cancel@example.com", first_name: "C" }
    }
  });
  const res = await handleClickFunnelsWebhook({
    db: fakeDb(),
    rawBody: raw,
    signatureHeader: sign(raw),
    secret: SECRET
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.emitted.map((e) => e.name), ["booking.cancelled"]);
  assert.deepEqual(seen, ["booking.cancelled"]);
});

test("handleClickFunnelsWebhook: no_email => 200, no emit", async () => {
  _resetOrgCache(); clearHandlers();
  const raw = JSON.stringify({ id: "cf_noemail", event: "form_submission", data: { contact: { first_name: "Ghost" } } });
  const res = await handleClickFunnelsWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.equal(res.reason, "no_email");
  assert.equal(res.emitted.length, 0);
});

// --- CF_CAPTURE_MODE ----------------------------------------------------------
test("handleClickFunnelsWebhook: CF_CAPTURE_MODE=1 inserts a webhook_captures row and still emits normally", async () => {
  _resetOrgCache(); clearHandlers();
  const captures = [];
  const seen = [];
  on("entry.captured", (e) => seen.push(e.name));
  const db = {
    query(sql, params) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      if (/INSERT INTO webhook_captures/.test(sql)) {
        captures.push({ provider: params[0], headers: params[1], rawBody: params[2], parsed: params[3] });
        return { rows: [] };
      }
      if (/INSERT INTO events/.test(sql)) return { rows: [{ id: "evt-1" }] };
      return { rows: [] };
    }
  };
  const raw = JSON.stringify({
    id: "cf_capture_1",
    event: "contact_created",
    data: { contact: { email: "captured@example.com", first_name: "Cap" } }
  });
  const prev = process.env.CF_CAPTURE_MODE;
  process.env.CF_CAPTURE_MODE = "1";
  try {
    const res = await handleClickFunnelsWebhook({ db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
    assert.equal(res.ok, true);
    assert.deepEqual(res.emitted.map((e) => e.name), ["entry.captured"]);
    assert.deepEqual(seen, ["entry.captured"]);
    assert.equal(captures.length, 1);
    assert.equal(captures[0].provider, "clickfunnels");
    assert.equal(captures[0].rawBody, raw);
    assert.equal(JSON.parse(captures[0].parsed).id, "cf_capture_1");
  } finally {
    if (prev === undefined) delete process.env.CF_CAPTURE_MODE;
    else process.env.CF_CAPTURE_MODE = prev;
  }
});

test("handleClickFunnelsWebhook: capture failure is non-fatal — processing still completes", async () => {
  _resetOrgCache(); clearHandlers();
  const seen = [];
  on("entry.captured", (e) => seen.push(e.name));
  const db = {
    query(sql, params) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      if (/INSERT INTO webhook_captures/.test(sql)) throw new Error("capture table unavailable");
      if (/INSERT INTO events/.test(sql)) return { rows: [{ id: "evt-1" }] };
      return { rows: [] };
    }
  };
  const raw = JSON.stringify({
    id: "cf_capture_fail",
    event: "contact_created",
    data: { contact: { email: "stillworks@example.com" } }
  });
  const prev = process.env.CF_CAPTURE_MODE;
  process.env.CF_CAPTURE_MODE = "1";
  try {
    const res = await handleClickFunnelsWebhook({ db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
    assert.equal(res.ok, true);
    assert.deepEqual(res.emitted.map((e) => e.name), ["entry.captured"]);
    assert.deepEqual(seen, ["entry.captured"]);
  } finally {
    if (prev === undefined) delete process.env.CF_CAPTURE_MODE;
    else process.env.CF_CAPTURE_MODE = prev;
  }
});

test("handleClickFunnelsWebhook: CF_CAPTURE_MODE unset — no capture insert", async () => {
  _resetOrgCache(); clearHandlers();
  let captureCalls = 0;
  const db = {
    query(sql) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      if (/INSERT INTO webhook_captures/.test(sql)) { captureCalls += 1; return { rows: [] }; }
      if (/INSERT INTO events/.test(sql)) return { rows: [{ id: "evt-1" }] };
      return { rows: [] };
    }
  };
  const raw = JSON.stringify({
    id: "cf_no_capture",
    event: "contact_created",
    data: { contact: { email: "nocapture@example.com" } }
  });
  delete process.env.CF_CAPTURE_MODE;
  const res = await handleClickFunnelsWebhook({ db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, true);
  assert.equal(captureCalls, 0, "no capture insert when CF_CAPTURE_MODE is unset");
});

test("handleClickFunnelsWebhook: idempotent re-delivery (deduped, no handler dispatch)", async () => {
  _resetOrgCache(); clearHandlers();
  let fired = 0;
  on("entry.captured", () => (fired += 1));
  const raw = JSON.stringify({
    id: "cf_idem_1",
    event: "contact_created",
    data: { contact: { email: "idem@example.com" } }
  });
  const db = fakeDb({ dedup: true });
  const res = await handleClickFunnelsWebhook({ db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.ok(res.emitted.every((e) => e.deduped === true), "all events must be deduped");
  assert.equal(fired, 0, "handler must not fire on deduped replay");
});

test("handleClickFunnelsWebhook: signed paid order writes a sale from the SLO map, not email", async () => {
  _resetOrgCache();
  clearHandlers();
  const CLIENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const PRODUCT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const store = { sales: [] };
  const db = {
    query(sql, params) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      if (/FROM slo_connections/.test(sql)) {
        return { rows: [{ id: "conn-1", product_id: PRODUCT, product_name: "Funding Bundle", active: true }] };
      }
      if (/FROM clients/.test(sql)) return { rows: [{ id: CLIENT }] };
      if (/FROM sales/.test(sql)) return { rows: store.sales };
      if (/INSERT INTO transactions/.test(sql)) return { rows: [{ id: "tx-1" }] };
      if (/INSERT INTO sales/.test(sql)) {
        const row = { id: "sale-1", client_id: params[1], product_id: params[2], agreed_price: params[3], external_ref: params[4] };
        store.sales.push(row);
        return { rows: [row] };
      }
      if (/INSERT INTO sale_payments/.test(sql)) return { rows: [{ id: "pay-1" }] };
      if (/INSERT INTO events/.test(sql)) return { rows: [{ id: "evt-1" }] };
      return { rows: [] };
    }
  };
  const raw = JSON.stringify({
    event_id: "slo-sim-paid-1",
    event_type: "order.completed",
    funnel_id: "funnel-slo-1",
    data: {
      id: 9001,
      amount_cents: 19700,
      contact: {
        email: "wrong-person@example.com",
        custom_attributes: { fundhub_client_id: CLIENT }
      },
      line_items: [{ product_id: "cf-prod-slo-1" }]
    }
  });
  const res = await handleClickFunnelsWebhook({
    db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET
  });
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.equal(res.purchase.reason, "recorded");
  assert.equal(store.sales.length, 1);
  assert.equal(store.sales[0].client_id, CLIENT);
  assert.equal(store.sales[0].product_id, PRODUCT);
  assert.equal(Number(store.sales[0].agreed_price), 197);
});

/* ── F39: the client is attached at ingest, and one survey starts one run ──────
 *
 * Measured on 2026-09-03: 82 survey.submitted rows, 95 entry.captured rows and
 * 6 booking.created rows in production, EVERY ONE with client_id NULL, and 51
 * duplicate "you never booked" texts to clients who had booked. Both halves are
 * pinned here.
 *
 * This fake stores events the way Postgres does — org, name, idempotency key,
 * client id and payload — and answers the repeat look-back from that store, so
 * the assertions below are about the adapter's real behaviour and not about a
 * stub returning what the test wants.
 */
function funnelDb({ existingClient = { id: "cl-77", email: "runaway@example.com" } } = {}) {
  const events = [];
  const clients = existingClient ? [existingClient] : [];
  let n = 0;
  return {
    events,
    clients,
    async query(sql, params = []) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      // resolveClient: find by email
      if (/SELECT id, ghl_contact_id FROM clients/.test(sql)) {
        const c = clients.find((c) => String(c.email).toLowerCase() === params[1]);
        return { rows: c ? [{ id: c.id, ghl_contact_id: "crm-1" }] : [] };
      }
      if (/INSERT INTO clients/.test(sql)) {
        const id = "cl-new-" + ++n;
        clients.push({ id, email: params[1] });
        return { rows: [{ id }] };
      }
      if (/SELECT id, ghl_contact_id, email, phone, first_name, last_name/.test(sql)) {
        const c = clients.find((c) => c.id === params[0]);
        return { rows: c ? [{ ...c, ghl_contact_id: "crm-1" }] : [] };
      }
      if (/UPDATE clients/.test(sql)) return { rows: [] };
      // the repeat look-back
      if (/SELECT 1\s+FROM events/.test(sql)) {
        const [orgId, name, email, funnel] = params;
        const hit = events.find((e) =>
          e.org_id === orgId
          && e.name === name
          && String(e.payload?.email || "").toLowerCase() === email
          && String(e.payload?.funnel || "") === funnel);
        return { rows: hit ? [{ ok: 1 }] : [] };
      }
      if (/INSERT INTO events/.test(sql)) {
        const [org_id, name, version, idem, client_id, payload] = params;
        if (idem && events.some((e) => e.org_id === org_id && e.idempotency_key === idem)) {
          return { rows: [] };
        }
        const id = "evt-" + ++n;
        events.push({ id, org_id, name, version, idempotency_key: idem, client_id, payload });
        return { rows: [{ id }] };
      }
      return { rows: [] };
    }
  };
}

const surveyBody = (id) => JSON.stringify({
  id,
  event: "contact_created",
  funnel_name: "funding-apply",
  data: {
    contact: {
      email: "runaway@example.com",
      first_name: "Runaway",
      phone: "555-000-1111",
      custom_attributes: { cf_svy_available_capital: "50k" }
    }
  }
});

test("F39: entry.captured and survey.submitted are stored WITH the client id", async () => {
  _resetOrgCache(); clearHandlers();
  const db = funnelDb();
  const raw = surveyBody("cf_survey_screen_1");
  const res = await handleClickFunnelsWebhook({
    db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.emitted.map((e) => e.name), ["entry.captured", "survey.submitted"]);
  // The defect: these two rows used to carry client_id = null.
  assert.equal(db.events.length, 2);
  for (const row of db.events) assert.equal(row.client_id, "cl-77");
});

test("F39: a booking.created is stored WITH the client id", async () => {
  _resetOrgCache(); clearHandlers();
  const db = funnelDb();
  const raw = JSON.stringify({
    id: "cf_appt_client",
    event: "appointments/scheduled_event.created",
    data: {
      start_on: "2026-09-20T18:00:00Z",
      end_on: "2026-09-20T18:30:00Z",
      primary_contact: { email_address: "runaway@example.com", first_name: "Runaway" }
    }
  });
  const res = await handleClickFunnelsWebhook({
    db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET
  });
  assert.equal(res.ok, true);
  const booking = db.events.find((e) => e.name === "booking.created");
  assert.ok(booking, "booking.created must be recorded");
  assert.equal(booking.client_id, "cl-77");
});

test("F39: sixteen ClickFunnels posts for one survey start exactly ONE workflow run", async () => {
  _resetOrgCache(); clearHandlers();
  const db = funnelDb();
  const results = [];
  for (let i = 1; i <= 16; i++) {
    // Each screen posts under its own CF submission id — that is why the
    // idempotency key alone never collapsed them.
    const raw = surveyBody(`cf_survey_screen_${i}`);
    results.push(await handleClickFunnelsWebhook({
      db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET
    }));
  }

  const surveys = results.map((r) => r.emitted.find((e) => e.name === "survey.submitted"));
  const entries = results.map((r) => r.emitted.find((e) => e.name === "entry.captured"));

  // ONE run each. This is the 51-texts defect, measured.
  assert.equal(surveys.filter((e) => e.startedRun).length, 1);
  assert.equal(entries.filter((e) => e.startedRun).length, 1);
  assert.equal(surveys[0].startedRun, true);
  assert.equal(surveys[15].startedRun, false);

  // ...and NOTHING is thrown away: every post is still stored, so the answers
  // the later screens carry still reach the client record.
  assert.equal(db.events.filter((e) => e.name === "survey.submitted").length, 16);
  assert.equal(db.events.filter((e) => e.name === "entry.captured").length, 16);
  assert.ok(db.events.every((e) => e.client_id === "cl-77"));
});

test("F39: a genuinely new lead on a different funnel still starts its own run", async () => {
  _resetOrgCache(); clearHandlers();
  const db = funnelDb();
  const first = surveyBody("cf_a");
  await handleClickFunnelsWebhook({ db, rawBody: first, signatureHeader: sign(first), secret: SECRET });

  const other = JSON.stringify({
    id: "cf_b",
    event: "contact_created",
    funnel_name: "repair-apply",
    data: { contact: { email: "runaway@example.com", first_name: "Runaway", custom_attributes: { cf_svy_available_capital: "10k" } } }
  });
  const res = await handleClickFunnelsWebhook({ db, rawBody: other, signatureHeader: sign(other), secret: SECRET });
  assert.equal(res.emitted.find((e) => e.name === "survey.submitted").startedRun, true);
});

/* The proof that `startedRun: false` is not just a label the adapter writes on
   itself. A durable workflow run begins when the bus hands the event to Inngest
   — src/events/bus.mjs, the `inngest.send` at the end of emit(). This counts
   those sends for real. */
test("F39: sixteen posts produce ONE Inngest fan-out for survey.submitted", async () => {
  _resetOrgCache(); clearHandlers();
  const { inngest } = await import("../workflows/client.mjs");
  const realSend = inngest.send;
  const realKey = process.env.INNGEST_EVENT_KEY;
  const sends = [];
  inngest.send = async (payload) => { sends.push(payload); return { ids: [] }; };
  process.env.INNGEST_EVENT_KEY = "test-key";
  try {
    const db = funnelDb();
    for (let i = 1; i <= 16; i++) {
      const raw = surveyBody(`cf_fanout_${i}`);
      await handleClickFunnelsWebhook({ db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
    }
    assert.equal(sends.filter((s) => s.name === "survey.submitted").length, 1);
    assert.equal(sends.filter((s) => s.name === "entry.captured").length, 1);
    // and the fan-out carries the client, so the workflow knows who it is for
    assert.equal(sends[0].data.clientId, "cl-77");
  } finally {
    inngest.send = realSend;
    if (realKey === undefined) delete process.env.INNGEST_EVENT_KEY;
    else process.env.INNGEST_EVENT_KEY = realKey;
  }
});

/* ── Meta click ids (Phase 4, docs/tracking/meta-events.md "Stop dropping fbclid") ── */

const META_FBC = "fb.1.1727800000000.IwAR2abcDEF_123-xyz";
const META_FBP = "fb.1.1727800000000.1234567890";

test("normalizeClickFunnelsEvent: first-visit fbclid becomes fbc at the visit's time; UTMs unchanged", () => {
  const evt = normalizeClickFunnelsEvent({
    event_type: "contact.created",
    data: {
      email_address: "ad@example.com",
      visits: {
        first_visit: {
          created_at: "2026-10-01T12:00:00.000Z",
          landing_page: "https://apply.fundhub.ai/watch?utm_source=fb_ad&fbclid=IwAR9xyz",
          utm_source: "fb_ad"
        }
      }
    }
  });
  assert.deepEqual(evt.metaClickIds, { fbc: `fb.1.${Date.parse("2026-10-01T12:00:00.000Z")}.IwAR9xyz`, fbp: null });
  assert.equal("fbclid" in evt.attribution, false, "the click id is never a UTM column");
});

test("normalizeClickFunnelsEvent: fbc / fbp sent as hidden fields win over a built one", () => {
  const evt = normalizeClickFunnelsEvent({
    event_type: "contact.updated",
    data: {
      email_address: "ad@example.com",
      custom_attributes: { fbc: META_FBC, fbp: META_FBP, fbclid: "IwAROTHER" }
    }
  });
  assert.deepEqual(evt.metaClickIds, { fbc: META_FBC, fbp: META_FBP });
});

test("wrapApplySurveyIngestBody: fbc / fbp / fbclid ride along but never reach the ClickFunnels contact", () => {
  const body = {
    source: "apply-survey",
    funnel: "apply-survey",
    email: "lead@gmail.com",
    fbc: META_FBC,
    attribution: { utm_source: "meta", fbp: META_FBP, fbclid: "IwAR1" }
  };
  const wrapped = wrapApplySurveyIngestBody(body);
  assert.equal(wrapped.data.custom_attributes.fbc, META_FBC);
  assert.equal(wrapped.data.custom_attributes.fbp, META_FBP);
  const contact = applySurveyCfContact(body);
  assert.equal(JSON.stringify(contact).includes("fb.1."), false);
});

test("handleClickFunnelsWebhook: survey webhook keeps fbc / fbp on the client (blanks only)", async () => {
  _resetOrgCache(); clearHandlers();
  const writes = [];
  const db = {
    query(sql, params) {
      const text = String(sql);
      if (/FROM orgs/.test(text)) return { rows: [{ id: "org-1" }] };
      if (/SELECT id, ghl_contact_id FROM clients/.test(text)) return { rows: [{ id: "client-1", ghl_contact_id: "ghl-1" }] };
      if (/meta_fbc/.test(text)) { writes.push(params); return { rows: [{ id: params[0] }] }; }
      if (/INSERT INTO events/.test(text)) return { rows: [{ id: "evt-1" }] };
      return { rows: [] };
    }
  };
  const raw = JSON.stringify({
    id: "cf_meta_1",
    event: "contact_created",
    data: {
      contact: { email: "fbclick@gmail.com", first_name: "Fb" },
      visits: { first_visit: { created_at: "2026-10-01T12:00:00.000Z", landing_page: "https://apply.fundhub.ai/watch?fbclid=IwAR5abc" } }
    }
  });
  const res = await handleClickFunnelsWebhook({ db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, true);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], ["client-1", "org-1", `fb.1.${Date.parse("2026-10-01T12:00:00.000Z")}.IwAR5abc`, null]);
});

test("handleClickFunnelsWebhook: a failed click-id write never costs the lead", async () => {
  _resetOrgCache(); clearHandlers();
  const db = {
    query(sql) {
      const text = String(sql);
      if (/FROM orgs/.test(text)) return { rows: [{ id: "org-1" }] };
      if (/SELECT id, ghl_contact_id FROM clients/.test(text)) return { rows: [{ id: "client-1", ghl_contact_id: "ghl-1" }] };
      if (/meta_fbc/.test(text)) throw new Error("db down");
      if (/INSERT INTO events/.test(text)) return { rows: [{ id: "evt-1" }] };
      return { rows: [] };
    }
  };
  const raw = JSON.stringify({
    id: "cf_meta_2",
    event: "contact_created",
    data: { contact: { email: "fbclick2@gmail.com", custom_attributes: { fbc: META_FBC } } }
  });
  const res = await handleClickFunnelsWebhook({ db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, true);
  assert.deepEqual(res.emitted.map((e) => e.name), ["entry.captured"]);
});
