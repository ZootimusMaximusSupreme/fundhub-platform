// money-whop-plans.js — the Whop plans part of Payments and the provider logos, run in Node
// against payloads the real back end builds (src/http/fixtures/whop-plans.sample.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { sampleWhopPayload, sampleWhopRows, samplePhoneSummary, SAMPLE_WHOP_IDS } from "../http/fixtures/whop-plans.sample.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const JS = fs.readFileSync(path.join(ROOT, "public/app/money-whop-plans.js"), "utf8");
const CSS = fs.readFileSync(path.join(ROOT, "public/app/money-whop-plans.css"), "utf8");
const TODAY = "2026-11-07";

function load() {
  const sandbox = { window: {} };
  vm.runInNewContext(JS, sandbox);
  return sandbox.window.FHWhopPlans;
}
const W = load();
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const card = (html, id) => {
  const at = html.indexOf(`data-whop-plan="${id}"`);
  assert.ok(at > 0, `no card for ${id}`);
  const end = html.indexOf("</article>", at);
  return html.slice(at, end);
};

test("nothing is painted for an older server or a client with no Whop plans", () => {
  assert.equal(W.renderSection({ ok: true, plans: [] }), "");
  assert.equal(W.renderSection(sampleWhopPayload(TODAY, { rows: [] })), "");
  assert.equal(W.renderSection(null), "");
});

test("a Whop read that failed says so in one line, and claims no plan", () => {
  const html = W.renderSection({ ok: true, whop: null });
  assert.match(text(html), /Whop plans could not load\. Try again later\./);
  assert.doesNotMatch(html, /data-whop-plan/);
});

test("full: one card per plan, in the Clarity card look, with Whop's own logo", () => {
  const d = sampleWhopPayload(TODAY);
  const html = W.renderSection(d);
  assert.equal((html.match(/<article class="card plan whop-plan"/g) || []).length, 5);
  assert.match(html, /<img class="fh-provider-logo" src="\/assets\/merchant-whop\.svg" alt="Whop" width="39" height="20"/);
  assert.match(text(html), /^Whop plans Updated Nov 7/);
  for (const cls of ["plan-head", "plan-name", "facts", "caption"]) assert.match(html, new RegExp(`class="${cls}"`));

  const monthly = text(card(html, SAMPLE_WHOP_IDS.monthly));
  assert.match(monthly, /Sample Monthly Program Monthly Due soon/);
  assert.match(monthly, /Next payment \$500\.00 Charges on Nov 9 How often Monthly/);
  assert.match(monthly, /Phone alert Goes today\./);
  assert.doesNotMatch(monthly, /3 days before|Phone alert Phone alert/);

  const split = text(card(html, SAMPLE_WHOP_IDS.split));
  assert.match(split, /Sample Split Pay Plan Monthly · 6 payments Active/);
  assert.match(split, /Left to pay \(estimate\) \$1,000\.00 Paid 2 of 6 Next payment \$250\.00 on Nov 19/);
  assert.match(split, /Phone alert Goes Nov 16 ?, 3 days before\./); // text() turns the date's span into a space
  // The words are one flex item, so the date sits right against its comma.
  assert.match(card(html, SAMPLE_WHOP_IDS.split), /<span class="phone-text">Goes <span class="nowrap">Nov 16<\/span>, 3 days before\.<\/span>/);
  assert.match(card(html, SAMPLE_WHOP_IDS.split), /aria-label="2 of 6 payments made"/);

  const late = card(html, SAMPLE_WHOP_IDS.late);
  assert.match(late, /<span class="late">Late<\/span>/);
  assert.match(text(late), /Each payment \$99\.00 How often Monthly Next payment Late/);
  assert.match(text(late), /Phone alert None while it is late\./);

  const ending = text(card(html, SAMPLE_WHOP_IDS.ending));
  assert.match(ending, /Ends Nov 27 Ends Nov 27 Each payment \$49\.00 Next payment None/);
  assert.doesNotMatch(ending, /Phone alert/);

  const trial = text(card(html, SAMPLE_WHOP_IDS.trial));
  assert.match(trial, /Sample Community Weekly Free trial/);
  assert.match(trial, /Next payment \$49\.00 Charges on Nov 16/);
});

test("the phone line follows the client's own switches, with a way to fix it", () => {
  const off = W.renderSection(sampleWhopPayload(TODAY, { summary: samplePhoneSummary({ enabled: false }) }));
  assert.match(text(card(off, SAMPLE_WHOP_IDS.monthly)), /Phone alert Off\. Turn them on/);
  assert.match(off, /<a class="btn-text" href="\/app\/financeos\.html#alerts">Turn them on<\/a>/);
  const stop = W.renderSection(sampleWhopPayload(TODAY, { summary: samplePhoneSummary({ opted_out: true }) }));
  assert.match(text(card(stop, SAMPLE_WHOP_IDS.monthly)), /Phone alert Off\. You replied STOP\./);
  const nophone = W.renderSection(sampleWhopPayload(TODAY, { summary: samplePhoneSummary({ has_phone: false }) }));
  assert.match(nophone, /href="\/app\/client-portal\.html#push-card">Set up my phone<\/a>/);
  assert.match(text(card(nophone, SAMPLE_WHOP_IDS.monthly)), /Phone alert No phone set up yet\. Set up my phone/);
  const sent = W.renderSection(sampleWhopPayload(TODAY, { summary: samplePhoneSummary({
    sent: [{ subject_id: SAMPLE_WHOP_IDS.monthly, about_on: "2026-11-09", state: "sent" }] }) }));
  assert.match(text(card(sent, SAMPLE_WHOP_IDS.monthly)), /Phone alert Sent for Nov 9 ?\./);
  assert.match(sent, /Sent for <span class="nowrap">Nov 9<\/span>\./);
});

test("staff see how each plan was tied to the client, and get no client links", () => {
  const d = sampleWhopPayload(TODAY, { summary: samplePhoneSummary({ has_phone: false }) });
  const html = W.renderSection(d, { staff: true });
  assert.match(text(card(html, SAMPLE_WHOP_IDS.monthly)), /Monthly · Tied by Fundhub checkout/);
  assert.match(text(card(html, SAMPLE_WHOP_IDS.split)), /Tied by email/);
  assert.match(text(card(html, SAMPLE_WHOP_IDS.monthly)), /Phone alert No phone set up yet\./);
  const stop = W.renderSection(sampleWhopPayload(TODAY, { summary: samplePhoneSummary({ opted_out: true }) }), { staff: true });
  assert.match(text(card(stop, SAMPLE_WHOP_IDS.monthly)), /Phone alert Off\. This client replied STOP\./);
  assert.doesNotMatch(html, /Set up my phone|Turn them on/);
  assert.doesNotMatch(W.renderSection(d), /Tied by/);
});

test("the ClarityPay logo only on a plan that records ClarityPay as its provider; every other plan keeps its name only (Codex CX21)", () => {
  const LOGO = '<div class="plan-brand"><img class="fh-provider-logo" src="/assets/lenders/claritypay.svg" alt="ClarityPay" width="106" height="20" decoding="async"></div>';
  // The plan says who it is paid to in owed_to; that is the only provider record a plan has.
  assert.equal(W.providerLogo({ kind: "clarity", owed_to: "ClarityPay" }), LOGO);
  assert.equal(W.providerLogo({ kind: "clarity", owed_to: "Clarity Pay, Inc." }), LOGO);
  assert.equal(W.providerLogo({ kind: "bnpl", owed_to: "claritypay" }), LOGO, "the provider decides, not the kind");
  // kind "clarity" is Fundhub's own word for a payment plan: it does not prove ClarityPay.
  assert.equal(W.providerLogo({ kind: "clarity" }), "");
  assert.equal(W.providerLogo({ kind: "clarity", owed_to: "Fundhub LLC" }), "");
  assert.equal(W.providerLogo({ kind: "clarity", owed_to: "Clarity Payments LLC" }), "", "Clarity Payments is not ClarityPay");
  assert.equal(W.providerLogo({ kind: "bnpl", owed_to: "Fundhub LLC" }), "");
  assert.equal(W.providerLogo({ kind: "other" }), "");
  assert.equal(W.providerLogo(null), "");
});

test("the owed tile note adds only split-pay money left, and nothing when there is none", () => {
  assert.equal(W.owedNote(sampleWhopPayload(TODAY)), " · +$1,000.00 on Whop");
  const rows = sampleWhopRows(TODAY).filter((r) => r.split_pay_required === null);
  assert.equal(W.owedNote(sampleWhopPayload(TODAY, { rows })), "");
  assert.equal(W.owedNote({}), "");
});

test("names are escaped and unknown money paints a dash, never $0.00", () => {
  const rows = [{ ...sampleWhopRows(TODAY)[2], product_title: "<img src=x onerror=alert(1)>", renewal_cents: null }];
  const html = W.renderSection(sampleWhopPayload(TODAY, { rows }));
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(text(html), /Each payment — /);
  assert.equal(W.money(null), "—");
  assert.equal(W.money(123456), "$1,234.56");
});

test("the logos are the companies' own files, and the ClarityPay source is written on it", () => {
  const cp = fs.readFileSync(path.join(ROOT, "public/assets/lenders/claritypay.svg"));
  const firstLine = cp.toString("utf8").split("\n")[0];
  assert.match(firstLine, /^<!-- ClarityPay logo\. Official file from ClarityPay's own website, https:\/\/www\.claritypay\.com\//);
  assert.match(firstLine, /68ac8a94c86b5df6de3d26f7_Layer_1\.svg/);
  const body = cp.subarray(Buffer.byteLength(firstLine + "\n", "utf8"));
  assert.equal(crypto.createHash("sha256").update(body).digest("hex"), "966ac04ef8c28e8ea9d07f7a33077bb7b7c6fb9db0566ffc50ea14ec0bbd39de");
  assert.doesNotMatch(cp.toString("utf8"), /<script|onload=|onclick=|foreignObject|<image|href=/i);
  assert.ok(fs.existsSync(path.join(ROOT, "public/assets/merchant-whop.svg")));
});

test("the stylesheet stays inside the Payments section, uses no px font sizes, and keeps 44px links", () => {
  const rules = CSS.replace(/\/\*[\s\S]*?\*\//g, "").split("}").map((r) => r.trim()).filter(Boolean);
  assert.ok(rules.length > 3);
  for (const r of rules) assert.match(r.split("{")[0], /^\.fh-payments /, r);
  assert.doesNotMatch(CSS, /font-size:\s*\d+px/);
  assert.match(CSS, /\.whop-plan \.phone-line \.btn-text\{[^}]*min-height:44px[^}]*min-width:44px/);
});
