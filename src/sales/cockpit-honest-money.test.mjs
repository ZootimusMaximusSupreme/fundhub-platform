// THE NUMBERS ON THE CALL SCREEN ARE SOURCED, OR THEY SAY THEY ARE NOT.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT THIS PREVENTS
//
// Every one of these was live on public/app/closer-dashboard.html on
// 2026-08-30, and each one is the same mistake wearing different clothes: a
// screen stating something it does not know.
//
//   1. THE SUCCESS FEE WAS A CONSTANT. cockpit.mjs set success_fee_percent to
//      0.10 flat, so the screen printed "10%" whatever the file said, on a row
//      labelled "Success fee" as if it were this round's agreed number.
//      funding_closeout.fee_percent is the real column and had NO reader on any
//      staff screen. The fee the work earned was invisible to the person who
//      earned it.
//
//   2. THE TIME OF THE CALL WAS AN INFERENCE. The payload carried no field
//      meaning "the time of THIS call", so the screen took the head of
//      up_next[] and hoped. On a deep link to a client with no booked task that
//      is somebody else's appointment, printed beside this client's name.
//
//   3. ZERO STOOD IN FOR UNKNOWN. Two of the three funding bands read
//      totals.total_personal_funding / total_combined_funding, and the engine
//      returns those as the NUMBER 0 — never null — when it has nothing to work
//      with. A client with no credit pull showed "Realistic $0". A closer reads
//      that as "this person can get nothing". It means "nobody has pulled their
//      credit." CLAUDE.md §12: NULL means unknown and must survive.
//
//   4. THE BROWSER PICKED WHICH MONEY THE CALL EARNED. closer-call.js posted a
//      transaction_id it had read from a payment query with NO TIME BOUND, and
//      call-outcomes.mjs trusts an explicit id over its own 48-hour window. A
//      repeat client who paid $500 four months ago and closed for $1,000 today
//      had the four-month-old payment logged as today's cash.
//
// The first three are checked by RUNNING buildCockpit against a stub database,
// not by reading it. The fourth is checked in the browser file, in the same
// style as src/http/closer-ui-honest.test.mjs, because there is no DOM harness
// in this repo and inventing one for four assertions is not the trade.

import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { buildCockpit } from "./cockpit.mjs";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..", "..");
const APP = path.join(ROOT, "public", "app");

const ORG = "11111111-1111-1111-1111-111111111111";
const STAFF = "22222222-2222-2222-2222-222222222222";
const CLIENT = "33333333-3333-3333-3333-333333333333";

/**
 * A database that answers by table rather than by call order, so adding a query
 * to buildCockpit does not silently shift every fixture by one and turn these
 * tests into nonsense that still passes.
 */
function stubDb(overrides = {}) {
  const rows = {
    clients: [{
      id: CLIENT, first_name: "Ada", last_name: "Byron", email: "ada@example.com",
      custom_fields: {}, tags: [], business_name: null, age_months: null
    }],
    staff: [{ name: "A Closer" }],
    ...overrides
  };
  const seen = [];
  return {
    seen,
    async query(sql, params) {
      seen.push(sql);
      const flat = String(sql).replace(/\s+/g, " ");
      // most specific first — `FROM funding_rounds fr` also contains "clients"
      // nowhere, but `FROM clients c` and `JOIN clients` both exist in the file.
      if (/FROM clients c\b/.test(flat) && /WHERE c\.id/.test(flat)) return { rows: rows.clients };
      if (/FROM staff\b/.test(flat)) return { rows: rows.staff };
      if (/FROM funding_rounds fr\b/.test(flat)) return { rows: rows.funding_rounds || [] };
      // `FROM tasks nt` is nextCallAfter()'s own one-row question and must NOT
      // be answered out of the up_next fixture — the whole point of that query
      // is that it does not come from the same list.
      if (/FROM tasks nt\b/.test(flat)) return { rows: rows.next_task || [] };
      if (/FROM tasks t\b/.test(flat)) return { rows: rows.tasks || [] };
      if (/FROM transactions\b/.test(flat)) return { rows: rows.transactions || [] };
      if (/FROM crs_results\b/.test(flat)) return { rows: rows.crs_results || [] };
      if (/FROM tradelines\b/.test(flat)) return { rows: rows.tradelines || [] };
      if (/FROM call_outcomes\b/.test(flat)) return { rows: [{}] };
      return { rows: [] };
    }
  };
}

describe("the call screen's money is sourced or it says it is not", () => {
  // ───────────────────────────────────────────────────────────────────────
  // 1. THE SUCCESS FEE
  // ───────────────────────────────────────────────────────────────────────
  test("the success fee comes from funding_closeout when a closeout row exists", async () => {
    const db = stubDb({
      funding_rounds: [{
        id: "44444444-4444-4444-4444-444444444444",
        fee_percent: "0.1500", total_fee: "3000.00",
        total_approved_amount: "20000.00", closeout_status: "open"
      }]
    });
    const out = await buildCockpit(db, { orgId: ORG, staffId: STAFF, clientId: CLIENT });
    assert.equal(out.deal.success_fee_percent, 0.15,
      "15% on the closeout row must reach the screen as 15%, not as the house 10%");
    assert.equal(out.deal.success_fee_source, "closeout");
    assert.equal(out.deal.closeout_total_fee, 3000);
    assert.ok(
      db.seen.some((s) => /funding_closeout/.test(s)),
      "buildCockpit must actually read funding_closeout — it selected the round id and threw it away for months"
    );
  });

  test("with no closeout row the fee is the house default AND says so", async () => {
    const db = stubDb({ funding_rounds: [{ id: "44444444-4444-4444-4444-444444444444", fee_percent: null }] });
    const out = await buildCockpit(db, { orgId: ORG, staffId: STAFF, clientId: CLIENT });
    assert.equal(out.deal.success_fee_percent, 0.10);
    assert.equal(out.deal.success_fee_source, "default",
      "a default stated as if it were the agreed fee is the whole problem this file exists for");
    assert.match(out.deal.success_fee_note, /default/i);
  });

  // ───────────────────────────────────────────────────────────────────────
  // 2. THE TIME OF THIS CALL
  // ───────────────────────────────────────────────────────────────────────
  test("current_call is this client's booked task, as a real field", async () => {
    const due = new Date("2026-09-01T17:00:00.000Z");
    const db = stubDb({
      tasks: [{ task_id: "t-1", client_id: CLIENT, due_at: due, title: "Closing call", meeting_url: null, name: "Ada Byron" }]
    });
    const out = await buildCockpit(db, { orgId: ORG, staffId: STAFF, clientId: CLIENT });
    assert.ok(out.current_call, "the headline's time must be a field, not something the screen infers");
    assert.equal(out.current_call.task_id, "t-1");
    assert.equal(new Date(out.current_call.due_at).toISOString(), due.toISOString());
  });

  test("join_url belongs to the exact current call, not this client's later call", async () => {
    const current = new Date("2026-09-01T17:00:00.000Z");
    const later = new Date("2026-09-01T23:00:00.000Z");
    const db = stubDb({ tasks: [
      { task_id: "t-current", client_id: CLIENT, due_at: current, title: "Closing call", meeting_url: "https://meet.google.com/current-call" },
      { task_id: "t-later", client_id: CLIENT, due_at: later, title: "Follow-up", meeting_url: "https://meet.google.com/later-call" }
    ] });
    const out = await buildCockpit(db, { orgId: ORG, staffId: STAFF, clientId: CLIENT });
    assert.equal(out.current_call.task_id, "t-current");
    assert.equal(out.join_url, "https://meet.google.com/current-call");
    assert.equal(db.seen.filter((sql) => /SELECT meeting_url FROM tasks/.test(sql)).length, 0);
  });

  test("next_call is its own question, not the second row of up_next", async () => {
    const due = new Date("2026-09-01T17:00:00.000Z");
    const db = stubDb({
      // up_next holds THIS client's own later task ahead of everybody else's,
      // which is what the ORDER BY does. Reading "next" off it named 4:00 PM.
      tasks: [
        { task_id: "t-1", client_id: CLIENT, due_at: due, title: "Closing call", name: "Ada Byron" },
        { task_id: "t-late", client_id: CLIENT, due_at: new Date("2026-09-01T23:00:00.000Z"), title: "Follow-up", name: "Ada Byron" },
        { task_id: "t-real", client_id: "99999999-9999-9999-9999-999999999999", due_at: new Date("2026-09-01T18:00:00.000Z"), title: "Closing call", name: "Sam" }
      ],
      next_task: [{
        task_id: "t-real", client_id: "99999999-9999-9999-9999-999999999999",
        due_at: new Date("2026-09-01T18:00:00.000Z"), name: "Sam"
      }]
    });
    const out = await buildCockpit(db, { orgId: ORG, staffId: STAFF, clientId: CLIENT });
    assert.equal(out.next_call.task_id, "t-real",
      "the call after this one is the closer's real next appointment, not this client's own later task");
    assert.ok(
      db.seen.some((s) => /FROM tasks nt\b/.test(String(s).replace(/\s+/g, " "))),
      "buildCockpit must ASK for the next call. up_next is ordered client-first and cut at " +
      "LIMIT 5, so the answer is not in it at any ordering — see cockpit-next-call.pg.test.mjs."
    );
  });

  test("next_call is null, never missing, when nothing follows this call", async () => {
    const db = stubDb({
      tasks: [{ task_id: "t-1", client_id: CLIENT, due_at: new Date("2026-09-01T17:00:00.000Z"), title: "Closing call", name: "Ada Byron" }]
    });
    const out = await buildCockpit(db, { orgId: ORG, staffId: STAFF, clientId: CLIENT });
    assert.ok("next_call" in out,
      'the key must always be on the payload — an absent field and "no later call" are ' +
      'different answers and the screen prints "nothing after this" for the second one');
    assert.equal(out.next_call, null);
  });

  test("current_call is null when the next booked call belongs to somebody else", async () => {
    const db = stubDb({
      tasks: [{ task_id: "t-9", client_id: "99999999-9999-9999-9999-999999999999", due_at: new Date(), title: "Someone else", name: "Other" }]
    });
    const out = await buildCockpit(db, { orgId: ORG, staffId: STAFF, clientId: CLIENT });
    assert.equal(out.current_call, null,
      "a deep link to a client with no booked task must show no time — not the next person's");
  });

  // ───────────────────────────────────────────────────────────────────────
  // 3. ZERO IS NOT UNKNOWN
  // ───────────────────────────────────────────────────────────────────────
  test("an empty file still returns 0 from the engine, which is why the screen must not print it", async () => {
    const out = await buildCockpit(stubDb(), { orgId: ORG, staffId: STAFF, clientId: CLIENT });
    // This is the engine's behaviour, asserted so the paint-path rule below has
    // a reason on the record rather than a claim in a comment.
    assert.equal(out.underwrite.lite_banner_funding, null);
    assert.equal(out.underwrite.totals.total_personal_funding, 0);
    assert.equal(out.underwrite.totals.total_combined_funding, 0);
    assert.equal(out.credit.available, false,
      "no crs_results row means no pull on file, which is what the bands must say");
  });

  test("a client with no name reads as unknown, not as a person called Client", async () => {
    const db = stubDb({
      clients: [{ id: CLIENT, first_name: null, last_name: null, email: null, custom_fields: {}, tags: [] }]
    });
    const out = await buildCockpit(db, { orgId: ORG, staffId: STAFF, clientId: CLIENT });
    assert.equal(out.client.name, "Name not on file",
      '"Client" in a 32px headline reads as a real answer');
  });

  test("the offer catalog rides on this one read, so the pay link needs no second one", async () => {
    const out = await buildCockpit(stubDb(), { orgId: ORG, staffId: STAFF, clientId: CLIENT });
    assert.ok(Array.isArray(out.offers) && out.offers.length > 0);
    assert.ok(out.offers.every((o) => o.key && o.name),
      "the pay-link picker needs a key and a name for every row");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// THE PAINT PATH
// ═════════════════════════════════════════════════════════════════════════════
describe("closer-call.js never states what it does not know", () => {
  const js = () => fs.readFileSync(path.join(APP, "closer-call.js"), "utf8");
  const html = () => fs.readFileSync(path.join(APP, "closer-dashboard.html"), "utf8");

  test("the browser does not choose which payment the call earned", () => {
    const src = js();
    assert.ok(
      !/transaction_id:\s*state\.transactionId/.test(src),
      "closer-call.js is posting a transaction_id again.\n\n" +
      "buildCockpit's payment query has NO time bound, and resolveCashCollected in\n" +
      "src/sales/call-outcomes.mjs uses an explicit id DIRECTLY, skipping the 48-hour window at\n" +
      "its own line 73 that is what makes cash mean 'money from this call'. So a repeat client\n" +
      "who paid four months ago has that old amount logged against today's close, low and\n" +
      "misattributed, and only for repeat payers — the downsell and second-round clients.\n" +
      "Let the server resolve it inside its own window."
    );
    assert.ok(!/state\.transactionId/.test(src), "the stale id must not be kept at all");
  });

  test("the headline's 'next' is not picked out of up_next", () => {
    const src = js();
    // Comments stripped first: this is a rule about what the code reads, and
    // the comment inside paintWhen names up_next on purpose, to say why not.
    const paintWhen = src
      .slice(src.indexOf("function paintWhen"), src.indexOf("function paint(data)"))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    assert.ok(paintWhen.length > 100, "paintWhen moved — this guard is reading the wrong slice");
    assert.ok(
      !/up_next/.test(paintWhen),
      "paintWhen is reading up_next again.\n\n" +
      "up_next is ordered `CASE WHEN t.client_id = $3 THEN 0 ELSE 1 END, t.due_at ASC` and cut at\n" +
      "LIMIT 5. Measured against a real Postgres: the open client at 3:00 PM with somebody else at\n" +
      "11:00 AM printed 'next 11:00 AM' — four hours BEFORE the call it sat beside. The open client\n" +
      "with 10:00 AM and 4:00 PM, and somebody else at 11:00 AM, printed 'next 4:00 PM' and never\n" +
      "named the 11:00. And with five other calls on the day the LIMIT drops the real next one, so\n" +
      "even sorting the array answers 'nothing after this' over a call that exists.\n" +
      "Use data.next_call (src/sales/cockpit.mjs nextCallAfter)."
    );
    assert.match(paintWhen, /data\.next_call/,
      "the call after this one comes from the server's own one-row query");
  });

  test("a call on another day is not printed as a bare clock time", () => {
    const src = js();
    assert.match(src, /function whenText/,
      "upcomingCalls keeps THIS client's tasks from date_trunc('day', now()) onward, not just " +
      "today, so a deep link to somebody booked next Tuesday rendered a flat '2:00 PM' with " +
      "nothing to say which day. whenText() puts the date on the front when it is not today.");
    assert.ok(!/function clockTime/.test(src),
      "the date-blind helper is back; every caller of it prints a time that is only true on today");
  });

  test("the funding bands keep 'no pull' and 'nothing fundable' apart", () => {
    const src = js();
    assert.match(src, /pullOnFile/,
      "the bands must know whether a credit pull exists before printing a dollar figure");
    assert.match(src, /cents === 0/,
      "a computed zero must be handled as its own case — money() renders it as a confident $0");
    assert.ok(
      !/totals\.total_combined_funding\s*!=\s*null\s*\?[^:]*:\s*realDollars/.test(src),
      "the dead fallback is back: it prints the realistic figure under the third band's label, " +
      "i.e. the same number twice with one of them wrong"
    );
  });

  test("the third band is labelled as the sum it actually is", () => {
    assert.match(js(), /Personal \+ business stacked/,
      "total_combined_funding is personal funding PLUS business stacking " +
      "(src/underwrite/business-funding.mjs). It is NOT the engine's `optimization` block, " +
      "which this screen never reads, so 'After optimization' was a wrong label on a real number.");
    assert.ok(!/After optimization/.test(html()), "the old label is still in the markup");
  });

  test("the anchor is the client, and the signed-in staff member is not above them", () => {
    const markup = html();
    assert.ok(!/class="stat-head"/.test(markup),
      "the closer's own name is back in a band above the client's — UI-STANDARDS §12 rule 1 " +
      "says the top-left is never their own name");
    assert.match(markup, /id="whoName"/, "the signed-in name still has to exist, in the topbar right");
    assert.match(markup, /id="ccp-call-when"/, "the time of the call belongs beside the name");
    assert.ok(!/\?client_id=&lt;uuid&gt;/.test(markup),
      "the loading state was showing the closer a developer instruction");
  });

  test("a failed read uses the house wording, not a machine word", () => {
    const src = js();
    assert.match(src, /FHData\.explain\(/,
      "FHData.explain (public/app/data.js:579) is the one place the app's error copy is written");
    assert.ok(!/Could not load cockpit \(/.test(src),
      '"Could not load cockpit (nodb)" names a system the closer cannot check');
  });

  test("the pay link is on this screen and uses the deck's own write path", () => {
    const src = js();
    const markup = html();
    assert.match(markup, /id="fh-pay-link"/, "taking money must not mean switching tabs to slide 23");
    assert.match(src, /action:\s*"send_pay_link"/, "one send path — POST /api/closer-deck, not a new endpoint");
    assert.ok(!/\/api\/read\/closer-deck/.test(src),
      "a second shared client read on this screen is a FAIL against " +
      "docs/specs/CLOSER-DASHBOARD-SCREEN-MERGE-BUILD-SPEC.md §4 — the offer list rides on closer-call");
  });

  test("the compliance checklist sits above Up next in the rail", () => {
    const markup = html();
    const closeIdx = markup.indexOf("Before you close");
    const nextIdx = markup.indexOf("<h4>Up next</h4>");
    assert.ok(closeIdx > 0 && nextIdx > 0, "both rail sections must still exist");
    assert.ok(closeIdx < nextIdx,
      "on a 900px laptop the five things a closer must not miss were falling below the fold " +
      "under a list of calls that have not started yet. Urgency below reference is backwards.");
    assert.match(markup, /data-fh-up-next/,
      "closer-call.js must find Up next by name — an index would paint calls into the checklist");
  });
});
