// SCREENS SAY WHAT THE SYSTEM DOES — walkthrough-4 (2026-09-06) defects
// 3, 6, 12, 13, 15, 17 and 27. Each was a sentence or a colour on a live screen
// that told the reader something the code does not do. Each test pins the
// false sentence out and the true one in.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

test("defect 3: affiliate terms no longer say the success fee earns nothing", () => {
  const html = read("public/app/affiliate.html");
  assert.ok(!html.includes("The 10% success fee is not a qualifying product"));
  assert.ok(!html.includes("Funding pays on deposit collected once funded"));
  assert.match(html, /the deposit and the 10% success fee/);
  // The rule the sentence describes (W0 decision, migration 272).
  assert.match(read("db/migrations/272_affiliate_success_fee_share_20260831.sql"), /partner_share_of_cash/);
});

test("defect 13: affiliate terms say first touch, no 60-day last-touch window", () => {
  const html = read("public/app/affiliate.html");
  assert.ok(!/Last-touch/i.test(html.replace(/<!--[\s\S]*?-->/g, "")), "a visible last-touch promise is back");
  assert.ok(!/60 days from first click/.test(html));
  assert.match(html, /<dt>Attribution<\/dt><dd>First touch\./);
});

test("defect 6: Brand Studio never says SSL was issued", () => {
  const html = read("public/app/brand-studio.html");
  assert.ok(!html.includes("SSL is issued automatically"));
  assert.ok(!html.includes("Verified · SSL issued"));
  assert.ok(!/D\.verified \? "Live"/.test(html), "the domain tile calls a TXT check Live again");
  assert.match(html, /DNS verified · SSL not issued here/);
});

test("defect 12: Social Studio paints failed and expired coral, like every other screen", () => {
  const html = read("public/app/social-studio.html");
  assert.match(html, /failed:'b-alert'/);
  assert.match(html, /expired:'b-alert'/);
  assert.match(html, /<span class="badge b-alert">Could not be sent<\/span>/);
  assert.ok(!/failed:'b-warn'|expired:'b-warn'/.test(html));
});

test("defect 15: the Journeys simulator never claims it sent anything", () => {
  // The fix's own comment quotes the old words; only shipped strings count.
  const html = read("public/app/journeys.html").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const gone of ["Everything goes to the two destinations", "Everything went to", "Texts go to", "Emails go to", "<span>Messages sent</span>"]) {
    assert.ok(!html.includes(gone), `"${gone}" is back`);
  }
  assert.match(html, /Test mode — nothing is sent\./);
  assert.match(html, /Messages drafted \(not sent\)/);
});

test("defect 17: the signing page does not promise the link works forever", () => {
  const html = read("public/contract.html");
  assert.ok(!html.includes("read it again at any time"));
  assert.match(html, /stops working 30 days after it was sent/);
  // The 30 days is the real default.
  assert.match(read("src/contracts/signed-link.mjs"), /DEFAULT_TTL_SECONDS = 60 \* 60 \* 24 \* 30/);
  // A failed download says so instead of doing nothing.
  assert.match(html, /Download failed — try again/);
});

test("defect 27: Campaign Manager names the badge, not a colour", () => {
  const html = read("public/app/campaign-manager.html");
  assert.ok(!/Green means/i.test(html));
  assert.match(html, /A row marked <b>ok<\/b> means our own copy looks fine/);
});
