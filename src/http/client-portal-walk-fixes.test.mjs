// The five things a client saw on the 2026-09-03 live walk that were wrong on
// the screen itself, pinned so they cannot come back.
//
// These read the shipped HTML rather than a browser, which is what the rest of
// the portal's tests here do (src/http/consent-sign-pad-html.test.mjs,
// src/http/portal-signed-out-bounce.test.mjs). A file scan cannot prove a pixel;
// it can prove that the wrong copy is gone and the gate is written down, which is
// what each of these five failures actually was.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORTAL = path.resolve(HERE, "../../public/app/client-portal.html");
const html = fs.readFileSync(PORTAL, "utf8");

// Run the shipped decision functions on saved facts; no browser/API or new
// production test hook is needed for these next-owner regressions.
function blueprintDecision(data) {
  const source = fs.readFileSync(path.join(HERE, "../../public/app/blueprint-plan.js"), "utf8");
  function implementation(name) {
    const start = source.indexOf("function " + name + "(");
    const end = source.indexOf("\n  function ", start + 10);
    assert.ok(start >= 0 && end > start, "Missing shipped Blueprint decision " + name);
    return source.slice(start, end);
  }
  const context = { data, businesses: () => data.businessPlans.businesses,
    btn: (label, action, primary, attributes) => ({ label, action, primary, attributes }),
    window: { FHBlueprintJourney: { route: value => value } }, esc: String };
  vm.createContext(context);
  vm.runInContext(implementation("nextWaypoint") + "\n" + implementation("nextAction") +
    "\nglobalThis.answer={next:nextWaypoint(),action:nextAction(nextWaypoint())};", context);
  return context.answer;
}

test("Blueprint next action follows a pending team review instead of restarting three saved businesses", () => {
  const review = { id: "review", key: "review_documents", title: "Fundhub reviews your saved documents",
    detail: "Your documents are waiting for the team.", owner: "fundhub", state: "in_progress", completedAt: null };
  const data = { businessPlans: { startedAt: "2026-11-01", businesses: [{ id: "a" }, { id: "b" }, { id: "c" }] },
    progress: { nextStep: { waypointId: review.id, owner: "fundhub" }, waypoints: [review] } };
  let result = blueprintDecision(data);
  assert.equal(result.next.id, review.id);
  assert.equal(result.action.title, review.title);
  assert.equal(result.action.control.label, "Check my review timeline");
  assert.match(result.action.control.attributes, /data-view="timeline"/);
  assert.notEqual(result.action.control.action, "new-business");
  data.progress.nextStep = null;
  data.progress.waypoints = [{ ...review, state: "done", completedAt: "2026-11-02" }];
  result = blueprintDecision(data);
  assert.equal(result.next, null);
  assert.equal(result.action.title, "Review your saved plan");
  assert.match(result.action.control.attributes, /data-view="businesses"/);
  assert.notEqual(result.action.control.action, "new-business");
});

test("Blueprint funding breakdown includes an existing company without a linked preparation plan exactly once", () => {
  const context = { window: {}, document: { addEventListener() {} }, location: { origin: "https://app.example.invalid" }, URL, Intl };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(HERE, "../../public/app/blueprint-journey.js"), "utf8"), context);
  const data = { businessPlans: { startedAt: "2026-11-01", businesses: [{ id: "planned", name: "Planned Company" }],
    existingBusinesses: [{ id: "actual", name: "Existing Owned Company" }] },
    creditContext: { opportunity: { personal: { currentCents: null }, combined: { currentCents: null },
      businesses: [{ planId: "planned", businessId: null, name: "Planned Company", currentCents: null, blockers: [] },
        { planId: null, businessId: "actual", name: "Existing Owned Company", currentCents: null, blockers: ["ein_evidence_required"] }] } },
    progress: { waypoints: [], scores: { personal: [], business: [] } } };
  const rendered = context.window.FHBlueprintJourney.render({ data });
  assert.equal((rendered.match(/Planned Company/g) || []).length, 1);
  assert.equal((rendered.match(/Existing Owned Company/g) || []).length, 1);
  assert.match(rendered, /EIN proof needed/);
  // Short client words (owner rule 2026-11-07): one short line, no review jargon.
  assert.match(rendered, /Each business needs its own report\./);
  assert.doesNotMatch(rendered, /overlap review/);
});

/* Accountability QA07/QA08 (2026-11-07): an amount the plan does not move shows
   once, and the panel carries no approval disclaimer or jargon. */
test("Blueprint funding shows one amount when the plan does not move it, and no approval disclaimer", () => {
  const context = { window: {}, document: { addEventListener() {} }, location: { origin: "https://app.example.invalid" }, URL, Intl };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(HERE, "../../public/app/blueprint-journey.js"), "utf8"), context);
  const data = (projectedCents) => ({ businessPlans: { startedAt: "2026-11-01", businesses: [] },
    creditContext: { opportunity: { personal: { currentCents: 10400000, projectedCents, blockers: [] }, combined: { currentCents: null }, businesses: [] } },
    progress: { waypoints: [], scores: { personal: [], business: [] } } });
  const capacity = (html) => html.match(/<div class="bj-capacity">[\s\S]*?<\/div>/)[0];
  const same = context.window.FHBlueprintJourney.render({ data: data(10400000) });
  assert.doesNotMatch(capacity(same), /→/, "$104,000 → $104,000 shows once");
  assert.equal((capacity(same).match(/\$104,000/g) || []).length, 1);
  assert.match(capacity(context.window.FHBlueprintJourney.render({ data: data(11000000) })), /→ \$110,000/);
  assert.doesNotMatch(same, /Estimates are not approvals|counted once|joint paydown/);
});

/* Accountability QA20 and QA25 (2026-11-07): the bureau rows stop crushing on a
   phone, and "Your path" says the engine's change in plain words. */
function journey() {
  const context = { window: {}, document: { addEventListener() {} }, location: { origin: "https://app.example.invalid" }, URL, Intl };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(HERE, "../../public/app/blueprint-journey.js"), "utf8"), context);
  return context.window.FHBlueprintJourney;
}

test("Blueprint credit rows put each pull's date under its score, and no pull shows no date (QA20)", () => {
  const J = journey();
  const data = (personal) => ({ businessPlans: { startedAt: "2026-11-01", businesses: [] },
    creditContext: { opportunity: { personal: { currentCents: 10400000, projectedCents: 10400000, blockers: [] }, combined: {}, businesses: [] } },
    progress: { waypoints: [], scores: { personal, business: [] } } });
  const bureauRows = (html) => html.match(/<section class="bj-credit">[\s\S]*?<\/dl>/)[0].match(/<div>[\s\S]*?<\/div>/g);
  const none = bureauRows(J.render({ data: data([]) }));
  assert.equal(none.length, 3);
  for (const row of none) {
    assert.match(row, /^<div><dt>(Experian|Equifax|TransUnion)<\/dt><dd>Not pulled yet<\/dd><\/div>$/, "two pieces in the row, and no date with no pull");
  }
  const pulled = bureauRows(J.render({ data: data([{ bureau: "experian", score: 712, pulledAt: "2026-11-06T12:00:00Z" }]) }));
  assert.match(pulled[0], /^<div><dt>Experian<\/dt><dd>712<br><small>Nov 6, 2026<\/small><\/dd><\/div>$/, "the date sits under the score");
  assert.doesNotMatch(pulled.join(""), /No report date|<\/dd><small>/);
});

test("Blueprint path: the funding change is the engine's dollars in plain words, never its × numbers (QA25)", () => {
  const J = journey();
  const plan = (change) => ({ businessPlans: { startedAt: "2026-11-01", businesses: [] },
    progress: { waypoints: [], scores: { personal: [], business: [] } },
    path: { steps: [], milestones: [], counts: { done: 0, total: 0 },
      funding: { todayCents: 10400000, projectedCents: 10400000, change, business: { unlocked: false, text: "Unlocks after your first business is on file" } },
      cards: { todayPct: 5, targetPct: 10 }, fundability: null } });
  const panel = (change) => J.render({ data: plan(change) }).match(/<section class="bj-path">[\s\S]*?<\/section>/)[0];
  const line = (change) => (panel(change).match(/<p class="bj-impact">([^<]*)<\/p>/) || [])[1] || null;
  const cardUse = (from, to) => ({ modifier: "utilization", words: "card use", from, to });
  assert.equal(line({ deltaCents: 1040000, moved: [cardUse(0.9, 1)] }), "+$10,400 now that card use is under 10%");
  assert.doesNotMatch(panel({ deltaCents: 1040000, moved: [cardUse(0.9, 1)] }), /×/);
  assert.equal(line({ deltaCents: 500000, moved: [{ modifier: "thinFile", words: "thin file", from: 0.6, to: 1 }, cardUse(0.9, 1)] }),
    "+$5,000 now that you have 3 or more of your own accounts and card use is under 10%");
  // A move the engine's own marks cannot name, or a drop, shows the dollars alone.
  assert.equal(line({ deltaCents: 1040000, moved: [cardUse(0.75, 0.9)] }), "+$10,400 funding");
  assert.equal(line({ deltaCents: -1040000, moved: [cardUse(1, 0.9)] }), "-$10,400 funding");
  assert.equal(line({ deltaCents: 0, moved: [cardUse(0.9, 1)] }), null, "no change, no line");
});

/* Unit S (2026-11-07, Chris's spot): the look-ahead sits INSIDE "Funding you
   qualify for" and paints only from the look-ahead read. Unit TL: the bank steps
   carry the "Existing relationship" and "You already have this" tags. */
function journeyContext(slots = []) {
  const context = { window: {}, document: { addEventListener() {}, querySelectorAll: () => slots, querySelector: () => null },
    location: { origin: "https://app.example.invalid" }, URL, Intl, Promise };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(HERE, "../../public/app/blueprint-journey.js"), "utf8"), context);
  return context.window.FHBlueprintJourney;
}
const LOOK = { ok: true, view: "lookahead", has_pull: true, months: 9, now: { fundhub_score: { score: 62 } },
  points: [3, 6, 9, 12].map((m) => ({ months: m, scenario: "plan", tier: m >= 9 ? "fundable" : "not_fundable",
    funding_estimate_cents: m >= 9 ? 10400000 : null, fundhub_score: { score: 60 + m } })) };
const PATH_DATA = (steps = []) => ({ businessPlans: { startedAt: "2026-11-01", businesses: [] },
  path: { steps, milestones: [], counts: { done: 0, total: steps.length }, funding: { todayCents: 9360000, projectedCents: 10400000 },
    cards: {}, fundability: { tier: "not_fundable", text: "4 of 6" }, cash: null, businesses: null, chexsystems: {} },
  progress: { waypoints: [], scores: { personal: [], business: [] } } });

test("the look-ahead slot is inside Funding you qualify for, and paints only the look-ahead read", async () => {
  const J = journeyContext();
  const html = J.render({ data: PATH_DATA() });
  const card = html.match(/<section class="bj-path">[\s\S]*?<\/section>/)[0];
  assert.match(card, /Funding you qualify for/);
  assert.match(card, /<div class="bj-ahead" data-bj-ahead hidden><\/div><\/section>$/, "the slot closes the card, inside it");
  const ahead = J.aheadHtml(LOOK, 9);
  assert.match(ahead, /In 9 months on your plan · estimate/);
  assert.match(ahead, /\$104,000/);
  assert.match(ahead, /62 → 69/);
  assert.match(ahead, /data-bj-ahead-month="9" aria-pressed="true"/);
  assert.match(J.aheadHtml(LOOK, 3), /Not fundable yet/, "no estimate yet: the tier in words, never $0");
  assert.doesNotMatch(J.aheadHtml(LOOK, 3), /\$0/);
  assert.equal(J.aheadHtml({ ...LOOK, has_pull: false }, 9), "", "no pull: nothing");
  assert.equal(J.aheadHtml({ ok: true, view: "fundability", now: {} }, 9), "", "not the look-ahead read: nothing");
});

test("lookahead(host, request) fills every slot from one read, and a failed or other read leaves it hidden", async () => {
  const slot = { innerHTML: "", hidden: true };
  const J = journeyContext([slot]);
  const asked = [];
  const host = { querySelector: () => slot };
  J.lookahead(host, async (p) => { asked.push(p); return LOOK; });
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(asked, ["/api/money/fundability?view=lookahead"]);
  assert.equal(slot.hidden, false);
  assert.match(slot.innerHTML, /\$104,000/);

  const other = { innerHTML: "", hidden: true };
  const J2 = journeyContext([other]);
  J2.lookahead({ querySelector: () => other }, async () => ({ ok: true, view: "fundability" }));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(other.hidden, true, "the sample demo's plain read keeps the slot hidden");
  const failed = { innerHTML: "", hidden: true };
  const J3 = journeyContext([failed]);
  J3.lookahead({ querySelector: () => failed }, async () => { throw new Error("offline"); });
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(failed.hidden, true);
  assert.equal(J3.lookahead({ querySelector: () => null }, async () => assert.fail("no slot, no read")), undefined);
});

/* Codex CX30: Refresh kept the first look-ahead read forever. Now the page calls
   refreshLookahead() when it reads its file again, and the engine is asked again. */
const settle = async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); };
const lookAt = (cents) => ({ ...LOOK, points: LOOK.points.map((p) => (p.months === 9 ? { ...p, funding_estimate_cents: cents } : p)) });

test("Refresh reads the look-ahead again, and the old estimate never survives it (CX30)", async () => {
  const slot = { innerHTML: "", hidden: true };
  const J = journeyContext([slot]);
  const host = { querySelector: () => slot };
  let answer = lookAt(11100000);
  const asked = [];
  const request = async (p) => { asked.push(p); if (answer instanceof Error) throw answer; return answer; };
  J.lookahead(host, request);
  await settle();
  assert.match(slot.innerHTML, /\$111,000/);
  J.lookahead(host, request);
  await settle();
  assert.equal(asked.length, 1, "a plain repaint (a tab switch) keeps the one read");

  answer = lookAt(12500000);
  J.refreshLookahead();
  assert.equal(slot.hidden, true, "the old estimate leaves the card as soon as Refresh starts");
  assert.doesNotMatch(slot.innerHTML, /\$111,000/);
  J.lookahead(host, request);
  J.lookahead(host, request);
  await settle();
  assert.equal(asked.length, 2, "Refresh asks the engine once more; the page painting again while it reads does not ask twice");
  assert.equal(slot.hidden, false);
  assert.match(slot.innerHTML, /\$125,000/);
  assert.doesNotMatch(slot.innerHTML, /\$111,000/);

  answer = new Error("offline");
  J.refreshLookahead();
  J.lookahead(host, request);
  await settle();
  assert.equal(slot.hidden, true, "a Refresh whose read fails hides the card");
  assert.doesNotMatch(slot.innerHTML, /\$125,000|\$111,000/);
});

test("a read from before the Refresh that lands late never paints over the new one (CX30)", async () => {
  const slot = { innerHTML: "", hidden: true };
  const J = journeyContext([slot]);
  const host = { querySelector: () => slot };
  let landOld;
  const slow = new Promise((resolve) => { landOld = resolve; });
  const answers = [slow, lookAt(12500000)];
  const request = () => answers.shift();
  J.lookahead(host, request);
  J.refreshLookahead();
  await settle();
  assert.equal(answers.length, 0, "Refresh asked again right away, with a slot already on the page");
  assert.match(slot.innerHTML, /\$125,000/);
  landOld(lookAt(11100000));
  await settle();
  assert.match(slot.innerHTML, /\$125,000/);
  assert.doesNotMatch(slot.innerHTML, /\$111,000/);
});

test("Refresh from one Blueprint page still fills the other page's card (CX30)", async () => {
  // The plan page has started its read when the funding workspace's Refresh runs.
  const slot = { innerHTML: "", hidden: true };
  const J = journeyContext([slot]);
  const asked = [];
  J.lookahead({ querySelector: () => slot }, async (p) => { asked.push(p); return lookAt(12500000); });
  J.refreshLookahead();
  await settle();
  assert.equal(asked.length, 2, "the dropped read is asked again, not left empty");
  assert.equal(slot.hidden, false);
  assert.match(slot.innerHTML, /\$125,000/);
});

test("both Blueprint pages read the look-ahead again when they read the file again (CX30)", () => {
  const fulfillment = fs.readFileSync(path.join(HERE, "../../public/app/blueprint-fulfillment.js"), "utf8");
  const refresh = fulfillment.slice(fulfillment.indexOf("async function refresh("), fulfillment.indexOf("request('/api/blueprint/funding')"));
  assert.match(refresh, /FHBlueprintJourney\?\.refreshLookahead\?\.\(\)/, "Refresh drops the old estimate before it reads");
  const plan = fs.readFileSync(path.join(HERE, "../../public/app/blueprint-plan.js"), "utf8");
  const load = plan.slice(plan.indexOf("async function load("), plan.indexOf("request('/api/blueprint/plan')", plan.indexOf("async function load(")));
  assert.match(load, /FHBlueprintJourney\?\.refreshLookahead\?\.\(\)/, "the plan page's read drops it too");
  const letters = plan.slice(plan.indexOf("if(action==='refresh-letter-reviews')"), plan.indexOf("request('/api/blueprint/plan')", plan.indexOf("if(action==='refresh-letter-reviews')")));
  assert.match(letters, /FHBlueprintJourney\?\.refreshLookahead\?\.\(\)/, "Refresh letters and reviews reads the plan again, so it drops it too");
});

test("a bank step shows Existing relationship and You already have this only when the plan says so", () => {
  const J = journeyContext();
  const step = (bank) => ({ key: "bank_open_chase", kind: "bank", title: "Open a Chase business checking", state: "open", owner: "client", waitingOn: [], bank });
  const tagged = J.render({ data: PATH_DATA([step({ name: "Chase", existingRelationship: true, hasAccount: true, tracker: {} })]) });
  assert.match(tagged, /Existing relationship/);
  assert.match(tagged, /You already have this/);
  const plain = J.render({ data: PATH_DATA([step({ name: "Chase", existingRelationship: false, hasAccount: false, tracker: {} })]) });
  assert.doesNotMatch(plain, /Existing relationship|You already have this/);
});

describe("client portal — the 2026-09-03 walk findings", () => {
  test("F33 — the stage is read, not hardcoded", () => {
    // The screen used to assign "Your call is next." unconditionally on every
    // paint, so nothing that happened to the client could ever change it.
    assert.doesNotMatch(
      html,
      /textContent\s*=\s*"Welcome to your Fundhub portal\. Your call is next\."/,
      "the greeting must not be assigned a fixed pre-call sentence"
    );
    assert.match(html, /data\.stage/, "must read the stage off portal-summary");
    assert.match(html, /STAGE_COPY/, "must keep one table of stage words");
    for (const key of ["booked", "soft_pull", "call_held", "agreement_signed", "paid"]) {
      assert.match(html, new RegExp("\\b" + key + "\\s*:"), `no copy for stage ${key}`);
    }
  });

  test("F34 — the advisor panel has a real empty state", () => {
    assert.ok(!html.includes("Name not shown here"),
      "'Name not shown here' reads as a broken field, not an answer");
    assert.match(html, /data\.advisor/, "the advisor must come from portal-summary");
    assert.ok(html.includes("Not assigned yet"), "must say plainly when nobody is on the file");
  });

  test("F35 — the dispute-letter card is gated on repair AND the funding offer", () => {
    // Owner-set 2026-09-03: repair and the funding offer sign; courses and
    // e-products never do. The screen reads `dispute_consent`, which is the
    // server's answer to that whole question — NOT `repair_path`, which is
    // narrower and is false for every funding customer.
    assert.match(
      html,
      /body\.no-dispute-consent\s*#dispute-auth-card\s*\{\s*display:\s*none/,
      "the card must have a CSS gate"
    );
    assert.match(html, /<body class="[^"]*\bno-dispute-consent\b/,
      "the gate must start CLOSED on the body, so an unanswered read keeps it shut");
    assert.match(html, /data\.dispute_consent\s*!==\s*true/,
      "a missing dispute_consent must keep the card shut, not open it");
    assert.doesNotMatch(html, /toggle\(\s*"no-repair-path"/,
      "the card must not be gated on repair_path — that refuses every funding client");
  });

  test("F36 — one honest starting row, then authenticated saved-chat read", () => {
    // The new client Messages tab reads its OWN saved portal conversation.
    // A permanent 'no messages' row would falsely hide a buyer's saved replies.
    const at = html.indexOf('id="tp-msg"');
    assert.ok(at > 0, "Messages tab must exist");
    const initialPane = html.slice(at, at + 450);
    assert.equal((initialPane.match(/class="timeline-item"/g) || []).length, 1,
      "exactly one starting message row before the authenticated response");
    assert.match(initialPane, /Messages from your portal chat appear here/);
    assert.ok(!html.includes('id="msg-live-empty"'), "no duplicated stale empty row");
    assert.match(html, /session\.principal !== "client"/,
      "client chat read must be guarded by an authenticated client session");
    assert.match(html, /fetch\("\/api\/chat\/portal-message"/,
      "Messages tab must actually read saved portal chat");
    assert.match(html, /No saved portal chat messages yet/,
      "a real empty read must show a scoped honest empty state");
    assert.match(html, /We could not load your saved chat messages/,
      "a failed read must not masquerade as an empty history");
  });

  test("F37 — an owned offer is not priced as a locked upsell", () => {
    assert.match(html, /function setTilePrice/, "the price line must repaint with the lock");
    assert.ok(html.includes("Included — you own this"),
      "an owned tile must say so where the price was");
    assert.match(html, /data-price/, "the upsell price must be kept so a revoked grant can restore it");
  });

  test("F31 — a signed-out visitor is offered a sign-in link", () => {
    assert.ok(html.includes("Email me a sign-in link"), "the door must be a real control");
    assert.match(html, /["']\/portal-login\.html["']/,
      "it must point at the page that already owns the mail-me-a-link flow");
    assert.match(html, /function showSignInDoor/);
    // Staff hit the same refusal with no ?id=; their door is /login.html.
    assert.match(html, /STAFF_ROLES\[roleHint\(\)\]/);
  });
});
