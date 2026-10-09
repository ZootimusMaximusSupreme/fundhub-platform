import { test, describe } from "node:test";
import assert from "node:assert";
import { MIN_N_RATE } from "./discoveries.mjs";
import {
  diesBefore25Percent,
  dyingAlertCopy,
  notifyDyingBefore25,
  DIES_BEFORE_25_THRESHOLD,
  tapCount
} from "./watch-curve.mjs";

describe("diesBefore25Percent", () => {
  test("most plays never reach 25% → dying", () => {
    const out = diesBefore25Percent({ plays: 100, p25: 30 });
    assert.equal(out.dying, true);
    assert.ok(out.rate < DIES_BEFORE_25_THRESHOLD);
  });

  test("half or more reach 25% → not dying", () => {
    const out = diesBefore25Percent({ plays: 100, p25: 50 });
    assert.equal(out.dying, false);
  });

  test("too few plays → not a call", () => {
    const out = diesBefore25Percent({ plays: MIN_N_RATE - 1, p25: 1 });
    assert.equal(out.dying, false);
    assert.match(out.note, /Need/);
  });

  test("early leave plus a tap through is a hop, not a broken opening", () => {
    const out = diesBefore25Percent({ plays: 200, p25: 40, clicks: 80 });
    assert.equal(out.dying, false);
    assert.equal(out.hopped, true);
    assert.match(out.note, /hop/i);
  });

  test("early leave with almost no taps is still a broken opening", () => {
    const out = diesBefore25Percent({ plays: 200, p25: 40, clicks: 10 });
    assert.equal(out.dying, true);
    assert.equal(out.hopped, false);
  });

  test("unknown Meta numbers → not dying", () => {
    assert.equal(diesBefore25Percent({}).dying, false);
    assert.equal(diesBefore25Percent({ plays: null, p25: 10 }).dying, false);
  });
});

describe("dyingAlertCopy", () => {
  test("names the ad and says change the opening", () => {
    const copy = dyingAlertCopy("SLO Ad 3 — Straight Offer");
    assert.match(copy.title, /SLO Ad 3/);
    assert.match(copy.title, /quarter mark/i);
    assert.match(copy.body, /opening/i);
  });
});

describe("notifyDyingBefore25", () => {
  test("buzzes once for a dying ACTIVE ad and records the day", async () => {
    const calls = [];
    const db = {
      query: async (sql, params) => {
        calls.push({ sql, params });
        if (/FROM ads a/i.test(sql)) {
          return {
            rows: [{
              ad_id: "ad-1",
              org_id: "org-1",
              partner_id: "p-1",
              ad_name: "SLO Ad 7 — Haynes",
              metric_date: "2026-09-27",
              video_plays: 200,
              video_p25_watched: 40
            }]
          };
        }
        return { rows: [] };
      }
    };
    let sent = null;
    const send = async (msg) => {
      sent = msg;
      return { ok: true, status: "sent" };
    };
    const out = await notifyDyingBefore25(db, { partnerId: "p-1", send });
    assert.equal(out.alerted, 1);
    assert.match(sent.notification.title, /Haynes|SLO Ad 7/);
    assert.ok(calls.some((c) => /ad_watch_curve_alerts/i.test(c.sql)),
      "the alert day was not recorded");
  });

  test("does not buzz when enough people reach 25%", async () => {
    const db = {
      query: async () => ({
        rows: [{
          ad_id: "ad-1",
          org_id: "org-1",
          partner_id: "p-1",
          ad_name: "Healthy ad",
          video_plays: 200,
          video_p25_watched: 120
        }]
      })
    };
    let sent = false;
    const out = await notifyDyingBefore25(db, {
      partnerId: "p-1",
      send: async () => { sent = true; return { ok: true, status: "sent" }; }
    });
    assert.equal(sent, false);
    assert.equal(out.alerted, 0);
  });
});

/* ── THE BUZZ THAT NEVER FIRED (2026-10-05) ─────────────────────────────────
   Until this date the default send was `notify.send`, and notify-fanout's
   default export IS the send function, so it was undefined. The first dying
   ACTIVE ad threw "send is not a function"; sync.mjs swallowed it and
   ad_watch_curve_alerts stayed at 0 rows.

   These tests do NOT inject `send`. They run the real notify-fanout and the
   real ntfy + Twilio providers. Nothing can leave the machine: the hosts are
   .invalid (a name that never resolves), globalThis.fetch is replaced for the
   test, and the first test leaves the dry-run fence up (MESSAGING_DRY_RUN
   unset = blocked). */

// A recorded Meta day: oVid: SLO2 on 2026-10-04 — 295 plays, 35 reached 25%,
// 26 clicks (ad_metrics_daily, read 2026-10-05). 12% at the quarter mark, and
// fewer clicks than people who got that far, so it is not a hop.
const SLO2_DAY = {
  ad_id: "ad-slo2",
  org_id: "org-1",
  partner_id: "p-1",
  ad_name: "oVid: SLO2",
  metric_date: "2026-10-04",
  video_plays: 295,
  video_p25_watched: 35,
  clicks: 26
};

const FAKE_ENV = Object.freeze({
  NTFY_TOPIC: "fundhub-test-topic",
  NTFY_SERVER: "https://ntfy.invalid",
  AD_VIDEO_SMS_TO: "+15555550100",
  TWILIO_SEND_ACCOUNT_SID: "ACtest",
  TWILIO_SEND_AUTH_TOKEN: "test-token",
  TWILIO_SEND_FROM: "+15555550199",
  TWILIO_SEND_BASE_URL: "https://twilio.invalid"
});

function fakeDb(row) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (/FROM ads a/i.test(sql)) return { rows: [row] };
      return { rows: [] };
    }
  };
}

async function withFetch(fake, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = fake;
  try { return await fn(); } finally { globalThis.fetch = real; }
}

describe("notifyDyingBefore25 — the real buzz path, no send injected", () => {
  test("it reaches notify-fanout; the dry-run fence holds it; nothing leaves; no alert day is written", async () => {
    const db = fakeDb(SLO2_DAY);
    const seen = [];
    const out = await withFetch(async (url) => { seen.push(String(url)); throw new Error("must not be called"); },
      () => notifyDyingBefore25(db, { partnerId: "p-1", env: { ...FAKE_ENV }, now: new Date("2026-10-09T19:00:00Z") }));

    assert.deepEqual(seen, [], "the fence was up — nothing may reach the network");
    assert.equal(out.checked, 1);
    assert.equal(out.alerted, 0);
    assert.equal(out.failed, 1, "a held buzz is counted, not mistaken for 'nothing dying'");
    assert.ok(!db.calls.some((c) => /INSERT INTO ad_watch_curve_alerts/i.test(c.sql)),
      "a buzz that did not land must not mark the day as alerted — tomorrow has to try again");
  });

  test("with the fence off and a fake transport, the text and the push go, naming the ad, and the day is recorded", async () => {
    const db = fakeDb(SLO2_DAY);
    const seen = [];
    const out = await withFetch(async (url, init) => {
      seen.push({ url: String(url), body: String(init && init.body) });
      const body = /twilio\.invalid/.test(String(url)) ? { sid: "SMtest123" } : { id: "ntfy-test-1" };
      return { ok: true, status: 200, headers: { get: () => "application/json" }, text: async () => JSON.stringify(body) };
    }, () => notifyDyingBefore25(db, { partnerId: "p-1", env: { ...FAKE_ENV, MESSAGING_DRY_RUN: "0" }, now: new Date("2026-10-09T19:00:00Z") /* noon Arizona: inside texting hours */ }));

    assert.equal(out.alerted, 1);
    assert.equal(out.failed, 0);
    assert.ok(seen.every((s) => /\.invalid\//.test(s.url)), "only the fake .invalid hosts were called");
    const sms = seen.find((s) => /twilio\.invalid/.test(s.url));
    const push = seen.find((s) => /ntfy\.invalid/.test(s.url));
    assert.ok(sms, "the text was attempted");
    assert.ok(push, "the ntfy push was attempted");
    const smsText = new URLSearchParams(sms.body).get("Body");
    assert.match(smsText, /SLO2/, "the text names the ad");
    assert.match(smsText, /quarter mark/i);
    assert.match(smsText, /change the opening/i, "the text itself says the opening has to change");
    assert.match(JSON.parse(push.body).message, /opening/i, "the push says to change the opening");
    assert.ok(db.calls.some((c) => /INSERT INTO ad_watch_curve_alerts/i.test(c.sql)),
      "the alert day was not recorded, so it would buzz again on the next sync");
  });
});

describe("notifyDyingBefore25 — buzz only when they are NOT tapping through", () => {
  test("the dying-ad query brings back clicks, so a hop can be told apart from a broken opening", async () => {
    const db = fakeDb(SLO2_DAY);
    await notifyDyingBefore25(db, { partnerId: "p-1", send: async () => ({ ok: true, status: "sent" }) });
    const select = db.calls.find((c) => /FROM ads a/i.test(c.sql));
    assert.match(select.sql, /\bm\.clicks\b/,
      "without clicks in the SELECT, every early leave is called a broken opening — even a hop");
  });

  test("an early leave where clicks reach the quarter-mark count is a hop — no buzz", async () => {
    const db = fakeDb({ ...SLO2_DAY, clicks: 35 });
    let sent = false;
    const out = await notifyDyingBefore25(db, {
      partnerId: "p-1",
      send: async () => { sent = true; return { ok: true, status: "sent" }; }
    });
    assert.equal(sent, false);
    assert.equal(out.alerted, 0);
    assert.equal(out.skipped, 1);
  });

  test("it never pauses, starts or re-budgets anything — the only write is the alert day", async () => {
    const db = fakeDb(SLO2_DAY);
    await notifyDyingBefore25(db, { partnerId: "p-1", send: async () => ({ ok: true, status: "sent" }) });
    const writes = db.calls.filter((c) => /\b(INSERT|UPDATE|DELETE)\b/i.test(c.sql));
    assert.equal(writes.length, 1);
    assert.match(writes[0].sql, /INSERT INTO ad_watch_curve_alerts/i);
  });
});

/* ── TAPS = LINK CLICKS / PAGE VIEWS ONCE 408 SAVES THEM (2026-10-05) ─────────
   M4's tie-out card: the buzz judged a hop on `clicks`, Meta's every-click count
   (likes, "see more", profile taps). M1's 408 adds link_clicks and
   landing_page_views. The hop now uses those when the row has them.

   Recorded day: oVid: SLO4 on 2026-09-26 — 339 plays, 22 reached 25%, 32 clicks
   (ad_metrics_daily), and 17 landing page views (Meta, marketing/ads/
   curve-optimization.md "Measured example"). On every click it looked like a hop
   (32 >= 22). On taps to the page it is a broken opening (17 < 22). */
const SLO4_DAY = {
  ad_id: "ad-slo4",
  org_id: "org-1",
  partner_id: "p-1",
  ad_name: "oVid: SLO4",
  metric_date: "2026-09-26",
  video_plays: 339,
  video_p25_watched: 22,
  clicks: 32
};

describe("tapCount — which taps the hop test reads", () => {
  test("before 408 (no column on the row): every click, the old number", () => {
    assert.deepEqual(tapCount({ clicks: 32 }), { taps: 32, source: "clicks" });
  });
  test("after 408: the larger of link clicks and landing page views", () => {
    assert.deepEqual(tapCount({ clicks: 32, link_clicks: 12, landing_page_views: 17, link_clicks_saved: true }),
      { taps: 17, source: "link_clicks" });
  });
  test("after 408, Meta sent no line: no taps reported — not turned into every click", () => {
    assert.deepEqual(tapCount({ clicks: 32, link_clicks: null, landing_page_views: null, link_clicks_saved: true }),
      { taps: null, source: "link_clicks" });
  });
});

describe("notifyDyingBefore25 — a hop is judged on taps to the page", () => {
  test("the query reads link clicks and page views when 408 is there, and still runs when it is not", async () => {
    const db = fakeDb(SLO4_DAY);
    await notifyDyingBefore25(db, { partnerId: "p-1", send: async () => ({ ok: true, status: "sent" }) });
    const sql = db.calls.find((c) => /FROM ads a/i.test(c.sql)).sql;
    assert.match(sql, /to_jsonb\(x\) ->> 'link_clicks'/);
    assert.match(sql, /to_jsonb\(x\) ->> 'landing_page_views'/);
    assert.match(sql, /to_jsonb\(x\) \? 'link_clicks'/);
    assert.doesNotMatch(sql, /\bx\.link_clicks\b/, "naming the column directly fails before 408 ships");
  });

  test("SLO4's day: 32 clicks but 17 page views for 22 at the quarter mark → buzz, not a hop", async () => {
    const db = fakeDb({ ...SLO4_DAY, link_clicks: null, landing_page_views: 17, link_clicks_saved: true });
    let sent = null;
    const out = await notifyDyingBefore25(db, {
      partnerId: "p-1",
      send: async (msg) => { sent = msg; return { ok: true, status: "sent" }; }
    });
    assert.equal(out.alerted, 1, "every-click count made this a hop; taps to the page say the opening broke");
    assert.match(sent.notification.title, /SLO4/);
  });

  test("taps to the page at least as many as the quarter mark → a hop, no buzz", async () => {
    const db = fakeDb({ ...SLO4_DAY, link_clicks: 25, landing_page_views: 20, link_clicks_saved: true });
    let sent = false;
    const out = await notifyDyingBefore25(db, {
      partnerId: "p-1",
      send: async () => { sent = true; return { ok: true, status: "sent" }; }
    });
    assert.equal(sent, false);
    assert.equal(out.skipped, 1);
  });

  test("before 408 ships the old rule stands: 32 clicks for 22 is a hop", async () => {
    const db = fakeDb({ ...SLO4_DAY, link_clicks: null, landing_page_views: null, link_clicks_saved: false });
    let sent = false;
    await notifyDyingBefore25(db, {
      partnerId: "p-1",
      send: async () => { sent = true; return { ok: true, status: "sent" }; }
    });
    assert.equal(sent, false);
  });
});
