// Practice scenarios for the Repair queue live checks: the queue table, the row, the twelve stage
// columns and the three letter buttons. Each scenario runs the EXACT SQL text of the contract over
// stand-in rows built from the real column names. See fin-b07-case-runner.mjs.

import { ORG, OTHER_ORG, ago, id, runCases } from "./fin-b07-case-runner.mjs";

const STAGES = ["intake", "awaiting_documents", "analysis", "letters_generated", "ready_to_send", "in_transit",
  "awaiting_response", "response_received", "round_complete", "stalled", "program_complete", "cancelled"];
const stageId = (key) => id(10 + STAGES.indexOf(key));

const client = (n, extra = {}) => ["clients", { id: id(n), org_id: ORG, first_name: "Dana", last_name: "Whitfield", is_demo: false, ...extra }];
const board = () => ["pipelines", { id: id(1), org_id: ORG, key: "optimization", name: "Optimization" }];
const stageRows = () => STAGES.map((key) => ["pipeline_stages", { id: stageId(key), org_id: ORG, pipeline_id: id(1), key, name: key }]);
const card = (n, c, stage, extra = {}) => ["cards", {
  id: id(300 + n), org_id: ORG, client_id: id(c), pipeline_id: id(1), stage_id: stageId(stage),
  entered_at: ago(1, "hours"), updated_at: ago(1, "hours"), is_demo: false, ...extra,
}];
const dcase = (n, c, extra = {}) => ["dispute_cases", {
  id: id(500 + n), org_id: ORG, client_id: id(c), bureau: "EX", round: "R1", status: "open",
  created_at: ago(5), updated_at: ago(1), ...extra,
}];
const letter = (n, c, status, extra = {}) => ["dispute_letters", {
  id: id(600 + n), case_id: id(501), org_id: ORG, client_id: id(c), bureau: "EX", round: "R1", status,
  body_text: "Dear bureau, please correct the following.", target: "bureau", created_at: ago(2), ...extra,
}];
const response = (n, c) => ["dispute_responses", { id: id(700 + n), case_id: id(501), org_id: ORG, client_id: id(c), created_at: ago(1) }];
const clock = "COALESCE(c.entered_at, c.updated_at)";
const BASE = [board(), ...stageRows(), client(1), dcase(1, 1)];
const TABLES = ["cards", "pipelines", "pipeline_stages", "clients", "dispute_cases", "dispute_letters", "dispute_responses",
  "repair_decision_log", "repair_programs", "events", "dispute_items"];

runCases({
  "fin-b07-stage-intake": {
    tables: TABLES,
    good: [...BASE, card(1, 1, "intake")],
    bad: [
      { name: "a file past five days", rows: [client(2), card(2, 2, "intake", { entered_at: ago(6), updated_at: ago(6) })], breaks: `OR ${clock} < now() - interval '5 days'` },
      { name: "a file with no entry time", rows: [client(3), card(3, 3, "intake", { entered_at: null, updated_at: null })], breaks: `FILTER (WHERE ${clock} IS NULL` },
    ],
  },

  "fin-b07-stage-await-docs": {
    tables: TABLES,
    good: [...BASE, card(1, 1, "awaiting_documents", { entered_at: ago(10), updated_at: ago(10) })],
    bad: [
      { name: "a file past fourteen days", rows: [client(2), card(2, 2, "awaiting_documents", { entered_at: ago(15), updated_at: ago(15) })], breaks: `OR ${clock} < now() - interval '14 days'` },
      { name: "a file with no entry time", rows: [client(3), card(3, 3, "awaiting_documents", { entered_at: null, updated_at: null })], breaks: `FILTER (WHERE ${clock} IS NULL` },
    ],
  },

  "fin-b07-stage-analysis": {
    tables: TABLES,
    good: [...BASE, card(1, 1, "analysis", { entered_at: ago(20, "minutes"), updated_at: ago(20, "minutes") })],
    bad: [
      { name: "a file past one hour", rows: [client(2), card(2, 2, "analysis", { entered_at: ago(2, "hours"), updated_at: ago(2, "hours") })], breaks: `OR ${clock} < now() - interval '1 hour'` },
      { name: "a file with no entry time", rows: [client(3), card(3, 3, "analysis", { entered_at: null, updated_at: null })], breaks: `FILTER (WHERE ${clock} IS NULL` },
    ],
  },

  "fin-b07-stage-letters-generated": {
    tables: TABLES,
    good: [...BASE, card(1, 1, "letters_generated", { entered_at: ago(10, "minutes"), updated_at: ago(10, "minutes") }), letter(1, 1, "generated")],
    bad: [
      { name: "a file past thirty minutes", rows: [client(2), letter(2, 2, "generated"), card(2, 2, "letters_generated", { entered_at: ago(45, "minutes"), updated_at: ago(45, "minutes") })], breaks: `OR ${clock} < now() - interval '30 minutes'` },
      { name: "a file that says letters were made and holds none", rows: [client(3), card(3, 3, "letters_generated", { entered_at: ago(5, "minutes"), updated_at: ago(5, "minutes") })], breaks: "OR NOT EXISTS ( SELECT 1 FROM dispute_letters dl WHERE dl.org_id = c.org_id AND dl.client_id = c.client_id)" },
    ],
  },

  "fin-b07-stage-ready": {
    tables: TABLES,
    good: [...BASE, card(1, 1, "ready_to_send", { entered_at: ago(1, "hours"), updated_at: ago(1, "hours") }), letter(1, 1, "ready")],
    bad: [
      { name: "a file past four hours", rows: [client(2), letter(2, 2, "generated"), card(2, 2, "ready_to_send", { entered_at: ago(5, "hours"), updated_at: ago(5, "hours") })], breaks: `OR ${clock} < now() - interval '4 hours'` },
      { name: "a file with nothing left to send", rows: [client(3), letter(3, 3, "sent"), card(3, 3, "ready_to_send", { entered_at: ago(1, "hours"), updated_at: ago(1, "hours") })], breaks: "OR NOT EXISTS ( SELECT 1 FROM dispute_letters dl WHERE dl.org_id = c.org_id AND dl.client_id = c.client_id AND dl.status IN ('generated', 'ready'))" },
    ],
  },

  "fin-b07-stage-transit": {
    tables: TABLES,
    good: [...BASE, card(1, 1, "in_transit", { entered_at: ago(3), updated_at: ago(3) }), letter(1, 1, "sent")],
    bad: [
      { name: "a file past ten days", rows: [client(2), letter(2, 2, "delivered"), card(2, 2, "in_transit", { entered_at: ago(11), updated_at: ago(11) })], breaks: `OR ${clock} < now() - interval '10 days'` },
      { name: "a file in the mail with no mailed letter", rows: [client(3), letter(3, 3, "generated"), card(3, 3, "in_transit", { entered_at: ago(1), updated_at: ago(1) })], breaks: "OR NOT EXISTS ( SELECT 1 FROM dispute_letters dl WHERE dl.org_id = c.org_id AND dl.client_id = c.client_id AND dl.status IN ('sending', 'sent', 'delivered'))" },
    ],
  },

  "fin-b07-stage-await-response": {
    tables: TABLES,
    good: [board(), ...stageRows(), client(1), dcase(1, 1, { response_due_at: ago(-10) }), card(1, 1, "awaiting_response")],
    bad: [
      { name: "a file waiting on a bureau with no due time", rows: [client(2), dcase(2, 2, { response_due_at: null }), card(2, 2, "awaiting_response")], breaks: "FILTER (WHERE NOT EXISTS (" },
      { name: "a file whose bureau answer is more than five days late", rows: [client(3), dcase(3, 3, { response_due_at: ago(10) }), card(3, 3, "awaiting_response")], breaks: "OR (SELECT MIN(dc.response_due_at)" },
    ],
  },

  "fin-b07-stage-response-received": {
    tables: TABLES,
    good: [...BASE, card(1, 1, "response_received", { entered_at: ago(2, "hours"), updated_at: ago(2, "hours") }), response(1, 1)],
    bad: [
      { name: "a file past twenty-four hours", rows: [client(2), response(2, 2), card(2, 2, "response_received", { entered_at: ago(30, "hours"), updated_at: ago(30, "hours") })], breaks: `OR ${clock} < now() - interval '24 hours'` },
      { name: "a file with an answer in and no saved answer", rows: [client(3), card(3, 3, "response_received", { entered_at: ago(1, "hours"), updated_at: ago(1, "hours") })], breaks: "OR NOT EXISTS ( SELECT 1 FROM dispute_responses dr WHERE dr.org_id = c.org_id AND dr.client_id = c.client_id)" },
    ],
  },

  "fin-b07-stage-round-complete": {
    tables: TABLES,
    good: [...BASE, card(1, 1, "round_complete"), response(1, 1), client(2), card(2, 2, "round_complete"),
      ["events", { id: id(800), org_id: ORG, client_id: id(2), name: "repair.round.complete", payload: {}, created_at: ago(1) }]],
    bad: [
      { name: "a file shown as round done with nothing behind it", rows: [client(3), card(3, 3, "round_complete")], breaks: "FILTER (WHERE NOT EXISTS (" },
    ],
  },

  "fin-b07-stage-stalled": {
    tables: TABLES,
    good: [...BASE, card(1, 1, "stalled"), ["repair_decision_log", { id: id(810), org_id: ORG, client_id: id(1), decision: "repair.stalled", payload: {}, created_at: ago(1) }],
      client(2), dcase(2, 2, { status: "stalled" }), card(2, 2, "stalled")],
    bad: [
      { name: "a stuck file that records no reason", rows: [client(3), card(3, 3, "stalled")], breaks: "FILTER (WHERE NOT EXISTS (" },
    ],
  },

  "fin-b07-stage-program-complete": {
    tables: TABLES,
    good: [...BASE, card(1, 1, "program_complete"), ["repair_programs", { id: id(820), org_id: ORG, client_id: id(1), status: "upsell_pending" }],
      client(2), card(2, 2, "program_complete"), ["events", { id: id(821), org_id: ORG, client_id: id(2), name: "repair.program.complete", payload: {}, created_at: ago(1) }]],
    bad: [
      { name: "a done file whose program is still active", rows: [client(3), card(3, 3, "program_complete"), ["repair_programs", { id: id(822), org_id: ORG, client_id: id(3), status: "active" }]], breaks: "FILTER (WHERE NOT EXISTS (" },
    ],
  },

  "fin-b07-stage-cancelled": {
    tables: TABLES,
    good: [...BASE, card(1, 1, "cancelled"), ["repair_programs", { id: id(830), org_id: ORG, client_id: id(1), status: "cancelled" }]],
    bad: [
      { name: "a cancelled file whose program is active", rows: [client(2), card(2, 2, "cancelled"), ["repair_programs", { id: id(831), org_id: ORG, client_id: id(2), status: "active" }]], breaks: "FILTER (WHERE EXISTS (" },
    ],
  },

  "fin-b07-repair-queue": {
    tables: TABLES,
    good: [...BASE, card(1, 1, "intake")],
    bad: [
      { name: "a card whose client is gone", rows: [card(2, 9, "intake")], breaks: "FILTER (WHERE cl.id IS NULL" },
      {
        name: "a card whose stage belongs to another board",
        rows: [client(2), ["pipelines", { id: id(2), org_id: ORG, key: "funding", name: "Funding" }],
          ["pipeline_stages", { id: id(40), org_id: ORG, pipeline_id: id(2), key: "new", name: "New" }],
          ["cards", { id: id(350), org_id: ORG, client_id: id(2), pipeline_id: id(1), stage_id: id(40), entered_at: ago(1), updated_at: ago(1), is_demo: false }]],
        breaks: "OR ps.pipeline_id IS DISTINCT FROM c.pipeline_id",
      },
      { name: "a card with no entry time", rows: [client(3), card(3, 3, "intake", { entered_at: null, updated_at: null })], breaks: "OR COALESCE(c.entered_at, c.updated_at) IS NULL" },
    ],
  },

  "fin-b07-repair-row": {
    tables: TABLES,
    good: [...BASE, card(1, 1, "intake"), dcase(5, 1, { pipeline_card_id: id(301) }), letter(1, 1, "generated", { case_id: id(505) })],
    bad: [
      { name: "a case that holds another client's letter", rows: [client(2), letter(2, 2, "generated", { case_id: id(501) })], breaks: "OR EXISTS (SELECT 1 FROM dispute_letters dl WHERE dl.case_id = dc.id AND dl.client_id IS DISTINCT FROM dc.client_id)", extraSamples: 0 },
      {
        name: "a case that holds another client's item",
        rows: [client(2), ["dispute_items", { id: id(900), case_id: id(501), org_id: ORG, client_id: id(2) }]],
        breaks: "OR EXISTS (SELECT 1 FROM dispute_items di WHERE di.case_id = dc.id AND di.client_id IS DISTINCT FROM dc.client_id)",
        extraSamples: 0,
      },
      {
        name: "a case pointing at another client's board card",
        rows: [client(3), card(7, 3, "intake"), dcase(6, 1, { pipeline_card_id: id(307) })],
        breaks: "OR (dc.pipeline_card_id IS NOT NULL AND NOT EXISTS (",
      },
      { name: "a case whose client is gone", rows: [dcase(7, 9)], breaks: "FILTER (WHERE cl.id IS NULL" },
    ],
  },

  "fin-b07-row-send": {
    tables: TABLES,
    good: [...BASE, ["dispute_cases", { id: id(520), org_id: ORG, client_id: id(1), bureau: "EX", round: "R1", status: "awaiting_response", response_due_at: ago(-20), created_at: ago(5), updated_at: ago(1) }],
      letter(1, 1, "sent", { case_id: id(520), mailed_at: ago(2), send_claimed_at: ago(2) })],
    bad: [
      { name: "a sent letter with no mailed stamp", rows: [letter(2, 1, "sent", { case_id: id(520), mailed_at: null, send_claimed_at: ago(2) })], breaks: "OR (dl.status IN ('sent', 'delivered') AND (dl.mailed_at IS NULL OR dl.send_claimed_at IS NULL))" },
      { name: "a letter claimed over a day ago and never mailed", rows: [letter(3, 1, "sending", { case_id: id(520), send_claimed_at: ago(2) })], breaks: "OR (dl.status = 'sending' AND dl.send_claimed_at < now() - interval '1 days')" },
      { name: "a mailed letter whose bureau clock never started", rows: [dcase(8, 1, { response_due_at: null }), letter(4, 1, "sent", { case_id: id(508), mailed_at: ago(2), send_claimed_at: ago(2) })], breaks: "OR (dl.mailed_at IS NOT NULL AND dc.response_due_at IS NULL)" },
      { name: "a letter whose case is of another client", rows: [client(2), letter(5, 2, "sent", { case_id: id(520), mailed_at: ago(2), send_claimed_at: ago(2) })], breaks: "OR dc.client_id IS DISTINCT FROM dl.client_id" },
    ],
  },

  "fin-b07-letter-send-one": {
    tables: TABLES,
    good: [...BASE, letter(1, 1, "sent", { mailed_at: ago(2), send_claimed_at: ago(2) })],
    bad: [
      { name: "a furnisher letter mailed with no address on file", rows: [letter(2, 1, "sent", { case_id: id(502), target: "furnisher", furnisher_address_id: null, mailed_at: ago(2), send_claimed_at: ago(2) })], breaks: "FILTER (WHERE (dl.target = 'furnisher' AND dl.furnisher_address_id IS NULL)" },
      { name: "a mailed letter with no bureau", rows: [letter(3, 1, "sent", { case_id: id(503), bureau: "", mailed_at: ago(2), send_claimed_at: ago(2) })], breaks: "OR NULLIF(BTRIM(COALESCE(dl.bureau, '')), '') IS NULL" },
      {
        name: "the same letter mailed twice",
        rows: [letter(5, 1, "sent", { mailed_at: ago(1), send_claimed_at: ago(1) })],
        breaks: "OR EXISTS ( SELECT 1 FROM dispute_letters o",
        expectBad: 2,
      },
    ],
  },

  "fin-b07-row-stage": {
    tables: TABLES,
    good: [...BASE, letter(1, 1, "generated")],
    bad: [
      { name: "a staged letter with no case", rows: [letter(2, 1, "generated", { case_id: id(599) })], breaks: ["FILTER (WHERE dc.id IS NULL", "OR dc.client_id IS DISTINCT FROM dl.client_id"] },
      { name: "a staged letter of another client's case", rows: [client(2), letter(3, 2, "ready", { case_id: id(501) })], breaks: "OR dc.client_id IS DISTINCT FROM dl.client_id" },
      { name: "a staged letter with no words", rows: [letter(4, 1, "generated", { body_text: "  " })], breaks: "OR NULLIF(BTRIM(COALESCE(dl.body_text, '')), '') IS NULL" },
      { name: "a furnisher letter with no address", rows: [letter(5, 1, "ready", { target: "furnisher", furnisher_address_id: null })], breaks: "OR (dl.target = 'furnisher' AND dl.furnisher_address_id IS NULL)" },
      { name: "a staged letter that already carries a mailed stamp", rows: [letter(6, 1, "generated", { mailed_at: ago(1) })], breaks: "OR dl.mailed_at IS NOT NULL" },
    ],
  },
});
