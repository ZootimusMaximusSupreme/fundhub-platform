import assert from "node:assert/strict";
import test from "node:test";

import careerHandler from "../../../../api/hiring/apply.mjs";
import benchHandler from "../../../../api/hiring/bench.mjs";
import decisionsHandler from "../../../../api/hiring/decisions.mjs";
import dealMathHandler from "../../../../api/read/deal-math.mjs";
import eeoHandler from "../../../../api/read/eeo-aggregate.mjs";
import inquiriesHandler from "../../../../api/read/inquiries.mjs";
import staffHandler from "../../../../api/read/staff.mjs";
import { ROUTES } from "../../../../netlify/functions/api.mjs";
import { _resetOrgCache } from "../../../auth/org.mjs";
import {
  ORG_ID,
  STAFF_ID,
  fakeDb,
  makeRes,
  req,
  runWithSharedDb,
  staffSession,
} from "../../../testing/handler-harness.mjs";
import { handle as hiringOutreachHandle } from "../../../workflows/hiring-outreach-cadence.mjs";
import {
  DOOR_CONTRACTS_ROUTES_23_EVIDENCE,
  DOOR_CONTRACTS_ROUTES_23_KEYS,
  DOOR_CONTRACTS_ROUTES_23_PROOFS,
  doorContractsRoutes23Proof,
} from "./door-contracts-routes-23.mjs";

const CLIENT_ID = "c1000000-0000-4000-8000-000000000001";
const APPLICATION_ID = "a1000000-0000-4000-8000-000000000001";
const CANDIDATE_ID = "ca000000-0000-4000-8000-000000000001";

async function call(handler, request, database = null) {
  const response = makeRes();
  await handler(request, response, database ? { db: database } : undefined);
  return response;
}

test("Door 23 exports only proofs exercised through real route and job results", async () => {
  const exercised = new Set();
  const mark = (key) => {
    assert.ok(DOOR_CONTRACTS_ROUTES_23_KEYS.includes(key), `${key} is not exported`);
    exercised.add(key);
  };

  assert.equal(DOOR_CONTRACTS_ROUTES_23_PROOFS.length, 8);
  assert.equal(new Set(DOOR_CONTRACTS_ROUTES_23_KEYS).size, DOOR_CONTRACTS_ROUTES_23_KEYS.length);
  for (const proof of DOOR_CONTRACTS_ROUTES_23_PROOFS) {
    assert.equal(proof.evidence, DOOR_CONTRACTS_ROUTES_23_EVIDENCE);
    assert.equal(doorContractsRoutes23Proof({ surface: proof.key, control: proof.asserts }), proof);
    assert.equal(doorContractsRoutes23Proof({ surface: proof.key, control: `${proof.asserts} changed` }), null);
  }

  assert.equal(ROUTES["hiring/apply"], careerHandler);
  const careerDb = fakeDb([
    [/SELECT id FROM orgs WHERE slug/, [{ id: ORG_ID }]],
    [/FROM hiring_roles/, [
      { key: "closer", name: "Closer", role_brief: "Help people choose the right next step.", compensation: "private" },
      { key: "setter", name: "Setter", role_brief: "", compensation: "private" },
    ]],
  ]);
  _resetOrgCache();
  const career = await runWithSharedDb(careerDb, () => call(careerHandler, { method: "GET", headers: {} }));
  _resetOrgCache();
  assert.equal(career.statusCode, 200);
  assert.equal(career.headers["cache-control"], "public, max-age=60");
  assert.deepEqual(career.body, {
    ok: true,
    roles: [
      { key: "closer", name: "Closer", brief: "Help people choose the right next step." },
      { key: "setter", name: "Setter", brief: null },
    ],
  });
  assert.deepEqual(Object.keys(career.body.roles[0]).sort(), ["brief", "key", "name"]);
  mark("route:hiring/apply (GET open roles)");

  assert.equal(ROUTES["read/deal-math"], dealMathHandler);
  const mathDb = fakeDb([staffSession({ role: "closer" })]);
  const math = await call(dealMathHandler, req("GET", {
    query: { deposit: "3000", fee: "10", debts: "2500", min: "3", drawn: "50000" },
  }), mathDb);
  assert.equal(math.statusCode, 200);
  assert.deepEqual(math.body, {
    ok: true,
    deposit: 3000,
    fee_percent: 10,
    debts: 2500,
    min_percent: 3,
    drawn: 50000,
    fees: 8000,
    net: 39500,
    monthly: 1500,
  });
  mark("route:read/deal-math");

  assert.equal(ROUTES["hiring/bench"], benchHandler);
  const benchApplications = [
    { id: "candidate-applied", status: "open", stage_key: "applied" },
    { id: "candidate-group", status: "open", stage_key: "group_interview" },
    { id: "candidate-one-on-one", status: "open", stage_key: "one_on_one" },
    { id: "candidate-offer", status: "open", stage_key: "offer" },
    { id: "candidate-closed", status: "closed", stage_key: "offer" },
  ];
  const passedGroupInterview = benchApplications.filter(
    (application) => application.status === "open"
      && ["one_on_one", "offer"].includes(application.stage_key)
  );
  assert.deepEqual(
    passedGroupInterview.map((application) => application.id),
    ["candidate-one-on-one", "candidate-offer"]
  );
  const benchDb = fakeDb([
    staffSession({ role: "owner" }),
    [/FROM v_hiring_bench b/, () => [
      {
        role_key: "closer",
        role_name: "Closer",
        bench_target: 5,
        bench_count: passedGroupInterview.length,
        bench_shortfall: 5 - passedGroupInterview.length,
        open_applications: benchApplications.filter((application) => application.status === "open").length,
        hiring_manager: "Olive Owner",
        short: true,
        unrouted: false,
        awaiting_screen: benchApplications.filter((application) => application.stage_key === "applied").length,
        awaiting_group_interview: benchApplications.filter(
          (application) => application.stage_key === "group_interview"
        ).length,
      },
    ]],
  ]);
  const bench = await runWithSharedDb(benchDb, () => call(benchHandler, req("GET")));
  assert.equal(bench.statusCode, 200);
  assert.deepEqual(bench.body.items, [{
    role_key: "closer",
    role_name: "Closer",
    bench_target: 5,
    bench_count: 2,
    bench_shortfall: 3,
    open_applications: 4,
    hiring_manager: "Olive Owner",
    short: true,
    unrouted: false,
    awaiting_screen: 1,
    awaiting_group_interview: 1,
  }]);
  assert.equal(bench.body.items[0].bench_count, 2);
  assert.equal(bench.body.items[0].awaiting_group_interview, 1);
  assert.deepEqual(benchDb.find(/FROM v_hiring_bench b/)[0].params, [51, 0]);
  mark("route:hiring/bench");

  assert.equal(ROUTES["hiring/decisions"], decisionsHandler);
  const protectedDecisionSource = {
    id: "decision-1",
    decision: "reject",
    from_stage_key: "applied",
    to_stage_key: "rejected",
    reason: "Missing required work sample",
    recommendation_at_decision: "advance",
    candidate_notified_at: null,
    created_at: "2026-10-12T18:00:00.000Z",
    role_key: "closer",
    source: "referral",
    decided_by_name: "Ada Admin",
    human_decided: true,
    score_at_decision: "81.5",
    rubric_version: "v1",
    followed_recommendation: false,
    race_ethnicity: "asian",
    gender: "female",
    veteran_status: "protected_veteran",
    disability_status: "no",
  };
  const {
    race_ethnicity: _raceEthnicity,
    gender: _gender,
    veteran_status: _veteranStatus,
    disability_status: _disabilityStatus,
    ...safeDecisionProjection
  } = protectedDecisionSource;
  const decisionDb = fakeDb([
    staffSession({ role: "admin" }),
    [/FROM hiring_decisions d/, [safeDecisionProjection]],
  ]);
  const decisions = await runWithSharedDb(decisionDb, () => call(decisionsHandler, req("GET", {
    query: { state: "reject", role: "closer", days: "30" },
  })));
  assert.equal(decisions.statusCode, 200);
  assert.equal(decisions.body.items[0].decision, "reject");
  assert.equal(decisions.body.items[0].recommendation_at_decision, "advance");
  assert.equal(decisions.body.items[0].followed_recommendation, false);
  assert.equal("race" in decisions.body.items[0], false);
  assert.equal("gender" in decisions.body.items[0], false);
  assert.equal("race_ethnicity" in decisions.body.items[0], false);
  assert.equal("veteran_status" in decisions.body.items[0], false);
  assert.equal("disability_status" in decisions.body.items[0], false);
  assert.equal(protectedDecisionSource.race_ethnicity, "asian");
  assert.equal(protectedDecisionSource.gender, "female");
  const decisionCall = decisionDb.find(/FROM hiring_decisions d/)[0];
  assert.deepEqual(decisionCall.params, [51, 0, 30, "reject", "closer"]);
  assert.match(decisionCall.sql, /CASE[\s\S]*followed_recommendation/);
  mark("route:hiring/decisions");

  assert.equal(ROUTES["read/eeo-aggregate"], eeoHandler);
  const eeoCells = [
    {
      org_id: ORG_ID,
      role_key: "closer",
      race_ethnicity: "small-hidden-cell",
      gender: "decline_to_state",
      responses: 4,
      hired: 1,
      rejected: 3,
      selection_rate_pct: "25.0",
    },
    {
      org_id: ORG_ID,
      role_key: "closer",
      race_ethnicity: "decline_to_state",
      gender: "decline_to_state",
      responses: 7,
      hired: 2,
      rejected: 1,
      selection_rate_pct: "28.57",
    },
  ];
  const eeoDb = fakeDb([
    staffSession({ role: "owner" }),
    [/FROM v_eeo_aggregate/, () => eeoCells.filter((cell) => cell.responses >= 5)],
  ]);
  const eeo = await runWithSharedDb(eeoDb, () => call(eeoHandler, req("GET", {
    query: { role: "closer" },
  })));
  assert.equal(eeo.statusCode, 200);
  assert.deepEqual(eeo.body.items, [{
    org_id: ORG_ID,
    role_key: "closer",
    race_ethnicity: "decline_to_state",
    gender: "decline_to_state",
    responses: 7,
    hired: 2,
    rejected: 1,
    selection_rate_pct: "28.57",
  }]);
  assert.equal(eeoCells.some((cell) => cell.responses < 5), true);
  assert.equal(eeo.body.items.some((cell) => cell.responses < 5), false);
  assert.equal(eeo.body.items.some((cell) => cell.race_ethnicity === "small-hidden-cell"), false);
  const eeoCall = eeoDb.find(/FROM v_eeo_aggregate/)[0];
  assert.deepEqual(eeoCall.params, [ORG_ID, "closer"]);
  assert.doesNotMatch(eeoCall.sql, /FROM\s+eeo_responses/i);
  mark("route:read/eeo-aggregate");

  assert.equal(ROUTES["read/inquiries"], inquiriesHandler);
  const inquiryBaseRow = {
    id: "inquiry-1",
    client_id: CLIENT_ID,
    case_id: "case-1",
    bureau: "EX",
    inquiry: "Example Bank",
    inquiry_name: "Example Bank",
    expected_name: "Example Bank",
    status: "queued",
    call_state: "not_due",
    is_open: true,
    call_attempts: 0,
    outcome: null,
    cleared_at: null,
    confirmed_at: null,
    created_at: "2026-10-11T18:00:00.000Z",
    updated_at: "2026-10-12T18:00:00.000Z",
  };
  const inquiryClient = { id: CLIENT_ID, first_name: "Avery", last_name: "Client" };
  assert.equal(Object.hasOwn(inquiryBaseRow, "client_name"), false);
  const inquiryDb = fakeDb([
    staffSession({ role: "inquiry_specialist" }),
    [/FROM inquiry_log i/, (sql) => {
      assert.match(sql, /LEFT JOIN clients c ON c\.id = i\.client_id/);
      const client = inquiryClient.id === inquiryBaseRow.client_id ? inquiryClient : null;
      return [{
        ...inquiryBaseRow,
        client_name: client ? `${client.first_name} ${client.last_name}` : "",
      }];
    }],
  ]);
  const inquiry = await runWithSharedDb(inquiryDb, () => call(inquiriesHandler, req("GET", {
    query: { client_id: CLIENT_ID, bureau: "EX", status: "queued" },
  })));
  assert.equal(inquiry.statusCode, 200);
  assert.equal(inquiry.body.items[0].client_name, "Avery Client");
  assert.equal(inquiry.body.items[0].inquiry_name, "Example Bank");
  assert.deepEqual(inquiryDb.find(/FROM inquiry_log i/)[0].params, [
    51, 0, CLIENT_ID, "EX", "queued", ORG_ID,
  ]);
  mark("route:read/inquiries");

  assert.equal(ROUTES["read/staff"], staffHandler);
  const staffDb = fakeDb([
    staffSession({ role: "owner", id: STAFF_ID }),
    [/SELECT demo_mode_enabled FROM orgs/, [{ demo_mode_enabled: false }]],
    [/SELECT count\(\*\)::int AS n[\s\S]*FROM staff s/, [{ n: 3 }]],
    [
      (sql) => /FROM staff s/.test(sql) && /open_tasks/.test(sql),
      [{
        id: STAFF_ID,
        name: "Olive Owner",
        email: "owner@example.test",
        role: "owner",
        status: "active",
        assignment_order: 1,
        last_assigned_at: null,
        created_at: "2026-01-01T00:00:00.000Z",
        phone: "+16025550100",
        start_date: "2026-01-01",
        employee_code: "OWN-1",
        notify_booked_call_sms: true,
        monitoring_consent_at: null,
        hubstaff_user_id: null,
        open_tasks: 2,
        open_shift: 1,
        monitor_events_today: 0,
        password_hash: "must-never-leave",
      }],
    ],
  ]);
  const staff = await runWithSharedDb(staffDb, () => call(staffHandler, req("GET")));
  assert.equal(staff.statusCode, 200);
  assert.equal(staff.body.hiddenCount, 3);
  assert.equal(staff.body.items[0].name, "Olive Owner");
  assert.equal(staff.body.items[0].open_tasks, 2);
  assert.equal("password_hash" in staff.body.items[0], false);
  mark("route:read/staff");

  const queuedMessages = [];
  let outreachUpdate = null;
  const outreachDb = {
    async query(sql, params = []) {
      const text = String(sql);
      if (/FROM candidate_outreach\s+WHERE status = 'active'/.test(text)) {
        return { rows: [{ application_id: APPLICATION_ID, org_id: ORG_ID }] };
      }
      if (/SELECT \* FROM candidate_outreach WHERE application_id/.test(text)) {
        return { rows: [{
          id: "outreach-1",
          application_id: APPLICATION_ID,
          candidate_id: CANDIDATE_ID,
          org_id: ORG_ID,
          status: "active",
          step: 0,
          replied_at: null,
          booked_at: null,
        }] };
      }
      if (/FROM candidate_applications a[\s\S]*JOIN pipeline_stages/.test(text)) {
        return { rows: [{ status: "open", stage_key: "applied" }] };
      }
      if (/FROM hiring_interview_attendees/.test(text)) return { rows: [] };
      if (/SELECT email, phone, sms_consent/.test(text)) {
        return { rows: [{
          email: "candidate@example.test",
          phone: "+16025550123",
          sms_consent: true,
          sms_opt_out_at: null,
          email_opt_out_at: null,
        }] };
      }
      if (/SELECT \* FROM candidates WHERE id/.test(text)) {
        return { rows: [{
          id: CANDIDATE_ID,
          full_name: "Casey Candidate",
          email: "candidate@example.test",
          phone: "+16025550123",
          sms_consent: true,
          sms_opt_out_at: null,
          email_opt_out_at: null,
        }] };
      }
      if (/JOIN hiring_roles r ON r.id = a.role_id/.test(text)) {
        return { rows: [{
          id: "role-1",
          key: "closer",
          name: "Closer",
          interview_booking_url: "https://book.example.test/closer",
        }] };
      }
      if (/FROM message_templates WHERE/.test(text)) {
        const key = params[1];
        return { rows: [{
          template_key: key,
          channel: key.startsWith("EMAIL-") ? "email" : "sms",
          subject: key.startsWith("EMAIL-") ? "Next step for {{candidate.first_name}}" : null,
          body: "Hi {{candidate.first_name}}, book {{role.name}} here: {{role.booking_url}}",
          compliance_passed: true,
        }] };
      }
      if (/INSERT INTO messages/.test(text)) {
        queuedMessages.push({
          channel: params[1],
          templateKey: params[2],
          body: params[3],
          providerRef: params[4],
          to: params[5],
          subject: params[6],
        });
        return { rows: [{ id: `message-${queuedMessages.length}` }] };
      }
      if (/UPDATE candidate_outreach[\s\S]*SET step =/.test(text)) {
        outreachUpdate = { applicationId: params[0], step: params[1], sentAt: params[2], queued: params[3], nextDueAt: params[4] };
        return { rows: [] };
      }
      throw new Error(`unexpected hiring outreach proof query: ${text.slice(0, 100)}`);
    },
  };
  const outreachSteps = [];
  const outreach = await hiringOutreachHandle({
    db: outreachDb,
    step: {
      async run(name, fn) {
        outreachSteps.push(name);
        return fn();
      },
    },
  });
  assert.deepEqual(outreachSteps, ["sweep"]);
  assert.equal(outreach.ok, true);
  assert.equal(outreach.scanned, 1);
  assert.equal(outreach.queued, 2);
  assert.equal(outreach.results[0].step, 1);
  assert.deepEqual(queuedMessages, [
    {
      channel: "email",
      templateKey: "EMAIL-CANDIDATE-OUTREACH-1",
      body: "Hi Casey, book Closer here: https://book.example.test/closer",
      providerRef: `candidate:${APPLICATION_ID}:step1:email`,
      to: "candidate@example.test",
      subject: "Next step for Casey",
    },
    {
      channel: "sms",
      templateKey: "SMS-CANDIDATE-OUTREACH-1",
      body: "Hi Casey, book Closer here: https://book.example.test/closer",
      providerRef: `candidate:${APPLICATION_ID}:step1:sms`,
      to: "+16025550123",
      subject: null,
    },
  ]);
  assert.equal(outreachUpdate.applicationId, APPLICATION_ID);
  assert.equal(outreachUpdate.step, 1);
  assert.equal(outreachUpdate.queued, 2);
  mark("workflow:hiring-outreach-cadence");

  assert.deepEqual([...exercised].sort(), [...DOOR_CONTRACTS_ROUTES_23_KEYS].sort());
});
