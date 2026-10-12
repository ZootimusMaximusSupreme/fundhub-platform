import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const presentJs = fs.readFileSync(path.join(APP, "present.js"), "utf8");
const presentHtml = fs.readFileSync(path.join(APP, "present.html"), "utf8");
const closerHtml = fs.readFileSync(path.join(APP, "closer-dashboard.html"), "utf8");
const closerJs = fs.readFileSync(path.join(APP, "closer-call.js"), "utf8");

test("present.html is a fullscreen deck, not a sidebar screen", () => {
  assert.ok(presentHtml.includes('src="present.js"'));
  assert.ok(!presentHtml.includes('src="shell.js"'), "loading shell.js would force a sidebar row");
  assert.ok(presentHtml.includes("fundhub-brand.css"));
});

test("screen prices come from the offers catalog, not hardcoded dollars", () => {
  for (const key of ["SOFT_PULL", "FUNDING_DFY", "REPAIR_DFY", "REPAIR_TRIAL", "UWIQ_DELIVERABLES", "FUNDING_MASTERY"]) {
    assert.ok(presentJs.includes('price("' + key + '")'), "missing price(" + key + ")");
  }
  assert.ok(!/TRIAL_PRICE\s*=\s*200/.test(presentJs));
  assert.ok(!/PAYLOADS\s*=/.test(presentJs));
  assert.ok(!/Marcus Webb/.test(presentJs));
});

test("letters action is absent on the qualified funding route", () => {
  assert.ok(presentJs.includes("function lettersOk"));
  assert.ok(presentJs.includes("o.letters"));
  assert.ok(presentJs.includes("letters_blocked") || presentJs.includes("generate_letters"));
});

test("Closer Dashboard Send fills company, days, and email blanks", () => {
  assert.ok(closerJs.includes("fillBlankInputs"));
  assert.ok(closerJs.includes("defaultBlankValues"));
  assert.ok(closerJs.includes("template_key"));
});

test("Closer Dashboard has a Present control that deep-links the contact", () => {
  assert.ok(closerHtml.includes('id="fh-present"'));
  assert.ok(closerHtml.includes("Present"));
  assert.ok(closerJs.includes("present.html?contact="));
});

test("send contract lives on Closer Dashboard and Present, not the wording page", () => {
  assert.ok(closerHtml.includes('id="fh-send-contract"'));
  assert.ok(closerHtml.includes("contract-send.js"));
  assert.ok(closerJs.includes("FHContractSend"));
  assert.ok(presentHtml.includes("contract-send.js"));
  assert.ok(presentJs.includes("Send contract"));
  assert.ok(presentJs.includes("FHContractSend"));
  assert.ok(presentJs.includes("sendToClient"));
});

test("present cockpit can send soft pull and has no retired e-book control", () => {
  assert.ok(presentJs.includes("send_soft_pull"));
  assert.ok(presentJs.includes("Send soft pull"));
  assert.ok(!presentJs.includes("send_ebook"));
  assert.ok(!presentJs.includes("ebookDollars"));
  assert.ok(!presentJs.includes("fh-ebook"));
  assert.ok(!presentJs.includes("No-pay downsell"));
});

test("disposition UI has an explicit repair-referral control", () => {
  assert.ok(presentJs.includes('id="fh-repair-referral"'));
  assert.ok(presentJs.includes("repair_referral"));
  assert.ok(closerJs.includes('id="fh-repair-referral"'));
  assert.ok(closerJs.includes("repair_referral"));
});

test("non-primary pay links still require an explicit downsell or upsell choice", () => {
  assert.ok(presentJs.includes('id="fh-sale-motion"'));
  assert.ok(presentJs.includes('value="downsell"'));
  assert.ok(presentJs.includes('value="upsell"'));
  assert.ok(presentJs.includes("isPrimaryPayOffer"));
  assert.match(
    presentJs,
    /key === "FUNDING_DFY" \|\| key === "REPAIR_DFY" \|\| key === "REPAIR_TRIAL" \|\| key === "FUNDING_MASTERY"/
  );
  assert.ok(presentJs.includes("sale_motion: action === \"send_pay_link\" ? selectedSaleMotion() : null"));
  assert.doesNotMatch(
    presentJs,
    /selectedOfferKey\(\)\s*===\s*"FUNDING_DFY"\s*\?\s*null\s*:\s*"downsell"/,
    "motion must not be derived from the selected product"
  );
});

/* WHAT THIS BUTTON DOES CHANGED, AND THE TEST WAS LEFT BEHIND.
   S-23 originally MINTED A PAYMENT LINK here: POST /api/payment-links with
   purpose "invoice". public/app/present.js now reads the client's existing
   invoices and emails the open one instead, and refuses with "No invoice on
   this file yet" when there is none — it creates nothing.

   THE MONEY BUTTON DID NOT GO ANYWHERE. "pay" still fires send_pay_link, and
   the test below this one pins that. So the deck kept its way of taking money
   and gained a separate way of chasing money already invoiced. Emailing an
   existing invoice cannot open a second payment path for a sum already billed,
   which is the direction this repo leans on everywhere else.

   Pinned here: the button exists, it is wired, it emails rather than mints, and
   it can only act on an invoice that is already on the file. */
test("S-23 has Invoice this client, and it emails the open invoice", () => {
  assert.ok(presentJs.includes("Invoice this client"));
  assert.ok(presentJs.includes("invoiceThisClient"));
  assert.ok(presentJs.includes('action: "email_invoice"'),
    "the button must email the existing invoice");
  assert.ok(presentJs.includes("No invoice on this file yet"),
    "with nothing on the file it must refuse, not create one");
  assert.ok(!presentJs.includes('purpose: "invoice"'),
    "it must not mint a second payment link for money already invoiced");
});

test("S-23 pay click always POSTs send_pay_link", () => {
  /* The third argument is the button's own key, so the control can show that it
     is sending and refuse a second press (F24). The action itself is unchanged
     and is still never gated behind picking a sale motion. */
  assert.match(
    presentJs,
    /if \(a === "pay"\) \{\s*fire\("send_pay_link", null, "pay"\); return; \}/
  );
  assert.doesNotMatch(
    presentJs,
    /Choose downsell or upsell first/
  );
});

/* F24 — the send button gave no feedback, so it was pressed three and four
   times and the client got three and four texts, emails and pay links. Two
   pay-link emails on 2026-09-03 carried two DIFFERENT live checkout links. */
test("every send control shows it was pressed, locks, and keeps the sent time", () => {
  assert.ok(presentJs.includes("function sendBtn("), "no shared send control");
  assert.ok(presentJs.includes("SEND_COOLDOWN_MS"), "no cooldown after a success");
  assert.ok(presentJs.includes('"Sending…"'), "no pressed state while in flight");
  assert.ok(presentJs.includes("Sent at "), "the sent time must stay on the button");
  assert.ok(presentJs.includes("if (sendLocked(a)) return;"),
    "a locked control must refuse the click, not just look disabled");
  for (const act of ["pay", "contract", "letters", "softpull", "invoice", "send-letters"]) {
    assert.ok(
      presentJs.includes('sendBtn("') && presentJs.includes('"' + act + '"'),
      act + " has no send-control state"
    );
  }
});

/* F27, owner-set: contract send is ONE CLICK, no typing. */
test("the contract wording form is gone from the deck", () => {
  assert.ok(!presentJs.includes("Wording for this client"), "the wording panel is still there");
  assert.ok(!presentJs.includes("manual_fields"), "the template's manual fields are still rendered");
  assert.ok(!presentJs.includes('id="fh-contract-tpl"'), "the wording picker is still there");
  assert.ok(!presentJs.includes("data-blank"), "staff can still type contract blanks");
  assert.ok(!presentJs.includes("contract-go"), "there is still a second send step");
  assert.ok(!presentJs.includes("Send this wording"), "the wording send button survived");
  assert.match(presentJs, /if \(a === "contract"\) \{ sendContractNow\(\); return; \}/,
    "Send contract must send, not open a form");
});

/* F23 — the wrap script promised a funding advisor, submitted applications and
   "we're going to get you funded" on a $5,000 EDUCATION sale. */
test("the close script follows the offer, and education promises no funding", () => {
  assert.ok(presentJs.includes("var CLOSE_TALK"), "section 07 copy is not keyed to the offer");
  for (const key of ["FUNDING_DFY", "REPAIR_DFY", "REPAIR_TRIAL", "UWIQ_DELIVERABLES", "FUNDING_MASTERY"]) {
    assert.match(presentJs, new RegExp(key + ":\\s*\\{"), "no close script for " + key);
  }
  const eduWrap = presentJs.slice(presentJs.indexOf("FUNDING_MASTERY: {"), presentJs.indexOf("var OBJECTIONS"));
  assert.ok(!/get you funded/i.test(eduWrap), "the education wrap promises funding");
  assert.ok(!/applications are submitted/i.test(eduWrap), "the education wrap promises applications");
  assert.ok(!/your advisor reaches out/i.test(eduWrap), "the education wrap promises an advisor");
});

/* Hole 16 — a file with more than one company was priced off a business age
   nobody ever asked for. Present now asks for the month and year. */
test("Present asks for the incorporation month and year", () => {
  assert.ok(presentJs.includes("function incorporationAsk"), "no incorporation ask in the cockpit");
  assert.ok(presentJs.includes("When was each business incorporated?"));
  assert.ok(/type="month"/.test(presentJs), "the ask has no month/year input");
  assert.ok(presentJs.includes("Save month / year"));
  assert.ok(presentJs.includes("stamp-inc:"), "no save button action");
});

test("the ask sits on discovery, inside slides 1 to 12", () => {
  const discovery = presentJs.indexOf('if (ph === "02 Discovery")');
  assert.ok(discovery > -1);
  const softPull = presentJs.indexOf('if (ph === "03 Soft pull"');
  assert.ok(presentJs.indexOf("incorporationAsk()", discovery) > discovery);
  assert.ok(presentJs.indexOf("incorporationAsk()", discovery) < softPull,
    "the ask must render during discovery, not after the pull");
});

test("Present saves the date through the same staff action as the Control Panel", () => {
  assert.ok(presentJs.includes("stamp_incorporated"));
  assert.ok(presentJs.includes('window.FHData.write("/api/soft-pull-approve"'));
  assert.ok(presentJs.includes("business_name"));
  assert.ok(presentJs.includes("incorporated_date"));
});

test("Present never guesses a date and never hides a missing one", () => {
  assert.ok(presentJs.includes("function businessesNeedingDate"));
  assert.ok(presentJs.includes("Do not take a guess."));
  assert.ok(presentJs.includes("When was it incorporated?"),
    "the client slide must show the missing date as a question, not a blank");
  assert.ok(/\^\\d\{4\}-\\d\{2\}\$/.test(presentJs), "no month/year format check before saving");
});

test("the client slide lists every company on the file, not just one", () => {
  const s03 = presentJs.indexOf('if (c === "S-03")');
  assert.ok(s03 > -1);
  const s04 = presentJs.indexOf('if (c === "S-04")');
  assert.ok(presentJs.indexOf("businesses().map", s03) > s03);
  assert.ok(presentJs.indexOf("businesses().map", s03) < s04);
});
