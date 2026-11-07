// The premium pass (public/app/money-premium.js, 2026-11-07): the pure
// drawing and wording helpers, run in Node with no DOM, plus how money.js
// hands it its slots. Fictional numbers only.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const PREMIUM = fs.readFileSync(path.join(APP, "money-premium.js"), "utf8");
const MONEY = fs.readFileSync(path.join(APP, "money.js"), "utf8");
const FIXTURE = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/money-overview.sandbox.json"), "utf8"));

/* No document: only the pure helpers run. money.js can be loaded beside it. */
function load(files = [PREMIUM]) {
  const sandbox = { window: {} };
  for (const src of files) vm.runInNewContext(src, sandbox);
  return sandbox.window;
}
const W = load();
const P = W.FHPremium;
/* Objects made inside the vm have its own Array/Object: compare their JSON. */
const J = (v) => JSON.parse(JSON.stringify(v));
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/* "M x y C c1x c1y c2x c2y x y C …" → the points the curve passes through,
   and each segment's two control-point y values. */
function curve(d) {
  const nums = (s) => s.trim().split(/[\s,]+/).map(Number);
  const [m, ...segs] = d.split("C");
  const start = nums(m.slice(1));
  const anchors = [start];
  const controls = [];
  for (const s of segs) {
    const n = nums(s);
    controls.push([n[1], n[3]]);
    anchors.push([n[4], n[5]]);
  }
  return { anchors, controls };
}

describe("the smooth line (the demo's monoPath)", () => {
  test("passes through every real point", () => {
    const pts = [[0, 50], [10, 40], [20, 45], [30, 10], [40, 10]];
    const { anchors } = curve(P.monoPath(pts));
    assert.deepEqual(anchors, pts.map(([x, y]) => [x, y]));
  });

  test("never overshoots: between two points the curve stays between their values", () => {
    const pts = [[0, 100], [10, 90], [20, 20], [30, 18], [40, 60], [50, 60]];
    const { controls } = curve(P.monoPath(pts));
    controls.forEach(([c1, c2], i) => {
      const lo = Math.min(pts[i][1], pts[i + 1][1]);
      const hi = Math.max(pts[i][1], pts[i + 1][1]);
      for (const c of [c1, c2]) assert.ok(c >= lo - 1e-9 && c <= hi + 1e-9, `segment ${i}: control ${c} outside ${lo}..${hi}`);
    });
  });

  test("two points are a straight line; one point is a dot", () => {
    assert.equal(P.monoPath([[0, 1], [5, 3]]), "M0.0 1.0L5.0 3.0");
    assert.equal(P.monoPath([[2, 2]]), "M2.0 2.0");
    assert.equal(P.monoPath([]), "");
  });
});

describe("weekly sparklines", () => {
  test("one point a week, the newest day last; a week with no save is a gap, never 0", () => {
    const days = Array.from({ length: 21 }, (_, i) => i + 1);
    assert.deepEqual(J(P.weekly(days)), [7, 14, 21]);
    const gappy = days.map((v, i) => (i >= 7 && i < 14 ? null : v));
    assert.deepEqual(J(P.weekly(gappy)), [7, null, 21]);
    const late = days.map((v, i) => (i === 20 ? null : v));
    assert.deepEqual(J(P.weekly(late)), [7, 14, 20], "the last SAVED day of the week");
  });

  test("no line from fewer than two saved weeks", () => {
    assert.equal(P.sparkSvg([null, null, 5]), "");
    assert.equal(P.sparkSvg([]), "");
    const svg = P.sparkSvg(Array.from({ length: 30 }, (_, i) => 1000 + i * 10), { cls: "s1" });
    assert.match(svg, /<svg class="fh-spark" data-fh-reveal/);
    assert.match(svg, /stroke="#2563EB"/, "personal cash keeps FinanceOS blue");
    assert.match(svg, /aria-hidden="true"/, "the number beside it is what is read out");
  });
});

describe("money in and out bars", () => {
  const o = (inC, outC) => ({
    labels: ["Sep 2026", "Oct 2026", "Nov 2026"], short: ["Sep", "Oct", "Nov"],
    series: [{ cls: "fh-bar-in", name: "Money in", values: inC }, { cls: "fh-bar-out", name: "Money out", values: outC }],
    fmt: P.usd2, aria: "Personal money in and out by month"
  });

  test("a month with no number gets no bar; a real $0 gets a hairline", () => {
    const html = P.barsHtml(o([750000, null, 0], [612340, 500000, 10000]));
    assert.equal((html.match(/class="fh-bar-in fh-bar"/g) || []).length, 2, "Oct money in is unknown: no bar");
    assert.match(html, /<title>Nov 2026 · Money in: \$0\.00<\/title>/);
    assert.match(html, /height="0\.8"/, "the $0 month is a hairline, not nothing");
    assert.match(html, /aria-label="Personal money in and out by month"/);
    assert.match(text(html), /Money in Money out/);
    assert.match(html, /<span>Sep<\/span><span>Oct<\/span><span>Nov<\/span>/);
  });

  test("nothing to draw is no chart", () => {
    assert.equal(P.barsHtml(o([null, null, null], [null, 0, null])), "");
  });
});

describe("the fundability ring and the hero", () => {
  test("the ring is the engine's N of 6", () => {
    const r = P.ringSvg(4, 6);
    assert.match(r, /aria-label="Fundability 4 of 6"/);
    assert.match(r, /stroke-dasharray="66\.7 100"/);
    assert.equal(P.ringSvg(null, 6), "", "no pull: no ring");
  });

  const fund = (over = {}) => ({
    now: { score: 4, score_max: 6, tier: "not_fundable" },
    opportunity: { personal: { currentCents: 9360000, projectedCents: 10400000 }, source: { asOf: "2026-11-06T12:00:00Z" } },
    ...over
  });

  test("UnderwriteIQ's dollars count up to the printed amount; the plan line shows only when it is higher", () => {
    const h = P.heroCard(fund());
    assert.match(h, /data-fh-count="9360000" data-fh-fmt="usd0">\$93,600</);
    assert.match(text(h), /Funding you qualify for \$93,600 With your plan: \$104,000 Estimate · UnderwriteIQ · Nov 6/);
    assert.match(h, /Fundability 4 of 6/);
    assert.match(text(h), /Not fundable yet/);
    const same = P.heroCard(fund({ opportunity: { personal: { currentCents: 10400000, projectedCents: 10400000 }, source: {} } }));
    assert.doesNotMatch(same, /With your plan/);
  });

  test("no figure yet: says so in short words, never $0", () => {
    const h = P.heroCard(fund({ now: { score: null, score_max: null }, opportunity: { personal: { currentCents: null, blockers: ["genuine_credit_report_required"] } } }));
    assert.match(text(h), /Not ready yet Shows after your credit report\./);
    assert.doesNotMatch(h, /\$0|data-fh-count/);
    assert.match(text(h), /Fundability Not measured yet/);
  });
});

describe("the advisor card", () => {
  const BOOK = "https://apply.fundhub.ai/schedule/phonecall";

  test("the CSM's name and Book a call on the owner-set page", () => {
    const a = P.advisorCard({ advisor: { name: "Jordan Lee", role: "csm" }, book_url: BOOK });
    assert.match(text(a), /Your advisor JL Jordan Lee Success manager Book a call/);
    assert.match(a, /href="https:\/\/apply\.fundhub\.ai\/schedule\/phonecall" target="_blank" rel="noopener noreferrer"/);
  });

  test("nobody assigned says so; staff get no Book a call; only an https link is ever drawn", () => {
    assert.match(text(P.advisorCard({ advisor: null, book_url: BOOK })), /Fundhub team Not assigned yet Book a call/);
    assert.doesNotMatch(P.advisorCard({ advisor: { name: "Jordan Lee" }, book_url: BOOK }, { staff: true }), /Book a call/);
    assert.doesNotMatch(P.advisorCard({ advisor: { name: "Jordan Lee" }, book_url: "javascript:alert(1)" }), /Book a call/);
    assert.doesNotMatch(P.advisorCard(null), /Book a call/);
  });
});

describe("repair and funding, one line each from the existing reads", () => {
  let seq = 0;
  const letter = (status, submission = null) => ({ id: `l-${(seq += 1)}`, status, submission });
  /* The client's own submission, the shape GET /api/blueprint/repair gives it. */
  const byMail = (receiptDocumentId = "d-mail") => ({ channel: "mail", receiptDocumentId, reference: "9400 1000 0000", submittedAt: "2026-11-06T12:00:00Z" });
  const online = () => ({ channel: "portal", receiptDocumentId: "d-web", reference: "EQ-123456", submittedAt: "2026-11-06T12:00:00Z" });
  const roundOf = (letters, due = "2026-12-06T00:00:00Z") => ({ ok: true, currentRound: "R1", cases: [{ round: "R1", responseDueAt: due, letters }] });
  const line = (repair, mailing) => P.repairStatus({ repair, mailing }).line;

  test("repair: round, letters ready, mailed only with a receipt, with the bureau's reply date", () => {
    const ready = { ok: true, currentRound: "R1", cases: [{ round: "R1", responseDueAt: null, letters: [letter("generated"), letter("ready")] }] };
    assert.deepEqual(J(P.repairStatus({ repair: ready })), { line: "Round 1 · 2 letters ready", parts: ["Round 1", "2 letters ready"], round: "Round 1", engagement: true });
    // The mail house took it (sent, delivered), or the client mailed it and uploaded the receipt.
    const mailed = { ok: true, currentRound: "R2", cases: [
      { round: "R1", letters: [letter("sent")] },
      { round: "R2", responseDueAt: "2026-12-06T00:00:00Z", letters: [letter("sent", byMail()), letter("sent")] },
      { round: "R2", responseDueAt: "2026-12-09T00:00:00Z", letters: [letter("delivered")] }
    ] };
    assert.equal(P.repairStatus({ repair: mailed }).line, "Round 2 · 3 mailed · Reply due Dec 6");
    assert.match(P.workCards({ repair: mailed }), /Round&nbsp;2 · 3&nbsp;mailed · Reply&nbsp;due&nbsp;Dec&nbsp;6/, "a part never splits on a phone");
  });

  test("CX22: a letter sent on the bureau's website says sent online and is never counted as mailed", () => {
    assert.equal(P.letterKind(letter("sent", online())), "online");
    assert.equal(line(roundOf([letter("sent", online())])), "Round 1 · 1 sent online · Reply due Dec 6");
    assert.doesNotMatch(line(roundOf([letter("sent", online())])), /mailed/);
    assert.equal(line(roundOf([letter("sent", online()), letter("sent", byMail())])), "Round 1 · 1 mailed · 1 sent online · Reply due Dec 6");
  });

  test("CX23: a letter still sending is not mailed until a receipt exists", () => {
    assert.equal(P.letterKind(letter("sending")), "sending");
    assert.equal(line(roundOf([letter("sending")])), "Round 1 · 1 sending", "no receipt yet: no reply clock either");
    // The mail house took it and its id is saved: now it is mailed.
    assert.equal(line(roundOf([letter("sent")])), "Round 1 · 1 mailed · Reply due Dec 6");
    // The client says it went by mail but no receipt is on file: not mailed.
    assert.equal(P.letterKind(letter("sent", byMail(null))), null);
    assert.equal(line(roundOf([letter("sent", byMail(null))])), "Round 1 · In progress");
    assert.equal(line(roundOf([letter("sending"), letter("sent", byMail()), letter("sent", online())])),
      "Round 1 · 1 mailed · 1 sent online · 1 sending · Reply due Dec 6");
  });

  test("one letter, one place: a repair letter in a $97 mailing is counted once", () => {
    const waiting = letter("ready"), other = letter("ready");
    /* The mailing read lists the round's repair letters too (kind "repair", letterId). */
    const listed = [{ kind: "repair", letterId: waiting.id, eligibleForMailing: false }, { kind: "repair", letterId: other.id, eligibleForMailing: true }];
    const order = (state, envelopes) => ({ ok: true, letters: listed, orders: [{ status: state, envelopes }] });
    // Paid, not out yet: requested, and not also ready.
    assert.equal(line(roundOf([waiting, other], null), order("mail_pending", [{ letterId: waiting.id, status: "ready", providerId: null }])),
      "Round 1 · Mailing requested · 1 ready");
    // Out with the mail house: the letter's own record says sending; its envelope adds nothing.
    const out = { ...waiting, status: "sending" };
    assert.equal(line(roundOf([out, other], null), order("mailing", [{ letterId: waiting.id, status: "sending", providerId: null }])),
      "Round 1 · 1 sending · 1 ready");
    // Accepted: mailed once, from the letter.
    const sent = { ...waiting, status: "sent" };
    assert.equal(line(roundOf([sent, other]), order("mailed", [{ letterId: waiting.id, status: "accepted", providerId: "letter_abc123" }])),
      "Round 1 · 1 mailed · 1 ready · Reply due Dec 6");
    // The plan's other letters (not repair letters) count once, from the mailing read.
    const plan = { ok: true, letters: [{ documentId: "d-f", eligibleForMailing: true }], orders: [{ status: "mailed", envelopes: [{ status: "accepted", providerId: "letter_f1", mailStatus: "mailed" }] }] };
    assert.equal(line(roundOf([other], null), plan), "Round 1 · 1 mailed · 2 ready");
    assert.equal(line(roundOf([], null), { ok: true, letters: [{ eligibleForMailing: true }, { eligibleForMailing: true }], orders: [] }), "Round 1 · 2 letters ready");
  });

  test("repair for a plan without the full engagement: the letters read alone", () => {
    assert.deepEqual(J(P.repairStatus({ repair: null, mailing: { ok: true, letters: [{ eligibleForMailing: true }, { eligibleForMailing: false }], orders: [] } })),
      { line: "1 letter ready", parts: ["1 letter ready"], round: null, engagement: false });
    assert.equal(P.repairStatus({ mailing: { ok: true, letters: [], orders: [{ status: "mail_pending", envelopes: [] }] } }).line, "Mailing requested");
    const envs = (...e) => ({ ok: true, letters: [], orders: [{ status: "mailing", envelopes: e }] });
    assert.equal(line(null, envs({ status: "accepted", providerId: "letter_1", mailStatus: "mailed" }, { status: "accepted", providerId: "letter_2", mailStatus: "mailed" })), "2 mailed");
    assert.equal(line(null, envs({ status: "accepted", providerId: "letter_1", mailStatus: "mailed" }, { status: "sending", providerId: null, mailStatus: "sending" })), "1 mailed · 1 sending");
    assert.equal(P.envelopeKind({ status: "accepted", providerId: null }), null, "no mail house id: no receipt");
    // Codex CX28: accepted (or printing) at the mail house is Sending, never mailed. Mailed starts
    // only when the mailing read says PostGrid handed it to the post office.
    assert.equal(P.envelopeKind({ status: "accepted", providerId: "letter_9", mailStatus: "sending" }), "sending");
    assert.equal(P.envelopeKind({ status: "accepted", providerId: "letter_9" }), null, "accepted with an id but no mailStatus is not counted as mailed");
    assert.equal(P.envelopeKind({ status: "accepted", providerId: "letter_9", mailStatus: null }), null, "held or cancelled: not with the mail house");
    assert.equal(line(null, envs({ status: "accepted", providerId: "letter_1", mailStatus: "sending" })), "1 sending");
    assert.equal(line(null, envs({ status: "ready", providerId: null })), "Mailing requested");
    assert.equal(P.repairStatus({ repair: { ok: true, currentRound: "R1", executionOwner: "fundhub", cases: [{ round: "R1", letters: [] }] } }).line, "Round 1 · Fundhub is on it");
    assert.equal(P.repairStatus({ repair: null, mailing: null }), null, "neither read: no card");
  });

  test("funding: round, applied and approved; the state in words before the first application", () => {
    const f = { ok: true, engagement: { roundNumber: 2 }, state: "awaiting_response", applications: [
      { status: "Approved" }, { status: "Pending" }, { status: "Apply", reportedStatus: "denied" }, { status: "Apply" }
    ] };
    assert.deepEqual(J(P.fundingStatus(f)), { line: "Round 2 · 3 applied · 1 approved", parts: ["Round 2", "3 applied", "1 approved"] });
    assert.deepEqual(J(P.fundingStatus({ ok: true, engagement: {}, state: "optimize", applications: [] })), { line: "Preparing your file", parts: ["Preparing your file"] });
    assert.equal(P.fundingStatus({ ok: false }), null);
    assert.equal(P.fundingStatus(null), null);
  });

  test("the cards open the existing views: in the portal in place, elsewhere by link", () => {
    const d = { repair: { ok: true, currentRound: "R1", cases: [{ round: "R1", letters: [letter("ready")] }] }, funding: { ok: true, engagement: { roundNumber: 1 }, state: "ready", applications: [] } };
    const inPortal = P.workCards(d);
    assert.match(inPortal, /data-fh-go="repair">Open repair</);
    assert.match(inPortal, /data-fh-go="letters">Letters and mailing</);
    assert.match(inPortal, /data-fh-go="funding">Open applications</);
    const linked = P.workCards({ ...d, link: true });
    assert.match(linked, /href="\/app\/client-portal\.html#repair">Open repair</);
    assert.match(linked, /href="\/app\/client-portal\.html#funding">Open applications</);
    const planOnly = P.workCards({ mailing: { ok: true, letters: [{ eligibleForMailing: true }], orders: [] }, link: true });
    assert.match(planOnly, /#letters">Open letters</, "no full engagement: the letters view, no funding card");
    assert.doesNotMatch(planOnly, /Funding/);
    assert.equal(P.workCards({}), "");
  });

  test("cards sit 12 / 6+6 / 4+4+4 on one row", () => {
    const a = P.advisorCard(null);
    assert.match(P.grid([a]), /data-n="1"/);
    assert.match(P.grid([a, P.workCards({ funding: { ok: true, engagement: {}, applications: [] } })]), /data-n="2"/);
    assert.equal(P.grid(["", null]), "");
  });
});

describe("the monthly report card", () => {
  test("this month and the eleven before it, newest first", () => {
    const m = J(P.reportMonths("2026-02-10"));
    assert.equal(m.length, 12);
    assert.deepEqual(m[0], { value: "2026-02", label: "February 2026" });
    assert.deepEqual(m[2], { value: "2025-12", label: "December 2025" });
    assert.deepEqual(m[11], { value: "2025-03", label: "March 2025" });
    const card = P.reportCard("2026-02-10");
    assert.match(card, /data-fh-act="report">Download PDF</);
    assert.match(card, /<label class="fh-sr" for="fh-rep-month">Report month<\/label>/);
  });
});

describe("a number counts up to exactly what the page printed", () => {
  test("the formats match money.js and the Blueprint's own, so the last frame is the printed words", () => {
    const M = load([MONEY]).FHMoney;
    for (const c of [0, 5, 99, 123456, 939495, -48881, 1225000]) assert.equal(P.usd2(c), M.money(c), String(c));
    for (const v of [0, 5, 12.34, 25, 99.95]) assert.equal(P.pct1(v), M.pct(v), String(v));
    const intl = (c) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(c / 100);
    for (const c of [0, 9360000, 10400000, 199350000, 4999]) assert.equal(P.usd0(c), intl(c), String(c));
  });
});

describe("money.js hands the premium pass its places", () => {
  const both = load([PREMIUM, MONEY]);
  const plain = load([MONEY]).FHMoney;
  const fixture = () => JSON.parse(JSON.stringify(FIXTURE));

  test("two empty slots: the hero after Next due and before the tiles, the cards under the tiles", () => {
    const html = plain.render(fixture());
    const next = html.indexOf('class="money-next-due"');
    const top = html.indexOf('data-fh-premium-slot="top"');
    const tiles = html.indexOf('class="grid tiles"');
    const more = html.indexOf('data-fh-premium-slot="more"');
    assert.ok(next > 0 && next < top && top < tiles && tiles < more, "Next due stays right under the actions; then the hero, the tiles, the cards");
    const empty = fixture();
    empty.accounts = [];
    assert.match(plain.render(empty), /data-fh-premium-slot="top"[\s\S]*No bank accounts yet[\s\S]*data-fh-premium-slot="more"/,
      "no bank yet: the funding estimate and the advisor still show");
  });

  test("tile numbers may count up; an 'at least' total and a dash never do", () => {
    const d = fixture();
    const html = plain.render(d);
    assert.match(html, /data-fh-spark="cash\.personal"/);
    assert.match(html, /data-fh-spark="debt\.total"/);
    assert.match(html, /data-fh-spark="cards_used"/);
    const floor = fixture();
    floor.cash.personal = { cents: 120000, is_floor: true, accounts: 2 };
    assert.doesNotMatch(plain.render(floor), /data-fh-count="120000"/);
    for (const m of html.matchAll(/data-fh-count="([^"]+)" data-fh-fmt="(usd2|pct1)">([^<]+)</g)) {
      assert.equal(P.formatAs(m[2], Number(m[1])), m[3], "the count lands on the printed words");
    }
  });

  test("with money-premium.js on the page, cashflow is the demo's bars; a kind with no numbers says so", () => {
    const html = both.FHMoney.render(fixture());
    const personal = html.slice(html.indexOf('class="card flow" data-kind="personal"'), html.indexOf('class="card flow" data-kind="business"'));
    assert.match(personal, /class="fh-bars"/);
    assert.equal((personal.match(/class="fh-bar-in fh-bar"/g) || []).length, 3, "three months of money in");
    assert.match(personal, /<table class="flow-table">/, "the numbers table stays");
    assert.doesNotMatch(personal, /class="bar-in"/, "not the old bars as well");
    assert.match(plain.render(fixture()), /class="bar-in"/, "without the file, the old bars still draw");
    const d = fixture();
    for (const m of d.cashflow.months) m.business = { in_cents: null, out_cents: null };
    assert.match(both.FHMoney.render(d), /data-kind="business"><h3 class="eyebrow">Business cashflow<\/h3><p class="caption">No business bank activity yet\.<\/p>/);
  });
});
