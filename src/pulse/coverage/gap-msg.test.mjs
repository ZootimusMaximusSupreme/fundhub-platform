// Messages truth lane: the wording, the status rules, the read-only guard and the "nothing to judge" claim.
// The SQL itself runs on a real Postgres in gap-msg.pg.test.mjs. This file hands the lane a fake database that
// answers each read by its exact SQL text, so every test names the break it is pretending to see.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALLOWED_LINK_HOSTS,
  BLANKS_SQL,
  BLANKS_TOTAL_SQL,
  CHECK_IDS,
  DAILY_SENDS_SQL,
  DEAD_QUEUED_SQL,
  DUPLICATE_TEXTS_SQL,
  EMAIL_EVENT_STEPS,
  HELP_SQL,
  HIRING_BLOCKED_SQL,
  LINK_BODIES_SQL,
  LINK_CAP,
  OWNER_ALERTS_SQL,
  PAUSED_SENDS_SQL,
  SETTINGS_SQL,
  STAFF_TEMPLATE_KEYS,
  STAFF_TO_CLIENT_SQL,
  TEMPLATE_PATH_SQL,
  buildEmailStepsSql,
  extractLinks,
  gapChecks,
  judgeLinks,
  naVerify,
  openableUrl
} from "./gap-msg.mjs";
import { DEAD_TEMPLATE_KEYS, DEAD_TEMPLATES } from "./msg-dead-templates.mjs";
import { GAP_FILES } from "./modules.mjs";
import { NA_CODES, verifyNa } from "../na-conditions.mjs";
import { makeLaneNaVerify } from "../self-audit.mjs";
import { TEST_ADDRESS_RE } from "./gap-sms.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "gap-msg.mjs"), "utf8");
const ORG = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-10T13:00:00.000Z");
const STEPS_SQL = buildEmailStepsSql();
const KEYS = ["id", "status", "detail", "suggestedFix"];

/** A database that answers each read by its SQL text. `answers` maps a SQL string to rows, or to a function. */
function fakeDb(answers = {}) {
  const calls = [];
  return {
    calls,
    async query(text, params) {
      calls.push({ text, params });
      if (!Object.prototype.hasOwnProperty.call(answers, text)) return { rows: [] };
      const a = answers[text];
      if (a instanceof Error) throw a;
      const rows = typeof a === "function" ? a(params) : a;
      if (rows instanceof Error) throw rows;
      return { rows };
    }
  };
}

const CLEAN = {
  [SETTINGS_SQL]: [{ outbound_enabled: true, daily_send_cap: 500, alert_email: null, updated_at: "2026-08-22T20:23:13.000Z" }],
  [BLANKS_TOTAL_SQL]: [{ n: 6 }],
  [STEPS_SQL]: [{ n: 0, names: [] }],
  [HELP_SQL]: [{ asked: 0, answered: 0, unanswered: 0, oldest: null }]
};

function byId(rows) {
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}

async function lane(answers = {}, ctx = {}) {
  const db = fakeDb({ ...CLEAN, ...answers });
  const rows = await gapChecks({ db, orgId: ORG, now: NOW, ...ctx });
  return { rows, by: byId(rows), db };
}

// ── shape ────────────────────────────────────────────────────────────────────

test("gap msg: nine rows, ids in CHECK_IDS order, four keys each, a fix on every FAIL and none otherwise", async () => {
  assert.equal(CHECK_IDS.length, 9);
  assert.equal(new Set(CHECK_IDS).size, 9);
  const { rows } = await lane({
    [BLANKS_SQL]: [{ template_key: "EMAIL-F07-FUNDING-LOCKED", channel: "email", n: 2, dollar_n: 2 }],
    [HELP_SQL]: [{ asked: 1, answered: 0, unanswered: 1, oldest: "2026-10-09T10:00:00Z" }]
  });
  assert.deepEqual(rows.map((r) => r.id), [...CHECK_IDS]);
  for (const r of rows) {
    const status = r.status;
    assert.ok(["PASS", "FAIL", "skip", "na"].includes(status), `${r.id}: ${status}`);
    assert.equal(typeof r.detail, "string");
    assert.ok(r.detail.length > 0);
    for (const k of KEYS) assert.ok(k in r, `${r.id} has ${k}`);
    if (status === "FAIL") {
      assert.equal(typeof r.suggestedFix, "string");
      assert.match(r.suggestedFix, /Do not send from this check\./);
      assert.doesNotMatch(r.suggestedFix, /\bflip\b/i);
    } else {
      assert.equal(r.suggestedFix, null);
    }
  }
});

test("gap msg: no database, or no company, is nine skips with the reason and never a PASS", async () => {
  const noDb = await gapChecks({ orgId: ORG, now: NOW });
  assert.equal(noDb.length, 9);
  assert.ok(noDb.every((r) => r.status === "skip" && /No database in this run/.test(r.detail)));
  const noOrg = await gapChecks({ db: fakeDb(), now: NOW });
  assert.ok(noOrg.every((r) => r.status === "skip" && /No company in this run/.test(r.detail)));
});

test("gap msg: the lane is on the named list and its ids are what the audit's manifest reads", async () => {
  assert.ok(GAP_FILES.some(([name]) => name === "gap-msg.mjs"));
  const mod = await GAP_FILES.find(([name]) => name === "gap-msg.mjs")[1]();
  assert.deepEqual([...mod.CHECK_IDS], [...CHECK_IDS]);
  assert.equal(typeof mod.naVerify["no-sender"], "function");
  // The ids carry the lane's own short name, so the pulse keeps them as written.
  for (const id of CHECK_IDS) assert.match(id, /^msg:/);
});

test("gap msg: every read is one SELECT, no write words, and its parameters are all supplied", async () => {
  const reads = [
    BLANKS_SQL, BLANKS_TOTAL_SQL, STAFF_TO_CLIENT_SQL, LINK_BODIES_SQL, TEMPLATE_PATH_SQL, STEPS_SQL,
    PAUSED_SENDS_SQL, DAILY_SENDS_SQL, DUPLICATE_TEXTS_SQL, DEAD_QUEUED_SQL, OWNER_ALERTS_SQL, HIRING_BLOCKED_SQL,
    HELP_SQL, SETTINGS_SQL
  ];
  for (const sql of reads) {
    assert.match(sql, /^SELECT\b/, sql.slice(0, 60));
    assert.doesNotMatch(sql, /;/);
    assert.doesNotMatch(sql, /\b(insert|update|delete|alter|drop|truncate|create|grant|begin|commit|rollback)\b/i);
  }
  // What the lane really sends through ctx.db is only ever those reads, with no transaction control and no SET.
  const { db } = await lane();
  for (const c of db.calls) {
    assert.ok(reads.includes(c.text), `unexpected statement: ${c.text.slice(0, 80)}`);
    assert.doesNotMatch(c.text, /^\s*(begin|commit|rollback|set)\b/i);
    const used = [...c.text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
    const max = Math.max(0, ...used);
    assert.equal(c.params.length, max, `${c.text.slice(0, 50)}: ${c.params.length} params for $${max}`);
  }
});

test("gap msg: the file imports no provider, sends nothing, and only ever asks for HEAD or GET", () => {
  assert.doesNotMatch(SRC, /providers\/(twilio|resend|mailgun|ntfy|web-push|bland)/);
  assert.doesNotMatch(SRC, /\bsendTemplated\s*\(|\bdispatchDue\s*\(|\bdispatchMessage\s*\(|\bdrain\s*\(/);
  assert.doesNotMatch(SRC, /\bINSERT\s+INTO\b|\bUPDATE\s+\w+\s+SET\b|\bDELETE\s+FROM\b/);
  assert.doesNotMatch(SRC, /^\s*import\b.*\b(sendTemplated|dispatch|outbox|messaging\.mjs)\b/m);
  assert.doesNotMatch(SRC, /method:\s*"(POST|PUT|PATCH|DELETE)"/);
  assert.doesNotMatch(SRC, /readFileSync|readdirSync|fs\./, "no repo file is read at run time");
});

test("gap msg: a read that throws is one skip with the reason. The other eight rows still answer", async () => {
  const { by } = await lane({ [BLANKS_SQL]: new Error("connection reset by peer") });
  assert.equal(by["msg:sent-body-blanks"].status, "skip");
  assert.match(by["msg:sent-body-blanks"].detail, /connection reset by peer/);
  assert.equal(by["msg:brakes"].status, "PASS");
  assert.equal(by["msg:help-reply"].status, "PASS");
});

// ── 1. blanks ────────────────────────────────────────────────────────────────

test("blanks: no blank spot is a PASS that says out of how many; a blank spot is a FAIL that names the template and the kind", async () => {
  const green = (await lane()).by["msg:sent-body-blanks"];
  assert.equal(green.status, "PASS");
  assert.match(green.detail, /^6 messages/);

  const red = (await lane({
    [BLANKS_SQL]: [
      { template_key: "EMAIL-F07-FUNDING-LOCKED", channel: "email", n: 2, dollar_n: 2, spaces_n: 0, braces_n: 0, words_n: 0, greeting_n: 0 },
      { template_key: "EMAIL-S05A-NOSHOW-RECOVERY", channel: "email", n: 1, dollar_n: 0, spaces_n: 1, braces_n: 0, words_n: 0, greeting_n: 0 }
    ]
  })).by["msg:sent-body-blanks"];
  assert.equal(red.status, "FAIL");
  assert.match(red.detail, /^3 messages in the last 24 hours have an empty spot/);
  assert.match(red.detail, /EMAIL-F07-FUNDING-LOCKED \(a dollar sign with no number\) x2/);
  assert.match(red.detail, /EMAIL-S05A-NOSHOW-RECOVERY \(two spaces where a value belongs\) x1/);
});

test("blanks: a count that did not come back is a skip, not a PASS", async () => {
  const noTotal = (await lane({ [BLANKS_TOTAL_SQL]: [{ n: null }] })).by["msg:sent-body-blanks"];
  assert.equal(noTotal.status, "skip");
  const noRows = (await lane({ [BLANKS_SQL]: [{ template_key: "X", channel: "sms", n: "abc" }] })).by["msg:sent-body-blanks"];
  assert.equal(noRows.status, "skip");
});

// ── 2. staff template to a client ────────────────────────────────────────────

test("staff template: named staff templates are listed, including the 72-hour alert that says Internal alert", () => {
  assert.ok(STAFF_TEMPLATE_KEYS.includes("EMAIL-DPC05-NO-PROGRESS-72H"));
  assert.ok(STAFF_TEMPLATE_KEYS.includes("SMS-S04C-STAFF-BOOKED"));
});

test("staff template: PASS when none reached a non-staff address, FAIL with the template and channel when one did", async () => {
  const green = (await lane()).by["msg:staff-template-to-client"];
  assert.equal(green.status, "PASS");
  const red = (await lane({
    [STAFF_TO_CLIENT_SQL]: [{ template_key: "EMAIL-DPC05-NO-PROGRESS-72H", channel: "email", n: 2, client_n: 2 }]
  })).by["msg:staff-template-to-client"];
  assert.equal(red.status, "FAIL");
  assert.match(red.detail, /2 messages written for staff were queued to someone who is not staff/);
  assert.match(red.detail, /EMAIL-DPC05-NO-PROGRESS-72H \(email\) x2/);
});

test("staff template: the company alert address and the staff markers go into the read as parameters", async () => {
  const { db } = await lane({
    [SETTINGS_SQL]: [{ outbound_enabled: true, daily_send_cap: 500, alert_email: "ops@fundhub.ai", updated_at: null }]
  });
  const call = db.calls.find((c) => c.text === STAFF_TO_CLIENT_SQL);
  assert.deepEqual(call.params[2], [...STAFF_TEMPLATE_KEYS]);
  assert.match(call.params[3], /internal alert/);
  assert.equal(call.params[4], TEST_ADDRESS_RE);
  assert.equal(call.params[5], "ops@fundhub.ai");
});

// ── 3. links ─────────────────────────────────────────────────────────────────

test("links: extractLinks finds a blank href, a bare https://, a relative link and a {{ }} href, and skips mailto", () => {
  const html = [
    '<a href="">Go</a>', '<a href="#">Go</a>', '<a href="{{pay_url}}">Pay</a>', '<a href="/portal-login.html">Open</a>',
    '<a href="mailto:help@fundhub.ai">Mail</a>', '<a href="https://fundhub.ai/progress.html?t=1">Progress</a>'
  ].join(" ");
  const got = extractLinks(html);
  assert.equal(got.blank, 4);
  assert.deepEqual(got.urls, ["https://fundhub.ai/progress.html?t=1"]);
  assert.equal(extractLinks("Pay here: https:// thanks").blank, 1);
  assert.deepEqual(extractLinks("Book: https://apply.fundhub.ai/funding-book-call. Reply STOP.").urls, ["https://apply.fundhub.ai/funding-book-call"]);
  assert.deepEqual(extractLinks("no links in this one"), { blank: 0, urls: [] });
});

test("links: openableUrl strips the token and query, never opens an API door, and never opens a host that is not ours", () => {
  assert.equal(openableUrl("https://fundhub.ai/contract.html?id=1&exp=2&sig=abc#x"), "https://fundhub.ai/contract.html");
  assert.equal(openableUrl("https://apply.fundhub.ai/roadmap/"), "https://apply.fundhub.ai/roadmap/");
  assert.equal(openableUrl("https://fundhub.ai/api/auth/magic-link-verify?token=abc"), null);
  assert.equal(openableUrl("https://www.fanbasis.com/pay/xyz"), null);
  assert.equal(openableUrl("https://notfundhub.ai/x"), null);
  assert.equal(openableUrl("not a url"), null);
});

function linkRow(template_key, body, channel = "email") {
  return { template_key, channel, rendered_body: body };
}

/** A fetch that records every call and answers by url. */
function fakeFetch(answer = () => 200) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method });
    const out = answer(String(url), opts.method);
    if (out instanceof Error) throw out;
    return { status: out };
  };
  fn.calls = calls;
  return fn;
}

test("links: a blank link is a FAIL naming the template, with no web call needed", async () => {
  const got = await judgeLinks([linkRow("EMAIL-F02-ID-PORTAL-NEEDED", '<a href="{{portal_login_url}}">Open</a>')], { fetchImpl: null });
  assert.equal(got.status, "FAIL");
  assert.match(got.detail, /1 link has no address \(EMAIL-F02-ID-PORTAL-NEEDED x1\)/);
});

test("links: a host that is not on the list is a FAIL and is never opened", async () => {
  const f = fakeFetch();
  const got = await judgeLinks([linkRow("EMAIL-X", "Open https://deploy-preview-12--fundhub.netlify.app/portal-login.html")], { fetchImpl: f });
  assert.equal(got.status, "FAIL");
  assert.match(got.detail, /deploy-preview-12--fundhub\.netlify\.app in EMAIL-X/);
  assert.equal(f.calls.length, 0);
});

test("links: a page that answers 404 is a FAIL with the page and the template; one that answers 200 is a PASS", async () => {
  const body = "Fill this in: https://fundhub.ai/eeo-survey.html?token=abc";
  const dead = await judgeLinks([linkRow("EMAIL-CANDIDATE-EEO-INVITE", body)], { fetchImpl: fakeFetch(() => 404) });
  assert.equal(dead.status, "FAIL");
  assert.match(dead.detail, /https:\/\/fundhub\.ai\/eeo-survey\.html answered 404 \(in EMAIL-CANDIDATE-EEO-INVITE\)/);
  assert.doesNotMatch(dead.detail, /token=abc/);
  const f = fakeFetch(() => 200);
  const live = await judgeLinks([linkRow("EMAIL-CANDIDATE-EEO-INVITE", body)], { fetchImpl: f });
  assert.equal(live.status, "PASS");
  assert.deepEqual(f.calls, [{ url: "https://fundhub.ai/eeo-survey.html", method: "HEAD" }]);
});

test("links: a 5xx is dead, a 401 or 403 is a guarded page and fine, a 405 is read once with GET", async () => {
  const mk = (code) => judgeLinks([linkRow("T", "https://fundhub.ai/a.html")], { fetchImpl: fakeFetch(() => code) });
  assert.equal((await mk(503)).status, "FAIL");
  assert.equal((await mk(401)).status, "PASS");
  assert.equal((await mk(403)).status, "PASS");
  const f = fakeFetch((_u, m) => (m === "HEAD" ? 405 : 200));
  const got = await judgeLinks([linkRow("T", "https://fundhub.ai/a.html")], { fetchImpl: f });
  assert.equal(got.status, "PASS");
  assert.deepEqual(f.calls.map((c) => c.method), ["HEAD", "GET"]);
});

test("links: a page that does not answer at all is a skip, never a PASS", async () => {
  const got = await judgeLinks([linkRow("T", "https://fundhub.ai/a.html")], { fetchImpl: fakeFetch(() => new Error("timeout")) });
  assert.equal(got.status, "skip");
  assert.match(got.detail, /did not answer at all/);
});

test("links: no web call in the run is a skip when pages are linked, and a PASS only when nothing of ours is linked", async () => {
  const linked = await judgeLinks([linkRow("T", "https://fundhub.ai/a.html")], { fetchImpl: null });
  assert.equal(linked.status, "skip");
  assert.match(linked.detail, /no web call/);
  const none = await judgeLinks([linkRow("T", "Pay: https://www.fanbasis.com/pay/x")], { fetchImpl: null });
  assert.equal(none.status, "PASS");
  const empty = await judgeLinks([], { fetchImpl: null });
  assert.equal(empty.status, "PASS");
});

test("links: the number of pages opened is capped, and the rest are said out loud", async () => {
  const body = Array.from({ length: LINK_CAP + 7 }, (_, i) => `https://fundhub.ai/p${i}.html`).join(" ");
  const f = fakeFetch(() => 200);
  const got = await judgeLinks([linkRow("T", body)], { fetchImpl: f });
  assert.equal(f.calls.length, LINK_CAP);
  assert.equal(got.status, "PASS");
  assert.match(got.detail, /7 more distinct pages were left for another day \(cap 30\)/);
  for (const c of f.calls) assert.ok(["HEAD", "GET"].includes(c.method));
});

test("links: the allowed list holds our own domain and the two third parties the app links to", () => {
  assert.deepEqual([...ALLOWED_LINK_HOSTS].sort(), ["fanbasis.com", "fundhub.ai", "meet.google.com"]);
});

test("links: through the lane, the read goes by the fetch the run gives, and a run with none still answers", async () => {
  const f = fakeFetch(() => 200);
  const { by, db } = await lane(
    { [LINK_BODIES_SQL]: [linkRow("EMAIL-S04-01-CONFIRM", "Join: https://fundhub.ai/portal-login.html")] },
    { fetch: f }
  );
  assert.equal(by["msg:links-in-body"].status, "PASS");
  assert.equal(f.calls.length, 1);
  const read = db.calls.find((c) => c.text === LINK_BODIES_SQL);
  assert.equal(read.params[2], TEST_ADDRESS_RE);
  const { by: noFetch } = await lane({ [LINK_BODIES_SQL]: [linkRow("T", "https://fundhub.ai/x.html")] });
  assert.equal(noFetch["msg:links-in-body"].status, "skip");
});

// ── 4. per-template path ─────────────────────────────────────────────────────

const pathRow = (over) => ({ template_key: "EMAIL-PORTAL-MAGIC-LINK", channel: "email", aged_n: 4, delivered_n: 0, waiting_n: 0, sent_n: 1, failed_n: 3, ...over });

test("per-template path: a template with old rows and none delivered is a FAIL that says what became of them", async () => {
  const red = (await lane({ [TEMPLATE_PATH_SQL]: [pathRow({}), pathRow({ template_key: "EMAIL-S00-WELCOME", aged_n: 9, delivered_n: 7, sent_n: 0, failed_n: 2 })] })).by["msg:per-template-path"];
  assert.equal(red.status, "FAIL");
  assert.match(red.detail, /1 template queued mail that never arrived/);
  assert.match(red.detail, /EMAIL-PORTAL-MAGIC-LINK \(email, 4 old rows, 0 delivered: 1 sent with no receipt, 3 failed or bounced\)/);
  assert.doesNotMatch(red.detail, /EMAIL-S00-WELCOME/);
});

test("per-template path: one old row is not judged, a delivered one clears the template, a silent channel is said once", async () => {
  const one = (await lane({ [TEMPLATE_PATH_SQL]: [pathRow({ aged_n: 1, sent_n: 1, failed_n: 0 })] })).by["msg:per-template-path"];
  assert.equal(one.status, "PASS");
  const alive = (await lane({ [TEMPLATE_PATH_SQL]: [pathRow({ aged_n: 5, delivered_n: 1 })] })).by["msg:per-template-path"];
  assert.equal(alive.status, "PASS");
  const silent = (await lane({
    [TEMPLATE_PATH_SQL]: [pathRow({}), pathRow({ template_key: "EMAIL-S04-01-CONFIRM", aged_n: 3, sent_n: 3, failed_n: 0 })]
  })).by["msg:per-template-path"];
  assert.equal(silent.status, "FAIL");
  assert.match(silent.detail, /Every email template read zero delivered in 7 days/);
});

test("per-template path: an event that should have made an email and did not is a FAIL naming the template", async () => {
  const red = (await lane({ [STEPS_SQL]: [{ n: 3, names: ["EMAIL-S00-WELCOME", "EMAIL-S04-01-CONFIRM"] }] })).by["msg:per-template-path"];
  assert.equal(red.status, "FAIL");
  assert.match(red.detail, /3 events should have made an email and no email was queued \(EMAIL-S00-WELCOME, EMAIL-S04-01-CONFIRM\)/);
});

test("per-template path: a failed step read leaves the path result standing and says what was not read; both failed is a skip", async () => {
  const half = (await lane({ [TEMPLATE_PATH_SQL]: [pathRow({})], [STEPS_SQL]: new Error("deadline exceeded") })).by["msg:per-template-path"];
  assert.equal(half.status, "FAIL");
  assert.match(half.detail, /Not read: the email-step read failed: deadline exceeded/);
  const okHalf = (await lane({ [STEPS_SQL]: new Error("deadline exceeded") })).by["msg:per-template-path"];
  assert.equal(okHalf.status, "skip");
  const both = (await lane({ [TEMPLATE_PATH_SQL]: new Error("boom one"), [STEPS_SQL]: new Error("boom two") })).by["msg:per-template-path"];
  assert.equal(both.status, "skip");
  assert.match(both.detail, /boom one; boom two/);
});

test("per-template path: the watched email steps are the email twins of the text steps, and each has its own guards", () => {
  assert.deepEqual(
    EMAIL_EVENT_STEPS.map((s) => `${s.eventName}>${s.templateKey}`),
    [
      "entry.captured>EMAIL-S00-WELCOME",
      "booking.created>EMAIL-S04-01-CONFIRM",
      "booking.rescheduled>EMAIL-S04-01-CONFIRM",
      "round.submitted>EMAIL-F03-ROUND-SUBMITTED",
      "round.approved>EMAIL-F04-ROUND-APPROVALS"
    ]
  );
  assert.match(STEPS_SQL, /m\.provider_ref LIKE 'workflow:' \|\| s\.template_key \|\| ':' \|\| e\.id::text \|\| '%'/);
  assert.match(STEPS_SQL, /t\.channel = 'email'/);
  assert.doesNotMatch(STEPS_SQL, /opt_outs/, "an email is queued even for a person who unsubscribed");
  assert.throws(() => buildEmailStepsSql([{ eventName: "x'; drop", templateKey: "EMAIL-A", oncePerClient: false }]), /bad email step event/);
  assert.throws(() => buildEmailStepsSql([{ eventName: "a.b", templateKey: "SMS-A" }]), /bad email step template/);
});

// ── 5. brakes ────────────────────────────────────────────────────────────────

test("brakes: switch on, under the cap, no repeats is a PASS", async () => {
  const got = (await lane({ [DAILY_SENDS_SQL]: [{ day: "2026-10-09T00:00:00Z", n: 12 }] })).by["msg:brakes"];
  assert.equal(got.status, "PASS");
  assert.match(got.detail, /the send switch is on/);
  assert.match(got.detail, /cap of 500/);
});

test("brakes: a send after the pause is a FAIL, and the pause time is the settings update time", async () => {
  const settings = [{ outbound_enabled: false, daily_send_cap: 500, alert_email: null, updated_at: "2026-10-08T18:00:00.000Z" }];
  const red = await lane({ [SETTINGS_SQL]: settings, [PAUSED_SENDS_SQL]: [{ n: 4, first_at: "2026-10-09T01:00:00Z" }] });
  assert.equal(red.by["msg:brakes"].status, "FAIL");
  assert.match(red.by["msg:brakes"].detail, /the send switch is off and 4 messages left after it was turned off \(2026-10-08\)/);
  assert.equal(red.db.calls.find((c) => c.text === PAUSED_SENDS_SQL).params[1], "2026-10-08T18:00:00.000Z");
  const quiet = await lane({ [SETTINGS_SQL]: settings, [PAUSED_SENDS_SQL]: [{ n: 0, first_at: null }] });
  assert.equal(quiet.by["msg:brakes"].status, "PASS");
  assert.match(quiet.by["msg:brakes"].detail, /nothing has left since/);
});

test("brakes: a day over the cap is a FAIL, a day at the cap is not, and a cap of 0 or none means no ceiling", async () => {
  const over = (await lane({ [DAILY_SENDS_SQL]: [{ day: "2026-10-08T00:00:00Z", n: 501 }, { day: "2026-10-09T00:00:00Z", n: 20 }] })).by["msg:brakes"];
  assert.equal(over.status, "FAIL");
  assert.match(over.detail, /501 messages left on 2026-10-08, over the daily cap of 500/);
  const at = (await lane({ [DAILY_SENDS_SQL]: [{ day: "2026-10-08T00:00:00Z", n: 500 }] })).by["msg:brakes"];
  assert.equal(at.status, "PASS");
  const zero = (await lane({
    [SETTINGS_SQL]: [{ outbound_enabled: true, daily_send_cap: 0, alert_email: null, updated_at: null }],
    [DAILY_SENDS_SQL]: [{ day: "2026-10-08T00:00:00Z", n: 9000 }]
  })).by["msg:brakes"];
  assert.equal(zero.status, "PASS");
  assert.match(zero.detail, /no daily cap is set/);
  const none = (await lane({
    [SETTINGS_SQL]: [{ outbound_enabled: true, daily_send_cap: null, alert_email: null, updated_at: null }],
    [DAILY_SENDS_SQL]: [{ day: "2026-10-08T00:00:00Z", n: 9000 }]
  })).by["msg:brakes"];
  assert.equal(none.status, "PASS");
});

test("brakes: the same text to the same phone twice is a FAIL, and says which template", async () => {
  const red = (await lane({ [DUPLICATE_TEXTS_SQL]: [{ template_key: "SMS-S00-WELCOME", n: 2, phones: 1 }] })).by["msg:brakes"];
  assert.equal(red.status, "FAIL");
  assert.match(red.detail, /2 texts were the same text to the same phone twice inside 24 hours \(SMS-S00-WELCOME x2\)/);
});

test("brakes: a read that failed is a skip, and a FAIL elsewhere still stands with what was not read", async () => {
  const noSettings = (await lane({ [SETTINGS_SQL]: new Error("permission denied") })).by["msg:brakes"];
  assert.equal(noSettings.status, "skip");
  assert.match(noSettings.detail, /permission denied/);
  const mixed = (await lane({
    [DAILY_SENDS_SQL]: new Error("canceling statement"),
    [DUPLICATE_TEXTS_SQL]: [{ template_key: "SMS-X", n: 1, phones: 1 }]
  })).by["msg:brakes"];
  assert.equal(mixed.status, "FAIL");
  assert.match(mixed.detail, /Not read: the daily sends could not be read/);
  const skipOnly = (await lane({ [DAILY_SENDS_SQL]: new Error("canceling statement") })).by["msg:brakes"];
  assert.equal(skipOnly.status, "skip");
});

test("brakes: a pause with no update time cannot be judged and is a skip", async () => {
  const got = (await lane({ [SETTINGS_SQL]: [{ outbound_enabled: false, daily_send_cap: 500, alert_email: null, updated_at: null }] })).by["msg:brakes"];
  assert.equal(got.status, "skip");
});

// ── 6. dead senders ──────────────────────────────────────────────────────────

test("dead senders: the list is the 158 keys the board named, with the three reasons, each key once", () => {
  assert.equal(DEAD_TEMPLATE_KEYS.length, 158);
  assert.equal(new Set(DEAD_TEMPLATE_KEYS).size, 158);
  assert.equal(DEAD_TEMPLATES["no-sender"].length + DEAD_TEMPLATES["doc-source"].length + DEAD_TEMPLATES.retired.length, 158);
  assert.ok(DEAD_TEMPLATE_KEYS.includes("EMAIL-N01-COLD-NURTURE"));
  // A live template is never on it. These are queued every day.
  for (const live of ["EMAIL-S00-WELCOME", "SMS-S00-WELCOME", "EMAIL-S04-01-CONFIRM", "AF1", "EMAIL-PORTAL-MAGIC-LINK"]) {
    assert.ok(!DEAD_TEMPLATE_KEYS.includes(live), live);
  }
});

test("dead senders: nothing queued is a nothing-to-judge row with a code the audit knows, and a queued one is a FAIL", async () => {
  const na = (await lane()).by["msg:dead-senders"];
  assert.equal(na.status, "na");
  assert.equal(na.na.code, "no-sender");
  assert.ok(NA_CODES.includes(na.na.code));
  assert.equal(na.na.args.count, 158);
  assert.equal(na.na.args.days, 7);
  assert.equal(na.na.args.since, "2026-10-03T13:00:00.000Z");
  assert.equal(na.suggestedFix, null);

  const red = (await lane({ [DEAD_QUEUED_SQL]: [{ template_key: "EMAIL-N01-COLD-NURTURE", channel: "email", n: 3, last_at: "2026-10-09T12:00:00Z" }] })).by["msg:dead-senders"];
  assert.equal(red.status, "FAIL");
  assert.match(red.detail, /3 messages used a template the list says nothing sends, in the last 7 days: EMAIL-N01-COLD-NURTURE x3/);
});

test("dead senders: the audit's re-read is true on an empty queue, false when one is queued, false with no window or no database", async () => {
  const empty = { db: fakeDb({ [DEAD_QUEUED_SQL]: [] }), now: NOW };
  const args = { count: 158, days: 7, since: "2026-10-03T13:00:00.000Z" };
  assert.equal(await naVerify["no-sender"](args, empty), true);
  const queued = { db: fakeDb({ [DEAD_QUEUED_SQL]: [{ template_key: "T1", channel: "sms", n: 1 }] }), now: NOW };
  assert.equal(await naVerify["no-sender"](args, queued), false);
  assert.equal(await naVerify["no-sender"](args, { now: NOW }), false);
  // A window under a day proves nothing, and the producer's own "since" is not trusted.
  assert.equal(await naVerify["no-sender"]({ days: 0.5, since: "2026-10-10T12:00:00.000Z" }, empty), false);
  assert.equal(await naVerify["no-sender"]({}, empty), false);
  // It reads through the staff scope when there is one, and asks the same SQL.
  let sawSql = null;
  const scope = async (fn) => fn({ query: async (text) => { sawSql = text; return { rows: [] }; } });
  assert.equal(await naVerify["no-sender"](args, { scope, now: NOW }), true);
  assert.equal(sawSql, DEAD_QUEUED_SQL);
});

test("dead senders: end to end through the audit's own door, the row stands while quiet and falls the day a dead key is queued", async () => {
  const quiet = fakeDb({ ...CLEAN, [DEAD_QUEUED_SQL]: [] });
  const [row] = (await gapChecks({ db: quiet, orgId: ORG, now: NOW })).filter((r) => r.id === "msg:dead-senders");
  assert.equal(row.status, "na");
  const laneNaVerify = makeLaneNaVerify({ db: quiet, now: NOW, gapFiles: GAP_FILES });
  const held = await verifyNa({ ...row, sliceId: "gap-msg" }, { db: quiet, now: NOW, laneNaVerify });
  assert.equal(held.ok, true);

  const loud = fakeDb({ ...CLEAN, [DEAD_QUEUED_SQL]: [{ template_key: "SMS-C06-DECLINE", channel: "sms", n: 1 }] });
  const laneNaVerify2 = makeLaneNaVerify({ db: loud, now: NOW, gapFiles: GAP_FILES });
  const fell = await verifyNa({ ...row, sliceId: "gap-msg" }, { db: loud, now: NOW, laneNaVerify: laneNaVerify2 });
  assert.equal(fell.ok, false);
});

// ── 6b / 6c / 7 ──────────────────────────────────────────────────────────────

test("owner alerts: nothing waiting is a PASS; queued with no sender or failed is a FAIL", async () => {
  assert.equal((await lane()).by["msg:owner-alerts-unsent"].status, "PASS");
  const red = (await lane({ [OWNER_ALERTS_SQL]: [{ status: "queued", n: 3, oldest: "2026-10-01T00:00:00Z" }, { status: "failed", n: 1, oldest: "2026-10-02T00:00:00Z" }] })).by["msg:owner-alerts-unsent"];
  assert.equal(red.status, "FAIL");
  assert.match(red.detail, /4 owner alert texts were never sent: 3 still queued with no sender, 1 failed/);
});

test("hiring outreach: nothing held is a PASS; blocked as recipient unknown is a FAIL naming the template", async () => {
  assert.equal((await lane()).by["msg:hiring-outreach-blocked"].status, "PASS");
  const red = (await lane({ [HIRING_BLOCKED_SQL]: [{ template_key: "EMAIL-CANDIDATE-OUTREACH-1", status: "blocked", n: 5, oldest: "2026-10-05T00:00:00Z" }] })).by["msg:hiring-outreach-blocked"];
  assert.equal(red.status, "FAIL");
  assert.match(red.detail, /5 candidate outreach messages are held at the gate or stuck: EMAIL-CANDIDATE-OUTREACH-1 \(blocked\) x5/);
});

test("help reply: no HELP is a PASS, an answered HELP is a PASS, an unanswered HELP is a FAIL that says what it cannot see", async () => {
  assert.equal((await lane()).by["msg:help-reply"].status, "PASS");
  const answered = (await lane({ [HELP_SQL]: [{ asked: 2, answered: 2, unanswered: 0, oldest: null }] })).by["msg:help-reply"];
  assert.equal(answered.status, "PASS");
  assert.match(answered.detail, /2 people texted HELP/);
  const red = (await lane({ [HELP_SQL]: [{ asked: 3, answered: 1, unanswered: 2, oldest: "2026-10-08T00:00:00Z" }] })).by["msg:help-reply"];
  assert.equal(red.status, "FAIL");
  assert.match(red.detail, /2 of 3 people who texted HELP in the last 7 days got no text back inside 24 hours/);
  assert.match(red.detail, /a reply the phone company sends by itself is not seen/);
  const noRead = (await lane({ [HELP_SQL]: [{ asked: null, answered: null, unanswered: null }] })).by["msg:help-reply"];
  assert.equal(noRead.status, "skip");
});

test("help reply: our own test lines and the grace time go into the read, so a fresh HELP is not yet judged", async () => {
  const { db } = await lane();
  const call = db.calls.find((c) => c.text === HELP_SQL);
  assert.equal(call.params[1], "2026-10-03T13:00:00.000Z");
  assert.equal(call.params[2], "2026-10-10T12:30:00.000Z");
  assert.equal(call.params[3], 24);
  assert.match(HELP_SQL, /IN \(\s*SELECT right\(regexp_replace\(ev\.payload->>'to'/);
});
