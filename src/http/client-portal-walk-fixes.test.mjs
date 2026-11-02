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
