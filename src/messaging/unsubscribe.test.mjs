// Unsubscribe links — the token, and the footer that carries it.
//
// COMPLIANCE-BEARING. Until 2026-08-18 this repo had 173 email templates whose
// copy promised the reader they could unsubscribe, zero links to do it with,
// and a /unsubscribe page that answered 404 (measured live). These tests are
// what stops that coming back.

import { test } from "node:test";
import assert from "node:assert";
import {
  signUnsubscribeUrl, verifyUnsubscribeToken, verifyUnsubscribeRequest,
  withUnsubscribeFooter, unsubscribeSecret,
  UNSUBSCRIBE_MAX_TTL_SECONDS, UNSUBSCRIBE_LINK_SOURCE,
  formatRepPhone, emailRepPhone, EMAIL_SIGNER_NAME, EMAIL_SIGNER_TITLE,
  EMAIL_TAGLINE, EMAIL_WORDMARK, EMAIL_LOGO_PATH, EMAIL_SIGNATURE_PATH
} from "./unsubscribe.mjs";

const SECRET = "unit-test-secret-0123456789abcdef0123456789abcdef";
const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const NOW = () => Date.parse("2026-08-18T12:00:00Z");

const mint = (over = {}) =>
  signUnsubscribeUrl({ orgId: ORG, clientId: CLIENT, secret: SECRET, now: NOW, ...over });

const parse = (url) => Object.fromEntries(new URL(url, "http://x.invalid").searchParams);

test("the link carries everything the endpoint needs and nothing it does not", () => {
  const { url, path } = mint({ baseUrl: "https://fundhub.ai" });
  const q = parse(url);
  assert.equal(q.org, ORG);
  assert.equal(q.client, CLIENT);
  assert.equal(q.channel, "email");
  assert.match(q.sig, /^[0-9a-f]{64}$/, "sha256 hex");
  assert.ok(Number(q.exp) > 0);
  assert.ok(url.startsWith("https://fundhub.ai/unsubscribe.html?"), url);
  assert.ok(path.startsWith("/unsubscribe.html?"));
  // The client's actual address is never in the link — only their id. A URL
  // that carried the address would leak it into logs, referrers and history.
  assert.ok(!url.includes("@"), "no email address in the URL");
});

test("the page is at the site root, not under /app — a person unsubscribing has no session", () => {
  // Everything under public/app/ loads shell.js, which demands a session and
  // bounces anybody without one.
  assert.ok(!mint().path.startsWith("/app/"), "must not be behind the signed-in shell");
});

test("a freshly minted link verifies", () => {
  const t = verifyUnsubscribeToken({ ...parse(mint().url), orgId: ORG, clientId: CLIENT, secret: SECRET, now: NOW });
  assert.ok(t);
  assert.equal(t.clientId, CLIENT);
  assert.equal(t.channel, "email");
});

test("verifyUnsubscribeRequest reads a whole URL or a query object", () => {
  const { url } = mint();
  assert.ok(verifyUnsubscribeRequest(url, { secret: SECRET, now: NOW }), "from a url");
  assert.ok(verifyUnsubscribeRequest(parse(url), { secret: SECRET, now: NOW }), "from a query object");
});

test("a tampered client id does not verify — you cannot unsubscribe somebody else", () => {
  const q = parse(mint().url);
  q.client = "33333333-3333-4333-8333-333333333333";
  assert.equal(verifyUnsubscribeRequest(q, { secret: SECRET, now: NOW }), null);
});

test("the CHANNEL is signed, so the link cannot be widened by hand", () => {
  /* Editing channel=email to channel=sms in the address bar would otherwise
     silence the client's texts too — a channel they never asked us to stop. */
  const q = parse(mint().url);
  q.channel = "sms";
  assert.equal(verifyUnsubscribeRequest(q, { secret: SECRET, now: NOW }), null);
});

test("a different secret does not verify", () => {
  const q = parse(mint().url);
  assert.equal(verifyUnsubscribeRequest(q, { secret: "another-secret-0123456789abcdef0123456789ab", now: NOW }), null);
});

test("a link that has run out does not verify", () => {
  const q = parse(mint({ ttlSeconds: 60 }).url);
  const later = () => NOW() + 61_000;
  assert.equal(verifyUnsubscribeRequest(q, { secret: SECRET, now: later }), null);
});

test("the link outlives the CAN-SPAM 30-day floor by a wide margin", () => {
  // The obligation is that the opt-out mechanism still works 30 days after the
  // message went out. An unsubscribe link sits in an archived mailbox far
  // longer than that, and a dead one is the defect this file exists to fix.
  const q = parse(mint().url);
  const thirtyOneDays = () => NOW() + 31 * 24 * 60 * 60 * 1000;
  assert.ok(verifyUnsubscribeRequest(q, { secret: SECRET, now: thirtyOneDays }),
    "must still work well past 30 days");
});

test("a missing or junk field is refused rather than throwing", () => {
  for (const bad of [undefined, null, {}, { org: ORG }, "not a url at all", { org: ORG, client: CLIENT, channel: "email", exp: "abc", sig: "x" }]) {
    assert.doesNotThrow(() => verifyUnsubscribeRequest(bad, { secret: SECRET, now: NOW }));
    assert.equal(verifyUnsubscribeRequest(bad, { secret: SECRET, now: NOW }), null);
  }
});

test("signing fails closed with no secret, and refuses a silly TTL", () => {
  assert.throws(() => unsubscribeSecret({}), /UNSUBSCRIBE_TOKEN_SECRET/);
  assert.throws(() => unsubscribeSecret({ UNSUBSCRIBE_TOKEN_SECRET: "short" }), /too short/);
  assert.doesNotThrow(() => unsubscribeSecret({ DOCUMENT_URL_SECRET: SECRET }), "falls back like contract links do");
  assert.throws(() => mint({ ttlSeconds: UNSUBSCRIBE_MAX_TTL_SECONDS + 1 }), /maximum/);
  assert.throws(() => signUnsubscribeUrl({ clientId: CLIENT, secret: SECRET }), /requires orgId/);
});

test("a soft-pull consent link can never be replayed as an unsubscribe link", () => {
  /* Domain separation. The two mean opposite things — one grants permission to
     pull a credit file, the other withdraws permission to email — and they are
     signed with the same secret by default, so only the scheme keeps them
     apart. */
  const q = parse(mint().url);
  const asSoftPull = { org: q.org, client: q.client, exp: q.exp, sig: q.sig, channel: "email" };
  // Same fields, different scheme inside the HMAC: the unsubscribe verifier is
  // the only thing that accepts this signature.
  assert.ok(verifyUnsubscribeRequest(asSoftPull, { secret: SECRET, now: NOW }));
  const forged = { ...q, sig: q.sig.replace(/^./, (c) => (c === "a" ? "b" : "a")) };
  assert.equal(verifyUnsubscribeRequest(forged, { secret: SECRET, now: NOW }), null);
});

/* ── the footer ──────────────────────────────────────────────────────────── */

test("a plain-text body becomes a branded HTML email with Chris footer + quiet Unsubscribe", () => {
  const out = withUnsubscribeFooter(
    "Hello there.",
    "https://fundhub.ai/unsubscribe.html?x=1",
    { FUNDHUB_REP_NUMBER: "+15613048368", APP_BASE_URL: "https://fundhub.ai" }
  );
  assert.ok(out.includes("Hello there."), "the approved copy is still present");
  assert.ok(/<!DOCTYPE html|<html/i.test(out), "plain copy is wrapped so Resend sends HTML");
  assert.ok(out.includes('Unsubscribe</a>'), "the control is a labeled link");
  assert.ok(out.includes("padding:5px 12px"), "Unsubscribe is a quiet outlined pill, not a black brick");
  assert.ok(out.includes("border:1px solid #d1d5db"), "outlined control, not a filled black button");
  assert.ok(!out.includes("background:#111827"), "no giant black Unsubscribe brick");
  assert.ok(!/text-transform:uppercase/i.test(out), "title stays sentence case — not ALL CAPS");
  assert.ok(!/Georgia|'Times New Roman'/i.test(out), "Chris is normal weight sans, not giant serif");
  assert.ok(out.includes("font:400 14px/1.3 'Inter'"), "Chris uses brand Inter sans");
  assert.ok(out.includes("fonts.googleapis.com/css2?family=Inter"), "shell loads Inter for email clients");
  assert.ok(out.includes("Funding Intelligence for Entrepreneurs"), "tagline rides with the footer");
  assert.ok(out.includes(EMAIL_TAGLINE), "tagline uses Fundhub.ai brand casing");
  assert.ok(!out.includes("FundHub"), "never the wrong brand casing");
  assert.ok(out.includes(EMAIL_SIGNER_NAME), "signed by Chris");
  assert.ok(out.includes(EMAIL_SIGNER_TITLE), "executive title with Fundhub.ai");
  assert.ok(EMAIL_SIGNER_TITLE.includes("Fundhub.ai"), "title uses Fundhub.ai, not FundHub");
  assert.ok(!/client care|customer service|support/i.test(out), "no support-desk framing");
  assert.ok(out.includes("(561) 304-8368"), "Fundhub number is visible");
  assert.ok(out.includes("Fundhub.ai"), "brand includes .ai — not a bare fundhub. logo");
  assert.ok(EMAIL_WORDMARK === "fundhub.ai", "wordmark casing is fundhub.ai");
  assert.ok(out.includes(EMAIL_SIGNATURE_PATH), "handwritten signature is in the footer");
  assert.match(
    out,
    new RegExp(`${EMAIL_SIGNATURE_PATH.replace(/\./g, "\\.")}[\\s\\S]*?${EMAIL_SIGNER_NAME}`),
    "signature leads the personal block"
  );
  assert.ok(out.includes(EMAIL_LOGO_PATH), "Fundhub logo sits in the footer");
  assert.ok(!/\nUnsubscribe: https:\/\//.test(out), "no raw URL dump under the copy");
});

test("an HTML body gets the professional footer injected before </body>", () => {
  const body = "<html><body><p>Hello</p></body></html>";
  const out = withUnsubscribeFooter(
    body,
    "https://fundhub.ai/unsubscribe.html?x=1",
    { FUNDHUB_REP_NUMBER: "+15613048368", APP_BASE_URL: "https://fundhub.ai" }
  );
  assert.ok(out.includes('<a href="https://fundhub.ai/unsubscribe.html?x=1"'));
  assert.ok(out.includes("Unsubscribe</a>"));
  assert.ok(out.includes("padding:5px 12px"));
  assert.ok(out.includes("<p>Hello</p>"), "the approved copy is still present");
  assert.ok(out.includes(EMAIL_SIGNER_NAME));
  assert.ok(out.includes(EMAIL_SIGNATURE_PATH));
  assert.ok(out.includes(EMAIL_SIGNER_TITLE));
});

test("formatRepPhone turns E.164 into a readable US number", () => {
  assert.equal(formatRepPhone("+15613048368"), "(561) 304-8368");
  assert.equal(emailRepPhone({ FUNDHUB_REP_NUMBER: "+15613048368" }), "(561) 304-8368");
});

test("a body that already carries the link is left alone", () => {
  const url = "https://fundhub.ai/unsubscribe.html?x=1";
  const body = `Hi. Unsubscribe: ${url}`;
  assert.equal(withUnsubscribeFooter(body, url), body, "no second footer");
});

test("no link, no footer — the body is returned untouched", () => {
  assert.equal(withUnsubscribeFooter("Hello.", null), "Hello.");
  assert.equal(withUnsubscribeFooter("Hello.", ""), "Hello.");
});

test("the footer says what it does in plain words", () => {
  const out = withUnsubscribeFooter("Hi.", "https://fundhub.ai/unsubscribe.html?x=1");
  assert.match(out, /unsubscribe/i, "the reader has to be able to see what the link is for");
});

test("the link source is recorded apart from a STOP reply and a provider signal", () => {
  // Three different things happened and an operator has to be able to tell
  // which: they pressed the link, they replied STOP, or Mailgun told us.
  assert.equal(UNSUBSCRIBE_LINK_SOURCE, "unsubscribe_link");
  assert.notEqual(UNSUBSCRIBE_LINK_SOURCE, "inbound_keyword");
  assert.notEqual(UNSUBSCRIBE_LINK_SOURCE, "provider_unsubscribe");
});

/* ── F18: the signature must not sit on the template's own background ──────
   Reported on the 2026-09-03 walk: the wordmark and the handwritten "Chris"
   showed as white rectangles in the soft-pull email and rendered cleanly in
   the e-book email. Both carry this same footer. The soft-pull body is HTML
   with a #F4F4F5 page ground, the e-book body is plain text — so the footer
   landed on grey in one case and inside the shell's white card in the other.
   These pin the fix: the footer brings its own white ground when it is
   appended to a template that already has a document of its own. */

/* Trimmed from the real 2026-09-03 soft-pull row (2816 chars): the parts that
   matter are the doctype, the grey page ground and the template's own card. */
const HTML_TEMPLATE_BODY =
  `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"></head>` +
  `<body style="margin:0;padding:0;background-color:#F4F4F5;">` +
  `<table role="presentation" width="100%" style="background-color:#F4F4F5;">` +
  `<tr><td align="center" style="padding:24px 12px;">` +
  `<table role="presentation" width="100%" style="max-width:600px;background-color:#FFFFFF;">` +
  `<tr><td style="padding:28px;">Two clear numbered steps.</td></tr>` +
  `</table></td></tr></table></body></html>`;

const UNSUB = "https://fundhub.ai/unsubscribe.html?x=1";
const FOOTER_ENV = { FUNDHUB_REP_NUMBER: "+15613048368", APP_BASE_URL: "https://fundhub.ai" };

test("F18 — a template with its own HTML gets the signature on a white card, not on its grey page", () => {
  const out = withUnsubscribeFooter(HTML_TEMPLATE_BODY, UNSUB, FOOTER_ENV);

  assert.ok(out.includes("Two clear numbered steps."), "the approved copy survives");
  assert.ok(out.includes(EMAIL_SIGNATURE_PATH) && out.includes(EMAIL_LOGO_PATH),
    "both signature images are still in the footer");

  /* The white ground is the whole fix. Without it these two PNGs — white
     artwork on a white background — draw as rectangles on #F4F4F5. */
  const footer = out.slice(out.indexOf("<!-- fundhub-email-footer -->"));
  assert.ok(/background-color:#ffffff/i.test(footer),
    "the appended footer must carry its own white ground, not borrow the template's");
  assert.ok(footer.indexOf("background-color:#ffffff") < footer.indexOf(EMAIL_LOGO_PATH),
    "the white ground opens before the images, so both sit on it");
  assert.ok(/width:600px/.test(footer),
    "the footer card is centred at the same width the seeded templates use");
});

test("F18 — a plain-text body still gets the bare footer, because the shell already supplies the card", () => {
  const out = withUnsubscribeFooter("Here's the e-book we talked about.", UNSUB, FOOTER_ENV);
  const footer = out.slice(out.indexOf("<!-- fundhub-email-footer -->"));
  assert.ok(!/width:600px/.test(footer),
    "no second card inside the shell's card — that would double the padding");
  assert.ok(out.includes(EMAIL_SIGNATURE_PATH), "the signature is still there");
});

test("F18 — one footer, one mark, however the body arrives", () => {
  for (const body of [HTML_TEMPLATE_BODY, "plain copy"]) {
    const out = withUnsubscribeFooter(body, UNSUB, FOOTER_ENV);
    assert.equal(out.split("<!-- fundhub-email-footer -->").length - 1, 1,
      "exactly one footer mark, so a second pass leaves the body alone");
    assert.equal(out.split(EMAIL_SIGNATURE_PATH).length - 1, 1, "one signature image");
    assert.equal(withUnsubscribeFooter(out, UNSUB, FOOTER_ENV), out, "re-appending is a no-op");
  }
});
