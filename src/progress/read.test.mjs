// The pure shaping rules behind /api/read/client-progress. Everything that
// needs a database is proved in src/http/client-progress.pg.test.mjs instead.

import { test, describe } from "node:test";
import assert from "node:assert";
import {
  nextStepOf, waitingOn, paidRoundOffer, roundNumber, PAID_ROUND_SERVICE_KIND,
  readClientProgress, ownedNotReady, DOCUMENT_ENTITLEMENTS
} from "./read.mjs";
import { isKnownSubtype } from "../documents/kinds.mjs";
import { ROUND_BASE_CENTS, CREDITOR_LETTER_CENTS, ESCALATION_FILINGS_CENTS } from "../waypoints/pricing.mjs";

const wp = (over = {}) => ({
  id: "w1", order: 1, title: "t", owner: "client", state: "not_started",
  dueAt: null, overdue: false, completedAt: null, paidAlternative: null, ...over
});

describe("nextStep names exactly one waypoint", () => {
  test("the client's own open work comes first, even when FundHub owes something earlier", () => {
    const next = nextStepOf([
      wp({ id: "a", owner: "fundhub", order: 1 }),
      wp({ id: "b", owner: "client", order: 2 })
    ]);
    assert.deepEqual(next, { waypointId: "b", owner: "client" });
  });

  test("with nothing owed by the client it names what FundHub owes", () => {
    const next = nextStepOf([
      wp({ id: "a", owner: "client", state: "done", completedAt: "2026-01-01T00:00:00Z" }),
      wp({ id: "b", owner: "fundhub" })
    ]);
    assert.deepEqual(next, { waypointId: "b", owner: "fundhub" });
  });

  test("a blocked row is still open work and can be the next step", () => {
    assert.deepEqual(nextStepOf([wp({ id: "c", state: "blocked" })]),
      { waypointId: "c", owner: "client" });
  });

  test("done and skipped rows are never the next step", () => {
    assert.strictEqual(nextStepOf([
      wp({ id: "a", state: "done", completedAt: "2026-01-01T00:00:00Z" }),
      wp({ id: "b", state: "skipped" })
    ]), null);
  });

  test("no waypoints at all is null, not an invented step", () => {
    assert.strictEqual(nextStepOf([]), null);
  });
});

describe("waitingOn", () => {
  test("the bureaus win while the letters are out, whatever the checklist says", () => {
    const next = { waypointId: "w", owner: "client" };
    assert.equal(waitingOn({ stageKey: "in_transit", next }), "bureaus");
    assert.equal(waitingOn({ stageKey: "awaiting_response", next }), "bureaus");
  });

  test("otherwise it follows whoever owns the next step", () => {
    assert.equal(waitingOn({ stageKey: "analysis", next: { owner: "client" } }), "client");
    assert.equal(waitingOn({ stageKey: "analysis", next: { owner: "fundhub" } }), "fundhub");
  });

  test("unknown stage with nothing open is null, not a guess at fundhub", () => {
    assert.strictEqual(waitingOn({ stageKey: null, next: null }), null);
  });
});

describe("the paid round offer", () => {
  test("prices come from src/waypoints/pricing.mjs and are integer cents", () => {
    const offer = paidRoundOffer({ repairPath: true });
    const by = Object.fromEntries(offer.components.map((c) => [c.key, c]));
    /* THE CONTRACT'S KEYS, not the internal line codes. These were round_base /
       creditor_letter / escalation_filings — src/waypoints/pricing.mjs's private
       spelling — while GET /api/paid-services and
       ops/workflows/portal-progress-contract.md:108-110 both said base /
       creditor / cfpb_and_ag. Two reads of one product, two sets of keys, and the
       screen decides which extras to buy from them. The prices are still asserted
       against the same constants, so this is not a looser test. */
    assert.equal(by.base.priceCents, ROUND_BASE_CENTS);
    assert.equal(by.creditor.priceCents, CREDITOR_LETTER_CENTS);
    assert.equal(by.cfpb_and_ag.priceCents, ESCALATION_FILINGS_CENTS);
    assert.deepEqual(Object.keys(by), ["base", "creditor", "cfpb_and_ag"],
      "the keys a screen maps its checkboxes from are the contract's");
    for (const c of offer.components) assert.ok(Number.isInteger(c.priceCents));
  });

  test("only the base is required; the two add-ons are optional", () => {
    const offer = paidRoundOffer({ repairPath: true });
    assert.deepEqual(offer.components.map((c) => c.required), [true, false, false]);
  });

  test("an open request makes it inFlight, so a second press can be refused", () => {
    for (const status of ["quoted", "awaiting_payment", "paid", "staged"]) {
      const offer = paidRoundOffer({
        repairPath: true,
        paidRows: [{ service_kind: PAID_ROUND_SERVICE_KIND, status }]
      });
      assert.equal(offer.inFlight, true, status);
      assert.equal(offer.available, false, status);
    }
  });

  test("a finished request does not block the next one", () => {
    for (const status of ["failed", "cancelled", "refunded", "fulfilled"]) {
      const offer = paidRoundOffer({
        repairPath: true,
        paidRows: [{ service_kind: PAID_ROUND_SERVICE_KIND, status }]
      });
      assert.equal(offer.inFlight, false, status);
      assert.equal(offer.available, true, status);
    }
  });

  test("a client not on the optimisation path is not offered a round", () => {
    assert.equal(paidRoundOffer({ repairPath: false }).available, false);
  });

  test("a credit pull request in flight does not block a dispute round", () => {
    const offer = paidRoundOffer({
      repairPath: true,
      paidRows: [{ service_kind: "credit_pull", status: "paid" }]
    });
    assert.equal(offer.inFlight, false);
  });
});

describe("roundNumber", () => {
  test("R3 is 3", () => assert.equal(roundNumber("R3"), 3));
  test("R6 is 6", () => assert.equal(roundNumber("R6"), 6));
  test("FURNISHER is not a rung and is null, never zero", () => {
    assert.strictEqual(roundNumber("FURNISHER"), null);
  });
  test("null and nonsense are null, never zero", () => {
    assert.strictEqual(roundNumber(null), null);
    assert.strictEqual(roundNumber(""), null);
    assert.strictEqual(roundNumber("R0"), null);
    assert.strictEqual(roundNumber("banana"), null);
  });
});

/* ── HOLE N13, 2026-09-18 ──────────────────────────────────────────────────
   Live, Sim Twelve-Academy (f01cc0e0) held a live funding-snapshot grant from
   15:13 UTC with no Funding Snapshot saved, had signed its Funding Agreement,
   had paid twice, and had a funding round started at 15:13. /progress.html said
   "Your documents appear here once they are ready." and "Nothing has happened
   on your file yet." — both empty, because the read never looked at grants or
   at the milestone events.

   The fake database below answers with #12's own live shape (names and times
   only): two live grants (the snapshot and the course) and one lapsed one, no
   deliverable documents, and #12's real event names — the milestones among the
   internal ones. Every other read answers empty. */
describe("hole N13 — what a funding client owns and what has happened", () => {
  const TWELVE_EVENTS = [
    { ts: "2026-09-18T18:20:59.394Z", name: "message.queued" },
    { ts: "2026-09-18T15:13:33.171Z", name: "inquiry.gate.raised" },
    { ts: "2026-09-18T15:13:32.110Z", name: "inquiry.docs.needed" },
    { ts: "2026-09-18T15:13:28.390Z", name: "deposit.paid" },
    { ts: "2026-09-18T15:13:27.565Z", name: "round.started" },
    { ts: "2026-09-18T15:13:24.830Z", name: "payment.received" },
    { ts: "2026-09-17T18:53:56.552Z", name: "contract.signed" },
    { ts: "2026-09-17T18:05:22.089Z", name: "contract.sent" },
    { ts: "2026-09-17T17:46:32.205Z", name: "payment.received" },
    { ts: "2026-09-17T17:44:32.204Z", name: "decision.rendered" },
    { ts: "2026-09-17T06:23:29.931Z", name: "booking.created" },
    { ts: "2026-09-17T06:23:28.701Z", name: "entry.captured" }
  ];

  function twelveDb({ documents = [] } = {}) {
    return {
      async query(sql, params = []) {
        const s = String(sql);
        if (/FROM entitlement_catalog/i.test(s)) {
          return { rows: [
            { code: "funding-snapshot", name: "Funding Snapshot", kind: "deliverable",
              sort_order: 30, active: true, granted_at: "2026-09-18T15:13:26.904Z" },
            { code: "funding-mastery-course", name: "Funding Mastery course (A to Z)",
              kind: "deliverable", sort_order: 60, active: true,
              granted_at: "2026-09-17T17:46:33.615Z" },
            { code: "credit-analysis-report", name: "Credit Analysis Report",
              kind: "deliverable", sort_order: 10, active: false, granted_at: null }
          ] };
        }
        if (/FROM documents/i.test(s) && /kind = 'deliverable'/.test(s)) return { rows: documents };
        if (/FROM events/i.test(s)) {
          const names = Array.isArray(params[2]) ? params[2] : [];
          return { rows: TWELVE_EVENTS.filter((e) => names.includes(e.name)) };
        }
        return { rows: [] };
      }
    };
  }

  const ids = {
    orgId: "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6",
    clientId: "f01cc0e0-c8f6-4343-93e5-6a33f0d3112f"
  };

  test("an owned Funding Snapshot with nothing built is named, not hidden", async () => {
    const payload = await readClientProgress(twelveDb(), ids);
    assert.deepEqual(payload.deliverables, [], "no document is invented");
    assert.deepEqual(payload.ownedNotReady, [
      { code: "funding-snapshot", subtype: "funding_snapshot", name: "Funding Snapshot" }
    ], "the grant shows as owned and not ready; the course is not a document and a lapsed grant is not owned");
  });

  test("what happened is on the timeline, newest first, and nothing internal is", async () => {
    const payload = await readClientProgress(twelveDb(), ids);
    const got = payload.timeline.map((l) => [l.at, l.text.replace(/^.* · /, "")]);
    assert.deepEqual(got, [
      ["2026-09-18T15:13:27.565Z", "funding round started"],
      ["2026-09-18T15:13:24.830Z", "payment received"],
      ["2026-09-17T18:53:56.552Z", "agreement signed"],
      ["2026-09-17T17:46:32.205Z", "payment received"]
    ]);
    for (const line of payload.timeline) {
      assert.doesNotMatch(line.text, /message|queued|deposit|inquiry|gate|entry|decision|booking|sent/i,
        `an internal event reached the client: ${line.text}`);
    }
  });

  test("once the document is saved it is a deliverable and no longer 'not ready'", async () => {
    const payload = await readClientProgress(twelveDb({ documents: [
      { id: "d1", subtype: "funding_snapshot", title: "Funding Snapshot",
        generated_at: "2026-09-19T00:00:00Z" }
    ] }), ids);
    assert.equal(payload.deliverables.length, 1);
    assert.deepEqual(payload.ownedNotReady, []);
  });

  test("an unreadable grants table costs the not-ready list and nothing else", async () => {
    const base = twelveDb();
    const db = { async query(sql, params) {
      if (/FROM entitlement_catalog/i.test(String(sql))) throw new Error("boom");
      return base.query(sql, params);
    } };
    const payload = await readClientProgress(db, ids);
    assert.deepEqual(payload.ownedNotReady, []);
    assert.equal(payload.timeline.length, 4);
  });
});

describe("ownedNotReady", () => {
  const held = (...codes) => codes.map((code) => ({ code, name: null }));

  test("no grant, no row — nothing is invented", () => {
    assert.deepEqual(ownedNotReady([], []), []);
    assert.deepEqual(ownedNotReady(held("funding-mastery-course"), []), []);
  });

  test("a grant with its document on file is not listed", () => {
    assert.deepEqual(ownedNotReady(held("funding-snapshot"), [{ subtype: "funding_snapshot" }]), []);
  });

  test("with no catalogue name the document's own title is used", () => {
    assert.deepEqual(ownedNotReady(held("bank-lender-match-list"), []), [
      { code: "bank-lender-match-list", subtype: "bank_lender_match_list",
        name: "Bank and Lender Match List" }
    ]);
  });

  test("every document grant maps to a known deliverable subtype", () => {
    for (const { subtype } of DOCUMENT_ENTITLEMENTS) {
      assert.ok(isKnownSubtype("deliverable", subtype), subtype);
    }
  });

  test("the Blueprint's letter pack is ready when its funding letters are on file (hole 2 rule)", () => {
    const docs = [{ subtype: "funding_inquiry_removal" }, { subtype: "credit_optimization_roadmap" }];
    assert.deepEqual(ownedNotReady(held("metro2-letter-pack", "credit-optimization-roadmap"), docs), []);
  });

  test("a letter pack with no letters of any kind is not ready", () => {
    assert.deepEqual(ownedNotReady(held("metro2-letter-pack"), []).map((r) => r.code),
      ["metro2-letter-pack"]);
  });
});


test("the public progress view exposes the stored stable waypoint key without changing its state", async () => {
  const row = { id: "mail-step", key: "blueprint_dispute_mail_letters", position: 12,
    title: "Renamed stored letter task", detail: "Stored instructions", owner_kind: "client", state: "not_started" };
  const db = { query: async sql => ({ rows: /FROM client_waypoints/.test(sql) ? [row] : [] }) };
  const out = await readClientProgress(db, { orgId: "11111111-1111-4111-8111-111111111111", clientId: "22222222-2222-4222-8222-222222222222" });
  assert.equal(out.waypoints[0].key, "blueprint_dispute_mail_letters");
  assert.equal(out.waypoints[0].title, row.title);
  assert.equal(out.waypoints[0].state, "not_started");
  assert.deepEqual(out.nextStep, { waypointId: row.id, owner: "client" });
  assert.equal(row.state, "not_started");
});
