// /app/money-declines.html — runs money-declines.js's own render functions
// against a view built by the REAL store (src/blueprint/decline-defense.mjs)
// from one sample decline for the Blueprint sim client (029964c5…): the client's
// own file has 4 hard inquiries, Experian 2, so the bank's stated reason is
// inquiries — one consistent person (.claude/rules/sample-clients-consistent.md).
// Checks the page rules: the letter's own words, a person for the part nobody
// could match, status in words and a shape, no sources or lender book on a
// client screen, four states, one primary action, scoped styles, no px font
// sizes, the shared nav, and a phone layout.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { recordDecline, readDeclines } from "../blueprint/decline-defense.mjs";
import { memoryDb, SIM_CLIENT as SIM, SIM_APPLICATIONS, SIM_SAMPLE_LETTER as SAMPLE_LETTER } from "../blueprint/decline-defense.test.db.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const HTML = fs.readFileSync(path.join(APP, "money-declines.html"), "utf8");
const JS = fs.readFileSync(path.join(APP, "money-declines.js"), "utf8");
const CSS = fs.readFileSync(path.join(APP, "money-declines.css"), "utf8");

async function sampleView() {
  const db = memoryDb({ client: SIM, applications: SIM_APPLICATIONS });
  await recordDecline(db, { orgId: SIM.org_id, clientId: SIM.id, by: { kind: "client" }, source: "client_paste",
    input: { application_id: SIM_APPLICATIONS[0].id, text: SAMPLE_LETTER } });
  return (await readDeclines(db, { orgId: SIM.org_id, clientId: SIM.id, viewer: { kind: "client" } })).view;
}

function load() {
  const sandbox = { window: {} };
  vm.runInNewContext(JS, sandbox);
  return sandbox.window;
}
const W = load();
const F = W.FHMoneyDeclines;
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const primaries = (html) => (html.match(/class="dc-btn-primary"/g) || []).length;

test("the page loads its script and stylesheet, reads /api/blueprint/declines, and keeps out of the staff shell", () => {
  assert.match(HTML, /<script defer src="money-declines\.js"><\/script>/);
  assert.match(HTML, /<link rel="stylesheet" href="money-declines\.css">/);
  assert.match(HTML, /id="declines-root"/);
  assert.match(HTML, /<div class="app">/);
  assert.doesNotMatch(HTML, /src="shell\.js"/);
  assert.doesNotMatch(HTML, /crm-sidebar\.css/);
  assert.match(JS, /"\/api\/blueprint\/declines"/);
});

test("the shared money nav, with Applications as the one current page", () => {
  const nav = HTML.match(/<nav class="mnav"[\s\S]*?<\/nav>/)[0];
  const hrefs = nav.match(/href="([^"]+)"/g).map((h) => h.slice(6, -1));
  assert.deepEqual(hrefs, [
    "/app/financeos.html#overview", "/app/financeos.html#accounts", "/app/financeos.html#credit",
    "/app/money-declines.html",
    "/app/financeos.html#connections", "/app/financeos.html#payments", "/app/financeos.html#setup"
  ]);
  assert.match(nav, /href="\/app\/money-declines\.html" aria-current="page">Applications</);
  assert.equal((nav.match(/aria-current="page"/g) || []).length, 1);
});

test("it registers as the FinanceOS section the one-page FinanceOS mounts", () => {
  assert.equal(W.FinanceOS.sections.declines.title, "Applications");
  assert.equal(typeof W.FinanceOS.sections.declines.mount, "function");
});

test("no px font size anywhere, no font shorthand with a size, no outside script, no new dependency", () => {
  const style = HTML.match(/<style>([\s\S]*?)<\/style>/)[1];
  for (const src of [style, CSS, JS]) {
    assert.doesNotMatch(src, /font-size\s*:\s*\d/);
    assert.doesNotMatch(src, /(?:^|[;{\s])font\s*:\s*[^;}]*\d+px/);
  }
  assert.doesNotMatch(HTML, /<script[^>]+src="https?:/, "no outside script");
  assert.doesNotMatch(JS, /require\(|import /, "plain browser script");
});

test("the section's styles all live under .fh-declines, with no hand-rolled shadow", () => {
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, "");
  const selectors = css.replace(/@media[^{]+\{/g, "").split("}").map((r) => r.split("{")[0].trim()).filter(Boolean);
  assert.ok(selectors.length > 30);
  for (const sel of selectors) for (const part of sel.split(",")) assert.match(part.trim(), /^\.fh-declines(\s|$)/, part);
  assert.doesNotMatch(CSS, /box-shadow/, "the resting shadow comes from fundhub-brand.css (UI-STANDARDS §12.2)");
});

test("spacing stays on the 8px scale", () => {
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const bad = [];
  for (const m of css.matchAll(/(?:^|[;{])\s*(gap|padding(?:-\w+)?|margin(?:-\w+)?)\s*:\s*([^;}]+)/g)) {
    for (const px of m[2].match(/-?\d+px/g) || []) {
      if (![0, 8, 16, 24, 32, 48, 64].includes(Math.abs(parseInt(px, 10)))) bad.push(`${m[1]}:${m[2]}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("phone: one column, full-width button, and nothing forces the page wider than 375px", () => {
  const phone = CSS.match(/@media \(max-width:760px\)\{([\s\S]*?)\n\}/)[1];
  assert.match(phone, /\.fh-declines \.dc-step\{grid-template-columns:24px minmax\(0,1fr\)\}/);
  assert.match(phone, /\.fh-declines \.dc-btn-primary\{align-self:stretch\}/);
  const decls = CSS.replace(/@media[^{]+\{/g, "");
  for (const m of decls.matchAll(/(?:^|[;{])\s*(?:min-)?width\s*:\s*(\d+)px/g)) assert.ok(Number(m[1]) <= 64, m[0]);
  assert.match(CSS, /overflow-wrap:anywhere/, "long quotes and bank names wrap instead of pushing the page");
});

test("full: the likely reason in the letter's own words, the part a person reads, and the plan — from the real store", async () => {
  const v = await sampleView();
  const html = F.render(v);
  const t = text(html);
  assert.match(t, /Declines we are working on/);
  assert.match(t, /Chase · Ink Business Cash/);
  assert.match(t, /Fundhub is working on it/);
  assert.match(t, /Too many recent credit checks/);
  assert.match(t, /Your letter says: “Too many inquiries in the last 12 months”/);
  assert.match(t, /A Fundhub person will read this/);
  assert.match(t, /“Requested credit line exceeds our guidelines”/);
  assert.match(t, /Your steps/);
  assert.match(t, /Fundhub's steps — \d+ of \d+ done/);
  assert.match(t, /Credit checks count most for 6 months and stop counting after 12/);
  assert.equal(primaries(html), 1, "one primary action: Read my decline");
  assert.match(html, /data-act="paste">Read my decline</);
  // The Chase application now shows its decline; Amex is still waiting.
  assert.match(t, /American Express · Blue Business Plus Waiting on the bank/);
});

test("status is a word and a shape, never colour alone", async () => {
  const v = await sampleView();
  const html = F.render(v);
  assert.match(html, /class="dc-step is-done"><span class="dc-mark" aria-hidden="true">✓<\/span>[\s\S]*?<span class="dc-word">Done<\/span>/);
  assert.match(html, /class="dc-step is-open"><span class="dc-mark" aria-hidden="true">○<\/span>[\s\S]*?<span class="dc-word">Not done yet<\/span>/);
  assert.match(html, /class="dc-status is-working"><span class="dc-mark" aria-hidden="true">…<\/span>Fundhub is working on it/);
  const approved = F.renderDecline({ ...v.declines[0], outcome: "approved_on_recon", status_words: "Approved after a second look" });
  assert.match(approved, /dc-status is-yes"><span class="dc-mark" aria-hidden="true">✓<\/span>Approved after a second look/);
});

test("a client screen shows no sources, no lender book and no ops script", async () => {
  const v = await sampleView();
  const html = F.render(v);
  assert.doesNotMatch(html, /Calling DENIED|Calling PENDING|Preparing Funding Plan|SUGGESTION_CATALOGUE|lender book|Relationship Manager|bankers-rms|Source:/i);
  assert.doesNotMatch(html, /reconsideration line\. Ask about the recent application/, "the ops instruction stays with ops");
});

test("the paste box lists the client's applications that have no decline yet, plus another bank", async () => {
  const v = await sampleView();
  const box = F.renderPaste(v, "");
  assert.match(box, /<option value="c0000000-0000-4000-8000-000000000002">American Express · Blue Business Plus<\/option>/);
  assert.doesNotMatch(box, /c0000000-0000-4000-8000-000000000001/, "Chase already has its decline");
  assert.match(box, /value="__other">Another bank/);
  assert.match(box, /<label class="dc-label" for="dc-text">/);
  assert.match(box, /maxlength="20000"/);
  assert.match(text(box), /We hide long numbers, like a Social Security number, before we save it/);
});

test("empty: no applications and no declines yet — the paste box and what will show here", () => {
  const html = F.render({ eligible: true, can_paste: true, applications: [], declines: [] });
  const t = text(html);
  assert.match(t, /Got a no from a bank\?/);
  assert.match(t, /No bank applications on your file yet/);
  assert.equal(primaries(html), 1);
});

test("not a Blueprint buyer: no paste box at all, and the page says why in words", () => {
  const html = F.render({ eligible: false, can_paste: false, applications: [], declines: [] });
  assert.doesNotMatch(html, /<textarea|data-act="paste"/);
  assert.match(text(html), /Decline help comes with the Capital Blueprint/);
});

test("error: what failed in the client's words, and one way forward", () => {
  const html = F.renderError("nodb");
  assert.match(html, /role="alert"/);
  assert.match(text(html), /Our database is not answering right now/);
  assert.match(html, /data-act="retry">Try again</);
  assert.equal(primaries(html), 1);
  assert.equal(F.classify({ status: 401, body: null }), "signin");
  assert.equal(F.classify({ status: 200, body: { ok: true } }), "server", "an answer with no view is not a page");
  assert.equal(F.classify({ status: 200, body: { ok: true, view: {} } }), "ok");
});

test("loading: skeletons in the real layout, marked busy", () => {
  const html = F.renderLoading();
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /dc-skel/);
});

test("a paste problem is said in words; a duplicate says it is already here", () => {
  assert.equal(F.pasteProblem({ status: 400, body: { error: "bank_required" } }), "Tell us which bank sent it.");
  assert.match(F.pasteProblem({ status: 429, body: { error: "too_many_pastes" } }), /tomorrow/);
  assert.equal(F.pasteProblem({ status: 0, body: null }), "We could not reach the server. Check your connection and try again.");
  assert.equal(F.pasteFlash({ body: { ok: true, duplicate: true } }), "We already have this letter. Your plan is below.");
  assert.match(F.pasteFlash({ body: { ok: true, decline: { bank: "Chase" } } }), /from Chase/);
});

test("after a paste the answer sits above the declines, where the page scrolls to", async () => {
  const v = await sampleView();
  const html = F.render(v, "We read your letter from Chase. The likely reasons and your plan are below.");
  const block = html.slice(html.indexOf('id="dc-declines"'), html.indexOf('class="dc-list"'));
  assert.match(block, /<p class="dc-flash" role="status">We read your letter from Chase\./);
  assert.equal((html.match(/dc-flash/g) || []).length, 1, "said once, not twice");
  assert.match(JS, /q\("#dc-declines"\)/, "the page scrolls to the declines after a paste");
});

test("the letter's words are escaped, never run", () => {
  const html = F.renderDecline({ id: "x", bank: "<b>Bank</b>", reasons: [{ label: "L", words: "W", quote: "<script>alert(1)</script>" }], your_steps: [], fundhub_steps: [], when: [] });
  assert.doesNotMatch(html, /<script>|<b>Bank<\/b>/);
  assert.match(html, /&lt;script&gt;/);
});
