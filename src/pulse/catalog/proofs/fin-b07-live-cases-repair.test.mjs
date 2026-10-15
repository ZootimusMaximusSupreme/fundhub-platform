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
    good: [board(), ...stageRows(), client(1), dcase(1, 1, { response_due_at: ago(-10) }), card(1, 1, "awaiting_response"),
      // A file in round 2. Its round-1 case is still "open" (nothing in the repository ever closes a case)
      // and its answer was due 40 days ago, but the round-2 letters went out yesterday. The clock that
      // matters is the current round's, so this file is healthy.
      client(5), dcase(10, 5, { round: "R1", status: "awaiting_response", response_due_at: ago(40) }),
      dcase(11, 5, { round: "R2", status: "awaiting_response", response_due_at: ago(-29) }), card(5, 5, "awaiting_response"),
      // The furnisher round comes after the bureau rounds (round words R1 to R6, then FURNISHER).
      client(8), dcase(16, 8, { round: "R3", status: "awaiting_response", response_due_at: ago(50) }),
      dcase(17, 8, { round: "FURNISHER", status: "awaiting_response", response_due_at: ago(-20) }), card(8, 8, "awaiting_response")],
    bad: [
      { name: "a file waiting on a bureau with no due time", rows: [client(2), dcase(2, 2, { response_due_at: null }), card(2, 2, "awaiting_response")], breaks: "FILTER (WHERE NOT EXISTS (" },
      { name: "a file whose bureau answer is more than five days late", rows: [client(3), dcase(3, 3, { response_due_at: ago(10) }), card(3, 3, "awaiting_response")], breaks: "OR EXISTS ( SELECT 1 FROM dispute_cases dc" },
      {
        name: "a file in round 2 whose round-2 answer is more than five days late",
        rows: [client(4), dcase(4, 4, { round: "R1", status: "awaiting_response", response_due_at: ago(60) }),
          dcase(5, 4, { round: "R2", status: "awaiting_response", response_due_at: ago(10) }), card(4, 4, "awaiting_response")],
        breaks: "OR EXISTS ( SELECT 1 FROM dispute_cases dc",
      },
      {
        name: "a file whose furnisher round is more than five days late",
        rows: [client(9), dcase(18, 9, { round: "R3", status: "awaiting_response", response_due_at: ago(-5) }),
          dcase(19, 9, { round: "FURNISHER", status: "awaiting_response", response_due_at: ago(12) }), card(9, 9, "awaiting_response")],
        breaks: "OR EXISTS ( SELECT 1 FROM dispute_cases dc",
      },
      {
        name: "a file in round 2 whose round-2 letters never went out (no due time on the current round)",
        rows: [client(6), dcase(6, 6, { round: "R1", status: "awaiting_response", response_due_at: ago(-5) }),
          dcase(7, 6, { round: "R2", status: "open", response_due_at: null }), card(6, 6, "awaiting_response")],
        breaks: "FILTER (WHERE NOT EXISTS (",
      },
    ],
    ignored: [
      {
        // A closed round-2 case, long overdue, next to a fresh open round-1 case. While closed cases are
        // left out, the file's current round is round 1 and it is healthy.
        name: "a closed case that is long overdue",
        rows: [client(7), dcase(8, 7, { round: "R1", status: "awaiting_response", response_due_at: ago(-5) }),
          dcase(9, 7, { round: "R2", status: "closed", response_due_at: ago(40) }), card(7, 7, "awaiting_response")],
        breaks: [
          { piece: "AND dc.status NOT IN ('closed', 'cancelled')", with: "AND 1 = 1" },
          { piece: "AND dc.status NOT IN ('closed', 'cancelled')", with: "AND 1 = 1" },
          { piece: "AND nx.status NOT IN ('closed', 'cancelled')", with: "AND 1 = 1" },
        ],
        extraSamples: 1,
      },
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
    good: [...BASE, card(1, 1, "intake"), ["repair_programs", { id: id(840), org_id: ORG, client_id: id(1), program: "trial", rounds_cap: 2, price_total: 200, status: "active" }]],
    bad: [
      {
        name: "a card whose client sits in another company",
        rows: [["clients", { id: id(9), org_id: OTHER_ORG, first_name: "Sam", last_name: "Rivera" }], card(2, 9, "intake")],
        breaks: { piece: "AND (cl.id IS NULL", with: "AND (1 = 0 AND cl.id IS NULL" },
      },
      {
        name: "a card whose stage belongs to another board",
        rows: [client(2), ["pipelines", { id: id(2), org_id: ORG, key: "funding", name: "Funding" }],
          ["pipeline_stages", { id: id(40), org_id: ORG, pipeline_id: id(2), key: "new", name: "New" }],
          ["cards", { id: id(350), org_id: ORG, client_id: id(2), pipeline_id: id(1), stage_id: id(40), entered_at: ago(1), updated_at: ago(1), is_demo: false }]],
        breaks: "OR ps.pipeline_id IS DISTINCT FROM c.pipeline_id",
      },
      {
        // The stage join pins the company, so a card pointing at another company's stage reads as no stage.
        name: "a card whose stage sits in another company",
        rows: [client(10), ["pipeline_stages", { id: id(43), org_id: OTHER_ORG, pipeline_id: id(1), key: "intake", name: "Intake" }],
          ["cards", { id: id(353), org_id: ORG, client_id: id(10), pipeline_id: id(1), stage_id: id(43), entered_at: ago(1), updated_at: ago(1), is_demo: false }]],
        breaks: "OR ps.pipeline_id IS DISTINCT FROM c.pipeline_id",
      },
      {
        // The queue lists the cards on the board, so a paid file with no card is not on the screen at all.
        name: "an active repair program whose client has no card on the board",
        rows: [client(3), ["repair_programs", { id: id(841), org_id: ORG, client_id: id(3), program: "trial", rounds_cap: 2, price_total: 200, status: "active" }]],
        breaks: "OR NOT EXISTS ( SELECT 1 FROM cards k",
      },
      {
        name: "an active repair program whose only card sits on another board",
        rows: [client(4), ["pipelines", { id: id(3), org_id: ORG, key: "sales", name: "Sales" }],
          ["pipeline_stages", { id: id(41), org_id: ORG, pipeline_id: id(3), key: "new", name: "New" }],
          ["cards", { id: id(351), org_id: ORG, client_id: id(4), pipeline_id: id(3), stage_id: id(41), entered_at: ago(1), updated_at: ago(1), is_demo: false }],
          ["repair_programs", { id: id(842), org_id: ORG, client_id: id(4), program: "trial", rounds_cap: 2, price_total: 200, status: "active" }]],
        breaks: "OR NOT EXISTS ( SELECT 1 FROM cards k",
      },
      {
        name: "an active repair program whose program word the desk does not know",
        rows: [client(5), card(5, 5, "intake"), ["repair_programs", { id: id(843), org_id: ORG, client_id: id(5), program: "trial", rounds_cap: 2, price_total: 200, status: "active", program: "gold" }]],
        breaks: { piece: "AND (rp.program NOT IN ('trial', 'full')", with: "AND (1 = 0 AND rp.program NOT IN ('trial', 'full')" },
        extraSamples: 2,
      },
      {
        name: "an active repair program with no rounds",
        rows: [client(6), card(6, 6, "intake"), ["repair_programs", { id: id(844), org_id: ORG, client_id: id(6), program: "trial", rounds_cap: 2, price_total: 200, status: "active", rounds_cap: 0 }]],
        breaks: "OR COALESCE(rp.rounds_cap, 0) < 1",
        extraSamples: 2,
      },
    ],
    ignored: [
      {
        name: "a finished program whose file has left the board",
        rows: [client(7), ["repair_programs", { id: id(845), org_id: ORG, client_id: id(7), program: "trial", rounds_cap: 2, price_total: 200, status: "active", status: "complete" }]],
        breaks: [{ piece: "AND rp.status = 'active'", with: "AND 1 = 1" }, { piece: "AND rp.status = 'active'", with: "AND 1 = 1" }],
        extraSamples: 0,
      },
      {
        name: "a demo client's program with no card",
        rows: [client(8, { is_demo: true }), ["repair_programs", { id: id(846), org_id: ORG, client_id: id(8), program: "trial", rounds_cap: 2, price_total: 200, status: "active" }]],
        breaks: [{ piece: "AND COALESCE(pc.is_demo, false) = false", with: "AND 1 = 1" }, { piece: "AND COALESCE(pc.is_demo, false) = false", with: "AND 1 = 1" }],
      },
      {
        // Only the optimization board is the Repair queue. A card on the sales board with a client from
        // another company is somebody else's problem, not this queue's.
        name: "a card on a different board with a client from another company",
        rows: [["clients", { id: id(11), org_id: OTHER_ORG, first_name: "Sam", last_name: "Rivera" }],
          ["pipelines", { id: id(5), org_id: ORG, key: "sales", name: "Sales" }],
          ["pipeline_stages", { id: id(44), org_id: ORG, pipeline_id: id(5), key: "new", name: "New" }],
          ["cards", { id: id(354), org_id: ORG, client_id: id(11), pipeline_id: id(5), stage_id: id(44), entered_at: ago(1), updated_at: ago(1), is_demo: false }]],
        breaks: [{ piece: "AND p.key = 'optimization'", with: "AND 1 = 1" }, { piece: "AND p.key = 'optimization'", with: "AND 1 = 1" }],
        extraSamples: 0,
      },
      {
        name: "a demo card on a stage of another board",
        rows: [client(9), ["pipelines", { id: id(4), org_id: ORG, key: "funding", name: "Funding" }],
          ["pipeline_stages", { id: id(42), org_id: ORG, pipeline_id: id(4), key: "new", name: "New" }],
          ["cards", { id: id(352), org_id: ORG, client_id: id(9), pipeline_id: id(1), stage_id: id(42), entered_at: ago(1), updated_at: ago(1), is_demo: true }]],
        breaks: [{ piece: "AND COALESCE(c.is_demo, false) = false", with: "AND 1 = 1" }, { piece: "AND COALESCE(c.is_demo, false) = false", with: "AND 1 = 1" }],
      },
    ],
  },

  "fin-b07-repair-row": {
    tables: TABLES,
    good: [...BASE, card(1, 1, "intake"), dcase(5, 1, { pipeline_card_id: id(301) }), letter(1, 1, "generated", { case_id: id(505) }),
      ["dispute_items", { id: id(901), case_id: id(505), org_id: ORG, client_id: id(1), round: "R1" }],
      ["repair_decision_log", { id: id(902), org_id: ORG, client_id: id(1), case_id: id(505), decision: "repair.letters.generated", payload: {}, created_at: ago(1) }]],
    bad: [
      { name: "a case that holds another client's letter", rows: [client(2), letter(2, 2, "generated", { case_id: id(501) })], breaks: "OR EXISTS (SELECT 1 FROM dispute_letters dl WHERE dl.case_id = dc.id AND dl.client_id IS DISTINCT FROM dc.client_id)", extraSamples: 0 },
      {
        // "Letters this round": a letter written for round 2 sitting on a round-1 case would be listed with
        // the wrong round's letters.
        name: "a case that holds a letter of another round",
        rows: [letter(7, 1, "generated", { case_id: id(501), round: "R2" })],
        breaks: "OR EXISTS (SELECT 1 FROM dispute_letters dl WHERE dl.case_id = dc.id AND dl.round IS DISTINCT FROM dc.round)",
        extraSamples: 0,
      },
      {
        // The timeline is the decision log. An entry for this client that points at another client's case
        // would show someone else's history on this file.
        name: "a timeline entry that points at another client's case",
        rows: [client(4), dcase(9, 4), ["repair_decision_log", { id: id(904), org_id: ORG, client_id: id(1), case_id: id(509), decision: "repair.stalled", payload: {}, created_at: ago(1) }]],
        // Both of client 1's open cases show the entry on their timeline, so both are counted.
        breaks: "OR EXISTS (SELECT 1 FROM repair_decision_log rd",
        expectBad: 2,
        extraSamples: 1,
      },
      { name: "a case whose client sits in another company", rows: [["clients", { id: id(9), org_id: OTHER_ORG, first_name: "Sam", last_name: "Rivera" }], dcase(7, 9)], breaks: "FILTER (WHERE cl.id IS NULL" },
    ],
    ignored: [
      {
        name: "a case closed after another client's letter landed on it",
        rows: [client(5), dcase(12, 5, { status: "closed" }), letter(8, 1, "generated", { case_id: id(512) })],
        breaks: { piece: "AND dc.status NOT IN ('closed', 'cancelled')", with: "AND 1 = 1" },
      },
      {
        name: "a cancelled case holding another client's letter",
        rows: [client(6), dcase(13, 6, { status: "cancelled" }), letter(11, 1, "generated", { case_id: id(513) })],
        breaks: { piece: "AND dc.status NOT IN ('closed', 'cancelled')", with: "AND 1 = 1" },
      },
      {
        name: "a case untouched for 70 days that holds another client's letter",
        rows: [client(7), dcase(14, 7, { updated_at: ago(70) }), letter(9, 1, "generated", { case_id: id(514) })],
        breaks: { piece: "AND dc.updated_at >= now() - interval '60 days'", with: "AND 1 = 1" },
      },
      {
        name: "a demo client's case holding another client's letter",
        rows: [client(8, { is_demo: true }), dcase(15, 8), letter(10, 1, "generated", { case_id: id(515) })],
        breaks: { piece: "AND COALESCE(cl.is_demo, false) = false", with: "AND 1 = 1" },
      },
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
    // Two rows of one (case, bureau, round, target) can never BOTH carry mailed_at: migration 332's
    // unique index uq_dispute_letters_one_mailing refuses the second, on the real database. So a twin
    // is read where the index cannot see it: another letter of the same case, bureau, round and target
    // that is already out by its status (sending, sent, delivered) with no stamp, or one provider
    // letter id recorded on two rows (one envelope in the post, written down twice).
    good: [...BASE, letter(1, 1, "sent", { mailed_at: ago(2), send_claimed_at: ago(2), postgrid_letter_id: "letter_1" }),
      // another bureau, same case and round: not a twin
      letter(8, 1, "sent", { bureau: "EQ", mailed_at: ago(2), send_claimed_at: ago(2), postgrid_letter_id: "letter_8" }),
      // a replacement staged for the same letter that was not mailed: still waiting, not out
      letter(9, 1, "generated")],
    bad: [
      { name: "a furnisher letter mailed with no address on file", rows: [letter(2, 1, "sent", { case_id: id(502), target: "furnisher", furnisher_address_id: null, mailed_at: ago(2), send_claimed_at: ago(2) })], breaks: "FILTER (WHERE (dl.target = 'furnisher' AND dl.furnisher_address_id IS NULL)" },
      { name: "a mailed letter with no bureau", rows: [letter(3, 1, "sent", { case_id: id(503), bureau: "", mailed_at: ago(2), send_claimed_at: ago(2) })], breaks: "OR NULLIF(BTRIM(COALESCE(dl.bureau, '')), '') IS NULL" },
      {
        name: "a letter that is out twice: two rows of one case, bureau, round and target both read sent",
        rows: [letter(5, 1, "sent", { case_id: id(504), bureau: "TU", send_claimed_at: ago(1) }),
          letter(6, 1, "sent", { case_id: id(504), bureau: "TU", send_claimed_at: null })],
        breaks: "OR EXISTS ( SELECT 1 FROM dispute_letters o WHERE o.org_id = dl.org_id AND o.case_id = dl.case_id AND o.bureau = dl.bureau",
        expectBad: 2,
        extraSamples: 2,
      },
      {
        name: "one provider letter id recorded on two letters",
        rows: [letter(10, 1, "sent", { case_id: id(505), bureau: "TU", mailed_at: ago(1), send_claimed_at: ago(1), postgrid_letter_id: "letter_dup" }),
          letter(11, 1, "sent", { case_id: id(506), bureau: "EQ", mailed_at: ago(1), send_claimed_at: ago(1), postgrid_letter_id: "letter_dup" })],
        breaks: "OR (dl.postgrid_letter_id IS NOT NULL AND EXISTS (",
        expectBad: 2,
        extraSamples: 2,
      },
    ],
    ignored: [
      {
        name: "a twin pair created 40 days ago",
        rows: [letter(12, 1, "sent", { case_id: id(507), bureau: "TU", created_at: ago(40), send_claimed_at: ago(40) }),
          letter(13, 1, "sent", { case_id: id(507), bureau: "TU", created_at: ago(40), send_claimed_at: null })],
        breaks: { piece: "AND dl.created_at >= now() - interval '30 days'", with: "AND 1 = 1" },
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
