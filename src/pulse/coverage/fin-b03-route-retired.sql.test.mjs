// Batch 03 (finish the 853): the retired closer-deck send_ebook check, its SQL and its judge, on a real SQL engine.
//
// The statements the check sends are run unchanged on node:sqlite (built into Node 22) against tables built for
// each case (fin-b03-route-retired-kit.mjs). The engine runs the statement, so a wrong table, a condition added
// or flipped, a dropped column or a dropped filter changes what comes back and a test here goes red. Postgres is
// not on this Mac; fin-b03-route-retired.pg.test.mjs runs the same strings on Postgres where a database is set.
//
// This file imports only the check itself and the kit, so it runs in seconds. The wiring into the route lane, the
// real closer-deck handler and the morning audit are in fin-b03-route-retired.test.mjs.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  AFTER, AT_CUTOFF, JUST_BEFORE, LANE_ORG, LINK_REF, LONG_AGO, OTHER_ORG,
  email, link, marker, plainClient, scratch,
} from "./fin-b03-route-retired-kit.mjs";
import {
  EBOOK_TRACES,
  RETIRED_ROUTE_ACTIONS,
  TRACE_ROW_CAP,
  ebookTraceSql,
  judgeRetiredRoute,
  retiredRouteEntryForArgs,
  verifyRetiredRoute,
} from "./fin-b03-route-retired.mjs";

const ENTRY = RETIRED_ROUTE_ACTIONS[0];
const ROW = { id: "catalog-route:routes-1.json:route:closer-deck:send_ebook", sourceFile: ENTRY.sourceFile, surface: ENTRY.surface, control: ENTRY.control };
const CODE_ARGS = { sourceFile: ENTRY.sourceFile, surface: ENTRY.surface, control: ENTRY.control, action: ENTRY.action };

/** The row the lane would give for this made-up database. */
const judged = (rows, ctx = {}) => judgeRetiredRoute(ROW, ENTRY, { db: scratch(rows), orgId: LANE_ORG, ...ctx });
const verified = (rows, ctx = {}) => verifyRetiredRoute(CODE_ARGS, { db: scratch(rows), orgId: LANE_ORG, ...ctx });

/* ---- what the check is built on ---- */

test("the cutoff is the first live ship that carried the retirement, as the ship log says", () => {
  const log = fs.readFileSync(new URL("../../../ops/ship-log.md", import.meta.url), "utf8");
  const line = log.split("\n").find((text) => text.includes("| bfd16774 |"));
  assert.ok(line, "the ship log has no bfd16774 line");
  const [, day, hour, minute] = /\| (\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}) \|/.exec(line);
  // Arizona has no daylight saving: UTC is seven hours ahead.
  const utc = new Date(`${day}T${hour}:${minute}:00Z`);
  utc.setUTCHours(utc.getUTCHours() + 7);
  assert.equal(utc.toISOString(), ENTRY.liveSince);
});

test("the three traces are the three things the old action wrote", () => {
  assert.deepEqual(EBOOK_TRACES.map((trace) => trace.key), ["marker", "link", "message"]);
  const [markerSql, linkSql, messageSql] = EBOOK_TRACES.map((trace) => ebookTraceSql(trace, false));
  assert.match(markerSql, /FROM clients c\b/);
  assert.match(markerSql, /closer_deck_ebook_sent_at/);
  assert.match(linkSql, /FROM payment_links p\b/);
  assert.match(messageSql, /FROM messages m\b/);
  assert.match(messageSql, /staff:ebook-send:%/);
});

/* ---- nothing saved ---- */

test("no e-book send on any trace: nothing to judge, with the closed reason and exact arguments", async () => {
  const row = await judged({
    clients: [plainClient(), plainClient(OTHER_ORG)],
    // Look-alikes that are not the retired send: other words, other purposes, other send keys.
    links: [
      link(AFTER, "Facebook ads setup"),
      link(AFTER, "Notebook bundle"),
      link(AFTER, "Roadmap"),
      link(AFTER, null),
      link(AFTER, "Fundhub e-book", { purpose: "deposit" }),
    ],
    messages: [email(AFTER, "staff:soft-pull-send:abc"), email(AFTER, null), email(AFTER, "wf:evt-1:welcome")],
  });
  assert.equal(row.status, "na");
  assert.equal(row.id, ROW.id);
  assert.deepEqual(row.na, { code: "catalog-route-retired-action", args: CODE_ARGS });
  assert.match(row.detail, /No e-book send was ever saved/);
  assert.ok(row.detail.includes(ROW.surface) && row.detail.includes(ROW.control));
  assert.equal(row.suggestedFix, null);
});

test("sends saved before the cutoff are history: still nothing to judge, and what was saved is said", async () => {
  const row = await judged({
    clients: [marker(LONG_AGO), marker(JUST_BEFORE), plainClient()],
    links: [link(LONG_AGO)],
    messages: [email(JUST_BEFORE)],
  });
  assert.equal(row.status, "na");
  assert.match(row.detail, /Saved before it went off: 2 client files, 1 pay link, 1 email/);
});

/* ---- a send after the cutoff ---- */

test("each trace alone, saved at the cutoff or after it, is a named FAIL that says which trace", async () => {
  const cases = [
    { name: "marker", old: { clients: [marker(LONG_AGO)] }, make: (at) => ({ clients: [marker(at)] }), said: /1 client file carrying an e-book send marker/ },
    { name: "link", old: { links: [link(LONG_AGO)] }, make: (at) => ({ links: [link(at)] }), said: /1 pay link described as an e-book/ },
    { name: "message", old: { messages: [email(LONG_AGO)] }, make: (at) => ({ messages: [email(at)] }), said: /1 email sent as an e-book send/ },
  ];
  for (const { name, old, make, said } of cases) {
    for (const at of [AT_CUTOFF, AFTER]) {
      const row = await judged(make(at));
      assert.equal(row.status, "FAIL", `${name} at ${at}`);
      assert.equal(row.id, ROW.id);
      assert.match(row.detail, said, name);
      assert.match(row.detail, /closer deck sent an offer that was retired/);
      assert.match(row.suggestedFix, /closer_deck_ebook_sent_at/);
      assert.match(row.suggestedFix, /staff:ebook-send:/);
      assert.match(row.suggestedFix, /Chris fixes reds/);
      assert.equal(row.na, undefined);
    }
    // The same trace saved before the cutoff is history, so it alone does not turn red.
    assert.equal((await judged(old)).status, "na", `${name} before the cutoff`);
  }
});

test("a send that stopped before the marker was written still goes red: the pay link and the email are enough", async () => {
  // The old action wrote the marker LAST. Email out, marker write failed: the file has no marker at all.
  const half = await judged({ clients: [plainClient()], links: [link(AFTER)], messages: [email(AFTER)] });
  assert.equal(half.status, "FAIL");
  assert.match(half.detail, /1 pay link described as an e-book; 1 email sent as an e-book send/);
  assert.doesNotMatch(half.detail, /client file/);
  // A pay link made and then not sent (the email step failed) is also a priced link in a customer's hands.
  assert.equal((await judged({ links: [link(AFTER)] })).status, "FAIL");
  // A whole send leaves all three.
  const whole = await judged({ clients: [marker(AFTER)], links: [link(AFTER)], messages: [email(AFTER)] });
  assert.equal(whole.status, "FAIL");
  assert.match(whole.detail, /1 client file carrying[\s\S]*1 pay link described[\s\S]*1 email sent/);
});

test("the pay link is found by the words staff typed, at the start of a word, and not inside other words", async () => {
  for (const description of ["Fundhub e-book", "E-BOOK guide", "The Fundhub E-Book - $27", "ebook", "Credit ebook bundle", "EBOOK"]) {
    assert.equal((await judged({ links: [link(AFTER, description)] })).status, "FAIL", description);
  }
  for (const description of ["Facebook ads setup", "Notebook bundle", "Roadmap", "", null]) {
    assert.equal((await judged({ links: [link(AFTER, description)] })).status, "na", String(description));
  }
  // Only the custom purpose is the old action's link.
  for (const purpose of ["deposit", "diagnostic", "repair"]) {
    assert.equal((await judged({ links: [link(AFTER, "Fundhub e-book", { purpose })] })).status, "na", purpose);
  }
});

test("the email is found only by the e-book send key, not by any other staff send", async () => {
  assert.equal((await judged({ messages: [email(AFTER, "staff:ebook-send:anything")] })).status, "FAIL");
  for (const ref of ["staff:soft-pull-send:abc", "staff:ebook:abc", "ebook-send:abc", "wf:ebook-send:abc", null]) {
    assert.equal((await judged({ messages: [email(AFTER, ref)] })).status, "na", String(ref));
  }
});

test("the counts add up per trace", async () => {
  const row = await judged({
    clients: [marker(AFTER), marker(AT_CUTOFF), marker(LONG_AGO)],
    links: [link(AFTER), link(AFTER, "ebook"), link(LONG_AGO)],
    messages: [email(AFTER), email(AFTER, "staff:ebook-send:two"), email(AFTER, "staff:ebook-send:three"), email(JUST_BEFORE)],
  });
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /2 client files carrying an e-book send marker/);
  assert.match(row.detail, /2 pay links described as an e-book/);
  assert.match(row.detail, /3 emails sent as an e-book send/);
});

test("a send marker with no readable time cannot be shown to be old, so it is red", async () => {
  for (const unreadable of ["", "yesterday", "10/13/2026", "2026-10-13", "2026-10-01", 17]) {
    const row = await judged({ clients: [marker(unreadable)] });
    assert.equal(row.status, "FAIL", JSON.stringify(unreadable));
  }
});

test("a time with a zone is compared as that instant, and a time with no zone is read as UTC on any machine", async () => {
  // 09:36 in Arizona (-07:00) is the cutoff itself; one second earlier is history.
  assert.equal((await judged({ clients: [marker("2026-10-12T09:36:00-07:00")] })).status, "FAIL");
  assert.equal((await judged({ clients: [marker("2026-10-12T09:35:59-07:00")] })).status, "na");
  assert.equal((await judged({ clients: [marker("2026-10-12T16:36:00+00:00")] })).status, "FAIL");
  const zone = process.env.TZ;
  process.env.TZ = "Pacific/Auckland"; // thirteen hours ahead: a local-time read would put 16:35:59 after the cutoff
  try {
    assert.equal((await judged({ clients: [marker("2026-10-12T16:35:59")] })).status, "na");
    assert.equal((await judged({ clients: [marker("2026-10-12T16:36:00")] })).status, "FAIL");
  } finally {
    if (zone === undefined) delete process.env.TZ; else process.env.TZ = zone;
  }
});

test("another company's late send is not this company's, on every trace, and every company is read when none is named", async () => {
  const rows = {
    clients: [marker(AFTER, OTHER_ORG), marker(LONG_AGO)],
    links: [link(AFTER, "Fundhub e-book", { org_id: OTHER_ORG })],
    messages: [email(AFTER, LINK_REF, OTHER_ORG)],
  };
  const mine = await judged(rows, { orgId: LANE_ORG });
  assert.equal(mine.status, "na");
  assert.match(mine.detail, /Saved before it went off: 1 client file/);
  const theirs = await judged(rows, { orgId: OTHER_ORG });
  assert.equal(theirs.status, "FAIL");
  assert.match(theirs.detail, /1 client file carrying[\s\S]*1 pay link described[\s\S]*1 email sent/);
  for (const [key, only] of [["marker", { clients: rows.clients }], ["link", { links: rows.links }], ["message", { messages: rows.messages }]]) {
    assert.equal((await judged(only, { orgId: LANE_ORG })).status, "na", `${key} of another company`);
    assert.equal((await judged(only, { orgId: null })).status, "FAIL", `${key}, no company named`);
  }
});

/* ---- what is sent to the database ---- */

test("the read is one SELECT per trace with only the company as a parameter, and writes nothing", async () => {
  const db = scratch({ clients: [marker(AFTER)], links: [link(AFTER)], messages: [email(AFTER)] });
  await judgeRetiredRoute(ROW, ENTRY, { db, orgId: LANE_ORG });
  assert.equal(db.calls.length, EBOOK_TRACES.length);
  for (const [index, trace] of EBOOK_TRACES.entries()) {
    assert.equal(db.calls[index].sql, ebookTraceSql(trace, true));
    assert.match(db.calls[index].sql.trim(), /^SELECT /);
    assert.doesNotMatch(db.calls[index].sql, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|BEGIN|COMMIT|SET)\b/i);
    assert.deepEqual(db.calls[index].params, [LANE_ORG]);
    assert.match(db.calls[index].sql, /\$1/);
  }
  const all = scratch({ clients: [marker(AFTER)] });
  await judgeRetiredRoute(ROW, ENTRY, { db: all, orgId: null });
  assert.equal(all.calls.length, EBOOK_TRACES.length);
  for (const call of all.calls) {
    assert.deepEqual(call.params, []);
    assert.doesNotMatch(call.sql, /\$1/);
  }
});

test("a failed read is skip with the reason, and no database is skip; neither is green", async () => {
  const broken = await judgeRetiredRoute(ROW, ENTRY, { db: { query: async () => { throw new Error("connection refused"); } }, orgId: LANE_ORG });
  assert.equal(broken.status, "skip");
  assert.match(broken.detail, /connection refused/);
  // A trace that cannot be read must not be passed over: one missing table is skip, not "nothing sent".
  for (const drop of ["clients", "payment_links", "messages"]) {
    const row = await judged({ clients: [marker(AFTER)], drop: [drop] });
    assert.equal(row.status, "skip", drop);
    assert.match(row.detail, new RegExp(drop));
  }
  const none = await judgeRetiredRoute(ROW, ENTRY, {});
  assert.equal(none.status, "skip");
  assert.match(none.detail, /no database in this run/);
});

test("a trace with more rows than the cap is not judged from a part of it", async () => {
  const many = (count) => Array.from({ length: count }, () => link(LONG_AGO));
  const atCap = await judged({ links: many(TRACE_ROW_CAP) });
  assert.equal(atCap.status, "na");
  assert.match(atCap.detail, new RegExp(`${TRACE_ROW_CAP} pay links`));
  const past = await judged({ links: many(TRACE_ROW_CAP + 1) });
  assert.equal(past.status, "skip");
  assert.match(past.detail, /more than \d+ pay links/);
});

test("the staff scope is used when the run has one, and the check never says PASS", async () => {
  const db = scratch({ clients: [marker(AFTER)] });
  let scoped = 0;
  const scope = async (fn) => { scoped += 1; return fn(db); };
  const row = await judgeRetiredRoute(ROW, ENTRY, { scope, orgId: LANE_ORG });
  assert.equal(scoped, 1);
  assert.equal(row.status, "FAIL");
  for (const rows of [{}, { clients: [marker(LONG_AGO)] }, { clients: [marker(AFTER)] }, { messages: [email(AFTER)] }]) {
    const out = await judged(rows);
    assert.ok(["na", "FAIL"].includes(out.status), out.status);
  }
});

/* ---- the "nothing to judge" claim is checked again ---- */

test("verify holds only while no send was saved after the cutoff, on any trace", async () => {
  assert.equal(await verified({ clients: [marker(LONG_AGO)], links: [link(LONG_AGO)], messages: [email(LONG_AGO)] }), true);
  assert.equal(await verified({ clients: [marker(AFTER)] }), false);
  assert.equal(await verified({ links: [link(AFTER)] }), false);
  assert.equal(await verified({ messages: [email(AFTER)] }), false);
  assert.equal(await verified({ clients: [marker("yesterday")] }), false);
  assert.equal(await verifyRetiredRoute(CODE_ARGS, {}), false, "no database: cannot tell, so not true");
  assert.equal(await verifyRetiredRoute(CODE_ARGS, { db: { query: async () => { throw new Error("down"); } } }), false);
  assert.equal(await verifyRetiredRoute(CODE_ARGS, { db: scratch({ drop: ["messages"] }) }), false, "a trace that cannot be read is not nothing");
});

test("the proof cannot name another action, control, map or route", async () => {
  assert.equal(await verified({}), true);
  assert.equal(retiredRouteEntryForArgs(CODE_ARGS), ENTRY);
  for (const change of [{ action: "send_pay_link" }, { control: "POST action=send_pay_link" }, { sourceFile: "routes-2.json" }, { surface: "route:payment-links" }]) {
    assert.equal(retiredRouteEntryForArgs({ ...CODE_ARGS, ...change }), null, JSON.stringify(change));
    assert.equal(await verifyRetiredRoute({ ...CODE_ARGS, ...change }, { db: scratch(), orgId: LANE_ORG }), false, JSON.stringify(change));
  }
});
