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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORTAL = path.resolve(HERE, "../../public/app/client-portal.html");
const html = fs.readFileSync(PORTAL, "utf8");

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

  test("F36 — one empty row in the Messages tab, not two", () => {
    // ONE static empty row in the pane, never a second.
    assert.equal((html.match(/id="msg-empty"/g) || []).length, 1, "there must be exactly one static empty row");
    assert.ok(!html.includes('id="msg-live-empty"'), "the duplicate row must be gone");
    /* Walkthrough-4 defect 18: the static row no longer says "No messages
       yet." — a client is never given a messages read, so that sentence stood
       forever. Only paintMessages() (the staff read, which really answered)
       may say it. Rendered rows only — comments name the sentence too. */
    const empties = html.match(/>No messages yet\.</g) || [];
    assert.equal(empties.length, 1, "only paintMessages' replacement markup may say No messages yet.");
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
