// Buzzes to Chris's phone (src/marketing/notify.mjs, table marketing_buzzes from migration
// 411) against real Postgres. Lives under src/http/ because npm test only globs src/** and
// scripts/** (CLAUDE.md §12).
//
// NO TEXT IS EVER SENT FROM HERE. send() is always a fake passed in by the test; the real
// notify-fanout is never imported. Never pointed at the live database (spec §0.7): CI builds
// a scratch database from db/migrations. Without DATABASE_URL every test skips.
//
// ISOLATION. Every row belongs to two companies this file makes (slug starts with SLUG_TAG),
// every kind is unique to this run, and the clock is injected (`now`), so the 10-minute and
// quiet-hour rules are tested at fixed Arizona times. sendDueBuzzes() looks at every due row
// in the database; anything that is not this file's gets the fake "sent" answer and is
// ignored by the assertions.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import { queueBuzz, sendDueBuzzes, MAX_SEND_ATTEMPTS } from "../marketing/notify.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const SLUG_TAG = "zz-mm-buzz-pg-test";
const kind = (name) => `zz_buzz_${RUN}_${name}`;
const QUIET = { quietStart: "21:00", quietEnd: "07:00", tz: "America/Phoenix" };
const SENT = { ok: true, status: "sent", channels: { ntfy: true, sms: true }, error: null };
const MIN = 60 * 1000;
const at = (iso, plusMin = 0) => new Date(new Date(iso).getTime() + plusMin * MIN);

/** A fake send(). answer(message) decides what it says; every call is kept. */
function fakeSend(answer = () => SENT) {
  const calls = [];
  const fn = async (message) => {
    calls.push(message);
    return answer(message);
  };
  fn.calls = calls;
  fn.count = (id) => calls.filter((m) => m.id === id).length;
  return fn;
}
/** Answers `mine` for the given buzz ids and a clean "sent" for any other row in the database. */
const answerFor = (idsOrId, mine) => (m) => ([].concat(idsOrId).includes(m.id) ? (typeof mine === "function" ? mine(m) : mine) : SENT);

describe("marketing buzzes", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let orgA, orgB;

  async function purge() {
    await db.query(`DELETE FROM marketing_buzzes WHERE org_id IN (SELECT id FROM orgs WHERE slug LIKE '${SLUG_TAG}%')`);
    await db.query(`DELETE FROM orgs WHERE slug LIKE '${SLUG_TAG}%'`);
  }
  const buzz = async (id) => (await db.query(`SELECT * FROM marketing_buzzes WHERE id = $1`, [id])).rows[0];
  const pass = (send, now) => sendDueBuzzes(db, { send, now, ...QUIET, limit: 100 });

  before(async () => {
    await purge();
    orgA = (await db.query(`INSERT INTO orgs (slug, name) VALUES ($1, 'MM buzz test A') RETURNING id`, [`${SLUG_TAG}-a-${RUN}`])).rows[0].id;
    orgB = (await db.query(`INSERT INTO orgs (slug, name) VALUES ($1, 'MM buzz test B') RETURNING id`, [`${SLUG_TAG}-b-${RUN}`])).rows[0].id;
  });

  after(async () => {
    await purge();
    await close();
  });

  test("quiet hours hold a buzz until 07:00 Arizona", async () => {
    // 2026-10-04 23:30 Arizona = 2026-10-05 06:30 UTC
    const { buzz: b, created } = await queueBuzz(db, {
      orgId: orgA, kind: kind("quiet"), body: "18 of 21 scripts ready, 3 failed", groupKey: "batch-q",
      ...QUIET, now: new Date("2026-10-05T06:30:00Z")
    });
    assert.equal(created, true);
    assert.equal(new Date(b.send_after).toISOString(), "2026-10-05T14:00:00.000Z"); // 07:00 Arizona

    const early = fakeSend();
    await pass(early, new Date("2026-10-05T13:59:59Z")); // 06:59:59 Arizona
    assert.equal(early.count(b.id), 0, "texted before 07:00 Arizona");
    assert.equal((await buzz(b.id)).sent_at, null);
    assert.equal((await buzz(b.id)).attempts, 0);

    const seven = fakeSend();
    await pass(seven, new Date("2026-10-05T14:00:00Z"));
    assert.equal(seven.count(b.id), 1);
    const msg = seven.calls.find((m) => m.id === b.id);
    assert.equal(msg.notification.title, "18 of 21 scripts ready, 3 failed");
    const r = await buzz(b.id);
    assert.equal(new Date(r.sent_at).toISOString(), "2026-10-05T14:00:00.000Z");
    assert.equal(r.attempts, 1);
    assert.equal(r.failed_at, null);
  });

  test("one waiting buzz per (company, kind, group): the words refresh, no second text queues", async () => {
    const k = kind("group");
    const noon = new Date("2026-10-05T19:00:00Z");
    const first = await queueBuzz(db, { orgId: orgA, kind: k, body: "3 scripts ready", groupKey: "batch-1", ...QUIET, now: noon });
    const again = await queueBuzz(db, { orgId: orgA, kind: k, body: "5 scripts ready", groupKey: "batch-1", ...QUIET, now: noon });
    assert.equal(first.created, true);
    assert.equal(again.created, false);
    assert.equal(again.buzz.id, first.buzz.id);
    assert.equal((await buzz(first.buzz.id)).body, "5 scripts ready");
    const waiting = (await db.query(
      `SELECT count(*)::int AS n FROM marketing_buzzes WHERE org_id = $1 AND kind = $2 AND group_key = 'batch-1' AND sent_at IS NULL`,
      [orgA, k])).rows[0].n;
    assert.equal(waiting, 1);

    const other = await queueBuzz(db, { orgId: orgA, kind: k, body: "2 scripts ready", groupKey: "batch-2", ...QUIET, now: noon });
    assert.equal(other.created, true);
    const otherCompany = await queueBuzz(db, { orgId: orgB, kind: k, body: "3 scripts ready", groupKey: "batch-1", ...QUIET, now: noon });
    assert.equal(otherCompany.created, true);

    const blank1 = await queueBuzz(db, { orgId: orgA, kind: k, body: "something is stuck", ...QUIET, now: noon });
    const blank2 = await queueBuzz(db, { orgId: orgA, kind: k, body: "something is still stuck", ...QUIET, now: noon });
    assert.equal(blank1.buzz.group_key, "");
    assert.equal(blank2.created, false, "no group key means the kind alone groups them");

    // Once the waiting one is sent, the same group can queue a new one.
    await db.query(`UPDATE marketing_buzzes SET sent_at = now(), attempts = 1 WHERE id = $1`, [first.buzz.id]);
    const next = await queueBuzz(db, { orgId: orgA, kind: k, body: "4 more ready", groupKey: "batch-1", ...QUIET, now: noon });
    assert.equal(next.created, true);
    assert.notEqual(next.buzz.id, first.buzz.id);
  });

  test("at most one of each kind per 10 minutes; another kind is not held back", async () => {
    const k = kind("gap"), kOther = kind("gap_other");
    const T0 = "2026-10-06T19:00:00Z"; // noon Arizona
    const ours = [];
    for (const g of ["g1", "g2", "g3"]) {
      ours.push((await queueBuzz(db, { orgId: orgA, kind: k, body: `videos ready ${g}`, groupKey: g, ...QUIET, now: at(T0) })).buzz.id);
    }
    const otherKind = (await queueBuzz(db, { orgId: orgA, kind: kOther, body: "stuck: Meta refused", ...QUIET, now: at(T0) })).buzz.id;

    const sentOf = async () => (await db.query(
      `SELECT id, sent_at FROM marketing_buzzes WHERE id = ANY($1) AND sent_at IS NOT NULL ORDER BY sent_at`, [ours])).rows;

    let send = fakeSend();
    await pass(send, at(T0));
    assert.equal(ours.reduce((n, id) => n + send.count(id), 0), 1, "more than one of a kind in one pass");
    assert.equal(send.count(otherKind), 1, "a different kind waited for no reason");

    send = fakeSend();
    await pass(send, at(T0, 5));
    assert.equal(ours.reduce((n, id) => n + send.count(id), 0), 0, "a second of the kind inside 10 minutes");

    send = fakeSend();
    await pass(send, at(T0, 10));
    assert.equal(ours.reduce((n, id) => n + send.count(id), 0), 1);

    send = fakeSend();
    await pass(send, at(T0, 10 + 1 / 60));
    assert.equal(ours.reduce((n, id) => n + send.count(id), 0), 0);

    send = fakeSend();
    await pass(send, at(T0, 20));
    assert.equal(ours.reduce((n, id) => n + send.count(id), 0), 1);

    const sent = await sentOf();
    assert.equal(sent.length, 3);
    for (let i = 1; i < sent.length; i++) {
      const gap = (new Date(sent[i].sent_at).getTime() - new Date(sent[i - 1].sent_at).getTime()) / MIN;
      assert.ok(gap >= 10, `two of the kind ${gap} minutes apart`);
    }
  });

  test("sent_at is set only on ok:true with status 'sent'; anything else counts an attempt and is retried later", async () => {
    const T1 = "2026-10-07T18:00:00Z"; // 11:00 Arizona
    const { buzz: b } = await queueBuzz(db, { orgId: orgA, kind: kind("retry"), body: "3 videos ready to approve", ...QUIET, now: at(T1) });

    // Both channels failed: notify-fanout resolves {ok:false}, it does not throw.
    let send = fakeSend(answerFor(b.id, { ok: false, status: "failed", channels: { ntfy: false, sms: false }, error: "text not sent: Twilio 21610" }));
    let sum = await pass(send, at(T1));
    assert.equal(send.count(b.id), 1);
    assert.ok(sum.retrying >= 1);
    let r = await buzz(b.id);
    assert.equal(r.sent_at, null, "marked sent although the text failed");
    assert.equal(r.attempts, 1);
    assert.equal(r.last_error, "text not sent: Twilio 21610");
    assert.equal(r.failed_at, null);
    assert.equal(new Date(r.send_after).toISOString(), at(T1, 5).toISOString());

    send = fakeSend();
    await pass(send, at(T1, 1));
    assert.equal(send.count(b.id), 0, "retried before its next try time");

    // ok:true but not 'sent' (for example a dry run) is not sent either.
    send = fakeSend(answerFor(b.id, { ok: true, status: "dry_run" }));
    await pass(send, at(T1, 5));
    r = await buzz(b.id);
    assert.equal(send.count(b.id), 1);
    assert.equal(r.sent_at, null);
    assert.equal(r.attempts, 2);
    assert.match(r.last_error, /did not say sent/);

    // A send() that throws is a failed attempt too, with its reason.
    send = fakeSend(answerFor(b.id, () => { throw new Error("socket hang up"); }));
    await pass(send, at(T1, 10));
    r = await buzz(b.id);
    assert.equal(r.sent_at, null);
    assert.equal(r.attempts, 3);
    assert.equal(r.last_error, "send threw: socket hang up");

    // A later pass lands it.
    send = fakeSend();
    sum = await pass(send, at(T1, 15));
    r = await buzz(b.id);
    assert.equal(send.count(b.id), 1);
    assert.ok(sum.sent >= 1);
    assert.equal(new Date(r.sent_at).toISOString(), at(T1, 15).toISOString());
    assert.equal(r.attempts, 4);
    assert.equal(r.failed_at, null);
  });

  test(`after ${MAX_SEND_ATTEMPTS} failed attempts failed_at is set and it stops`, async () => {
    const T2 = "2026-10-08T18:00:00Z";
    const { buzz: b } = await queueBuzz(db, { orgId: orgA, kind: kind("giveup"), body: "something is stuck", ...QUIET, now: at(T2) });
    const down = answerFor(b.id, { ok: false, status: "failed", error: "both channels down" });

    let gaveUp = 0;
    for (let i = 0; i < MAX_SEND_ATTEMPTS; i++) {
      const send = fakeSend(down);
      const sum = await pass(send, at(T2, 5 * i));
      assert.equal(send.count(b.id), 1, `attempt ${i + 1} did not run`);
      gaveUp += sum.gave_up;
    }
    const r = await buzz(b.id);
    assert.equal(r.attempts, MAX_SEND_ATTEMPTS);
    assert.equal(new Date(r.failed_at).toISOString(), at(T2, 5 * (MAX_SEND_ATTEMPTS - 1)).toISOString());
    assert.equal(r.last_error, "both channels down");
    assert.equal(r.sent_at, null);
    assert.ok(gaveUp >= 1);

    for (const later of [30, 60, 24 * 60]) {
      const send = fakeSend();
      await pass(send, at(T2, later));
      assert.equal(send.count(b.id), 0, `a given-up buzz was tried again ${later} minutes later`);
    }
    assert.equal((await buzz(b.id)).attempts, MAX_SEND_ATTEMPTS);

    // A new buzz of the same kind and group may queue once the old one is given up.
    const fresh = await queueBuzz(db, { orgId: orgA, kind: kind("giveup"), body: "something is stuck", ...QUIET, now: at(T2, 60) });
    assert.equal(fresh.created, true);
  });

  test("a retry never goes out in quiet hours", async () => {
    // 2026-10-08 20:58 Arizona = 2026-10-09 03:58 UTC: not quiet yet, so it is due.
    const T3 = "2026-10-09T03:58:00Z";
    const { buzz: b } = await queueBuzz(db, { orgId: orgA, kind: kind("night"), body: "videos ready", ...QUIET, now: at(T3) });
    assert.equal(new Date(b.send_after).toISOString(), at(T3).toISOString());

    const fail = fakeSend(answerFor(b.id, { ok: false, status: "failed", error: "text not sent" }));
    await pass(fail, at(T3));
    // 5 minutes later is 21:03 Arizona, inside quiet hours: the retry waits for 07:00.
    assert.equal(new Date((await buzz(b.id)).send_after).toISOString(), "2026-10-09T14:00:00.000Z");

    let send = fakeSend();
    await pass(send, new Date("2026-10-09T13:59:00Z"));
    assert.equal(send.count(b.id), 0, "retried at night");
    send = fakeSend();
    await pass(send, new Date("2026-10-09T14:00:00Z"));
    assert.equal(send.count(b.id), 1);
    assert.ok((await buzz(b.id)).sent_at);
  });

  test("two passes at once never text the same buzz twice", async () => {
    const T4 = "2026-10-10T18:00:00Z";
    const { buzz: b } = await queueBuzz(db, { orgId: orgA, kind: kind("race"), body: "scripts ready", ...QUIET, now: at(T4) });
    const slow = fakeSend(answerFor(b.id, async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return SENT;
    }));
    await Promise.all([pass(slow, at(T4)), pass(slow, at(T4))]);
    assert.equal(slow.count(b.id), 1, "the same buzz was texted twice");
    const r = await buzz(b.id);
    assert.equal(r.attempts, 1);
    assert.ok(r.sent_at);
  });

  test("send is injected: without one nothing is sent and nothing changes", async () => {
    const T5 = "2026-10-11T18:00:00Z";
    const { buzz: b } = await queueBuzz(db, { orgId: orgA, kind: kind("nosend"), body: "scripts ready", ...QUIET, now: at(T5) });
    await assert.rejects(sendDueBuzzes(db, { now: at(T5), ...QUIET }), /pass send\(\)/);
    const r = await buzz(b.id);
    assert.equal(r.attempts, 0);
    assert.equal(r.sent_at, null);
  });

  test("the database refuses a buzz that is both sent and given up, a give-up with no reason, and empty words", async () => {
    const refuse = (sql, params) => assert.rejects(db.query(sql, params), (e) => e.code === "23514");
    await refuse(
      `INSERT INTO marketing_buzzes (org_id, kind, body, sent_at, failed_at, last_error) VALUES ($1, $2, 'x', now(), now(), 'why')`,
      [orgA, kind("ck1")]);
    await refuse(`INSERT INTO marketing_buzzes (org_id, kind, body, failed_at) VALUES ($1, $2, 'x', now())`, [orgA, kind("ck2")]);
    await refuse(`INSERT INTO marketing_buzzes (org_id, kind, body) VALUES ($1, $2, '   ')`, [orgA, kind("ck3")]);
    await refuse(`INSERT INTO marketing_buzzes (org_id, kind, body) VALUES ($1, ' ', 'x')`, [orgA]);
  });
});
